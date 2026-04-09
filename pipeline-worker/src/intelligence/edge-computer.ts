/**
 * Edge Computer — computes pairwise market relationships for the constellation map.
 *
 * Two signals:
 *   1. Wallet co-occurrence: how many wallets hold positions in both markets
 *   2. Price correlation: Pearson correlation of daily price changes (30-day window)
 *
 * Data sources:
 *   - BigQuery: wallet_trade_positions (permanent), markets, market_snapshots (30-day)
 *
 * Writes:
 *   - BigQuery: market_edges (one row per market pair, upserted)
 */

import { bq } from '../core/bigquery.js';

// ─── Types ───

interface WalletOverlapRow {
  market_a: string;
  market_b: string;
  shared_wallets: number;
  wallet_overlap: number;
}

interface PriceCorrelationRow {
  market_a: string;
  market_b: string;
  price_corr: number;
  corr_samples: number;
}

interface MarketEdge {
  market_a: string;
  market_b: string;
  wallet_overlap: number;
  shared_wallets: number;
  price_corr: number | null;
  corr_samples: number | null;
  combined_weight: number;
  updated_at: string;
}

// ─── Constants ───

const MIN_SHARED_WALLETS = 4;
const MIN_CORR_SAMPLES = 10;
const MIN_COMBINED_WEIGHT = 0.15;
const WALLET_WEIGHT = 0.4;
const CORRELATION_WEIGHT = 0.6;
const BATCH_SIZE = 500;

// ─── Main ───

export async function computeEdges(): Promise<{
  edgesComputed: number;
  errors: string[];
  telemetry: {
    activeMarkets: number;
    multiMarketWallets: number;
    pairsWithOverlap: number;
    pairsWithCorrelation: number;
  };
}> {
  const errors: string[] = [];
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const now = new Date().toISOString();

  let pairsWithOverlap = 0;
  let pairsWithCorrelation = 0;
  let activeMarkets = 0;
  let multiMarketWallets = 0;

  // ─── Step 1: Wallet co-occurrence ───

  let overlapRows: WalletOverlapRow[] = [];
  try {
    const overlapResult = await bq.rawQuery<WalletOverlapRow & {
      active_market_count: number;
      multi_wallet_count: number;
    }>(`
      WITH active_positions AS (
        SELECT wtp.wallet_address, wtp.market_id
        FROM \`${dataset}.wallet_trade_positions\` wtp
        JOIN \`${dataset}.markets\` m
          ON m.condition_id = wtp.market_id
        WHERE m.is_active = true AND m.is_resolved = false
          AND m.category IN ('politics', 'crypto', 'economics', 'geopolitics', 'culture')
      ),
      market_count AS (
        SELECT COUNT(DISTINCT market_id) AS cnt FROM active_positions
      ),
      multi_wallets AS (
        SELECT wallet_address
        FROM active_positions
        GROUP BY wallet_address
        HAVING COUNT(DISTINCT market_id) >= 2
      ),
      multi_wallet_count AS (
        SELECT COUNT(*) AS cnt FROM multi_wallets
      ),
      filtered AS (
        SELECT ap.wallet_address, ap.market_id
        FROM active_positions ap
        JOIN multi_wallets mw ON mw.wallet_address = ap.wallet_address
      ),
      pair_counts AS (
        SELECT
          a.market_id AS market_a,
          b.market_id AS market_b,
          COUNT(DISTINCT a.wallet_address) AS shared_wallets
        FROM filtered a
        JOIN filtered b
          ON a.wallet_address = b.wallet_address
          AND a.market_id < b.market_id
        GROUP BY 1, 2
        HAVING COUNT(DISTINCT a.wallet_address) >= @min_shared
      ),
      market_wallet_counts AS (
        SELECT market_id, COUNT(DISTINCT wallet_address) AS wallet_count
        FROM filtered
        GROUP BY market_id
      )
      SELECT
        pc.market_a,
        pc.market_b,
        pc.shared_wallets,
        SAFE_DIVIDE(
          pc.shared_wallets,
          (mwc_a.wallet_count + mwc_b.wallet_count - pc.shared_wallets)
        ) AS wallet_overlap,
        (SELECT cnt FROM market_count) AS active_market_count,
        (SELECT cnt FROM multi_wallet_count) AS multi_wallet_count
      FROM pair_counts pc
      JOIN market_wallet_counts mwc_a ON mwc_a.market_id = pc.market_a
      JOIN market_wallet_counts mwc_b ON mwc_b.market_id = pc.market_b
      ORDER BY shared_wallets DESC
      LIMIT 10000
    `, { min_shared: MIN_SHARED_WALLETS });

    if (overlapResult.error) {
      errors.push(`Wallet overlap: ${overlapResult.error.message}`);
    } else {
      overlapRows = overlapResult.data ?? [];
      pairsWithOverlap = overlapRows.length;
      if (overlapRows.length > 0) {
        activeMarkets = (overlapRows[0] as any).active_market_count ?? 0;
        multiMarketWallets = (overlapRows[0] as any).multi_wallet_count ?? 0;
      }
    }
  } catch (err) {
    errors.push(`Wallet overlap query failed: ${err}`);
  }

  // ─── Step 2: Price correlation ───

  // Only compute correlation for markets that have wallet overlap (not all-pairs)
  const overlapMarketIds = new Set<string>();
  for (const row of overlapRows) {
    overlapMarketIds.add(row.market_a);
    overlapMarketIds.add(row.market_b);
  }

  let correlationRows: PriceCorrelationRow[] = [];
  if (overlapMarketIds.size < 2) {
    // Skip correlation if no wallet overlap pairs exist
    console.log('[EdgeComputer] Skipping price correlation — no wallet overlap pairs');
  }

  if (overlapMarketIds.size >= 2) try {
    const marketIdArray = [...overlapMarketIds];
    const corrResult = await bq.rawQuery<PriceCorrelationRow>(`
      WITH daily_prices AS (
        SELECT
          market_id,
          DATE(timestamp) AS price_date,
          AVG(yes_price) AS avg_price
        FROM \`${dataset}.market_snapshots\`
        WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
          AND market_id IN UNNEST(@market_ids)
        GROUP BY market_id, DATE(timestamp)
      ),
      price_changes AS (
        SELECT
          market_id,
          price_date,
          avg_price - LAG(avg_price) OVER (PARTITION BY market_id ORDER BY price_date) AS price_change
        FROM daily_prices
      ),
      qualified AS (
        SELECT market_id
        FROM price_changes
        WHERE price_change IS NOT NULL
        GROUP BY market_id
        HAVING COUNT(*) >= @min_samples
      )
      SELECT
        a.market_id AS market_a,
        b.market_id AS market_b,
        CORR(a.price_change, b.price_change) AS price_corr,
        COUNT(*) AS corr_samples
      FROM price_changes a
      JOIN price_changes b
        ON a.price_date = b.price_date
        AND a.market_id < b.market_id
      JOIN qualified qa ON qa.market_id = a.market_id
      JOIN qualified qb ON qb.market_id = b.market_id
      WHERE a.price_change IS NOT NULL AND b.price_change IS NOT NULL
      GROUP BY 1, 2
      HAVING COUNT(*) >= @min_samples
        AND ABS(CORR(a.price_change, b.price_change)) >= 0.3
      ORDER BY ABS(CORR(a.price_change, b.price_change)) DESC
      LIMIT 10000
    `, { min_samples: MIN_CORR_SAMPLES, market_ids: marketIdArray });

    if (corrResult.error) {
      errors.push(`Price correlation: ${corrResult.error.message}`);
    } else {
      correlationRows = corrResult.data ?? [];
      pairsWithCorrelation = correlationRows.length;
    }
  } catch (err) {
    // Expected to fail or return 0 rows until 14+ days of snapshot data exists
    errors.push(`Price correlation query: ${err}`);
  }

  // ─── Step 3: Combine and write edges ───

  // Build correlation lookup
  const corrMap = new Map<string, PriceCorrelationRow>();
  for (const row of correlationRows) {
    corrMap.set(`${row.market_a}|${row.market_b}`, row);
  }

  // Merge overlap + correlation into edges
  const edges: MarketEdge[] = [];
  const seenPairs = new Set<string>();

  // Start with all overlap pairs
  for (const row of overlapRows) {
    const key = `${row.market_a}|${row.market_b}`;
    seenPairs.add(key);

    const corr = corrMap.get(key);
    // Require both signals — drop wallet-only edges (chance overlaps with no price relationship).
    if (!corr) continue;

    const walletScore = row.wallet_overlap;
    const corrScore = Math.abs(corr.price_corr);
    const combined = WALLET_WEIGHT * walletScore + CORRELATION_WEIGHT * corrScore;

    if (combined >= MIN_COMBINED_WEIGHT) {
      edges.push({
        market_a: row.market_a,
        market_b: row.market_b,
        wallet_overlap: row.wallet_overlap,
        shared_wallets: row.shared_wallets,
        price_corr: corr.price_corr,
        corr_samples: corr.corr_samples,
        combined_weight: Math.round(combined * 1000) / 1000,
        updated_at: now,
      });
    }
  }

  // Add correlation-only pairs (no wallet overlap but strong price correlation)
  for (const row of correlationRows) {
    const key = `${row.market_a}|${row.market_b}`;
    if (seenPairs.has(key)) continue;

    const corrScore = Math.abs(row.price_corr);
    const combined = CORRELATION_WEIGHT * corrScore; // no wallet overlap

    if (combined >= MIN_COMBINED_WEIGHT) {
      edges.push({
        market_a: row.market_a,
        market_b: row.market_b,
        wallet_overlap: 0,
        shared_wallets: 0,
        price_corr: row.price_corr,
        corr_samples: row.corr_samples,
        combined_weight: Math.round(combined * 1000) / 1000,
        updated_at: now,
      });
    }
  }

  // Write in batches
  let edgesComputed = 0;
  for (let i = 0; i < edges.length; i += BATCH_SIZE) {
    const batch = edges.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await bq.from('market_edges').upsert(batch, {
        onConflict: 'market_a,market_b',
      });
      if (error) {
        errors.push(`Edge upsert batch ${i}: ${error.message}`);
      } else {
        edgesComputed += batch.length;
      }
    } catch (err) {
      errors.push(`Edge upsert batch ${i}: ${err}`);
    }
  }

  return {
    edgesComputed,
    errors,
    telemetry: {
      activeMarkets,
      multiMarketWallets,
      pairsWithOverlap,
      pairsWithCorrelation,
    },
  };
}
