/**
 * Insider Detector — the new "smart wallet" signal.
 *
 * Replaces the historical-accuracy "smart wallet" definition (which was
 * dominated by sports bettors and structurally couldn't see fresh wallets)
 * with a behavioral filter on wallet_trade_positions: a wallet is an
 * "insider" in market M iff it looks purpose-built for that market.
 *
 *   - position concentration ≥ 50% of wallet's lifetime volume
 *   - wallet has touched ≤ 5 markets total
 *   - directional conviction ≥ 80% (net buyer or net seller, not market-making)
 *   - position value ≥ $1,000 absolute
 *   - position value ≥ 0.5% of market liquidity
 *
 * Cost discipline: ONE batched query joins wallet_trade_positions ↔ wallets
 * ↔ markets ↔ market_snapshots. The market_snapshots subquery uses a 24h
 * partition filter (mandatory). No per-market loops. We do NOT pass an
 * IN UNNEST(@market_ids) clause because wallet_trade_positions is only ~43 MB
 * and clustering already bounds the scan — adding the filter doesn't reduce
 * cost, it just adds parameter overhead.
 *
 * Run cadence: every 3 hours via worker.ts cron. Insider behavior is
 * structural (a wallet doesn't switch from "diversified generalist" to
 * "single-market focused" in 10 minutes), so 3-hour freshness is fine.
 *
 * Output: writes one row per market into the `market_insiders` table via
 * MERGE. Read paths LEFT JOIN this table; missing rows mean "no insiders".
 */

import { bq } from '../core/bigquery.js';

// ─── Insider gates ───
const POSITION_MIN_USD = 1000;        // material absolute size
const RELATIVE_SIZE_MIN = 0.005;       // 0.5% of market liquidity
const CONCENTRATION_MIN = 0.5;         // 50% of wallet's lifetime volume
const DIRECTIONAL_MIN = 0.8;           // 80% net directional
const FOCUS_MAX_MARKETS = 5;           // wallet has touched ≤5 markets
const WALLET_MIN_VOLUME = 1000;        // wallet has handled ≥$1k total
const TOP_INSIDERS_PER_MARKET = 5;

interface InsiderRow {
  market_id: string;
  wallet_address: string;
  outcome: string;
  buy_volume: number;
  sell_volume: number;
  total_markets_traded: number;
  total_volume_usdc: number;
  liquidity: number;
}

export interface TopInsider {
  address: string;       // shortened: 0x1234...abcd
  side: 'BUY' | 'SELL';
  position: number;      // rounded USD
  concentration: number; // 0-100 percent of wallet's lifetime volume
  marketsTraded: number;
}

export interface InsiderResult {
  count: number;
  topInsiders: TopInsider[];
}

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function isInsider(row: InsiderRow): boolean {
  const buy = Number(row.buy_volume) || 0;
  const sell = Number(row.sell_volume) || 0;
  const total = buy + sell;
  if (total === 0) return false;

  const positionValue = Math.max(buy, sell);
  const directional = Math.abs(buy - sell) / total;
  const concentration = positionValue / Math.max(Number(row.total_volume_usdc) || 1, 1);
  const relativeSize = positionValue / Math.max(Number(row.liquidity) || 1, 1);

  return (
    positionValue >= POSITION_MIN_USD &&
    relativeSize >= RELATIVE_SIZE_MIN &&
    concentration >= CONCENTRATION_MIN &&
    directional >= DIRECTIONAL_MIN
  );
}

export async function runInsiderDetector(): Promise<{
  marketsScanned: number;
  marketsWithInsiders: number;
  insidersFound: number;
  errors: string[];
  duration_ms: number;
}> {
  const startTime = Date.now();
  const errors: string[] = [];
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;

  // ── Step 1: One big query ─────────────────────────────────────────────
  // Joins wallet_trade_positions ↔ wallets ↔ markets ↔ latest market_snapshot.
  // The subquery on market_snapshots has the mandatory 24h partition filter.
  // Pre-filter at SQL level on the cheapest gates: focused wallet (≤5 markets)
  // and material wallet volume. JS handles the per-row directional /
  // concentration / size gates because they're cheap once we have the rows.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error: qErr } = await bq.rawQuery<InsiderRow>(`
    SELECT
      wtp.market_id,
      wtp.wallet_address,
      wtp.outcome,
      wtp.buy_volume,
      wtp.sell_volume,
      w.total_markets_traded,
      w.total_volume_usdc,
      s.liquidity
    FROM \`${dataset}.wallet_trade_positions\` wtp
    JOIN \`${dataset}.wallets\` w ON w.address = wtp.wallet_address
    JOIN \`${dataset}.markets\` m ON m.condition_id = wtp.market_id
    JOIN (
      SELECT market_id, liquidity,
        ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY timestamp DESC) AS rn
      FROM \`${dataset}.market_snapshots\`
      WHERE timestamp >= @cutoff
    ) s ON s.market_id = wtp.market_id AND s.rn = 1
    WHERE w.total_markets_traded <= ${FOCUS_MAX_MARKETS}
      AND w.total_volume_usdc >= ${WALLET_MIN_VOLUME}
      AND m.is_resolved = FALSE
      AND (m.category IS NULL OR m.category != 'sports')
  `, { cutoff });

  if (qErr) {
    return {
      marketsScanned: 0,
      marketsWithInsiders: 0,
      insidersFound: 0,
      errors: [`Insider query: ${qErr.message}`],
      duration_ms: Date.now() - startTime,
    };
  }

  // ── Step 2: Group rows by market, apply per-row gates ──────────────────
  const byMarket = new Map<string, InsiderRow[]>();
  for (const row of rows ?? []) {
    const arr = byMarket.get(row.market_id) ?? [];
    arr.push(row);
    byMarket.set(row.market_id, arr);
  }

  const results = new Map<string, InsiderResult>();
  let totalInsiders = 0;
  for (const [marketId, marketRows] of byMarket) {
    const insiders = marketRows.filter(isInsider);
    if (insiders.length === 0) continue;

    // Sort by position value descending and take top N for display
    const sorted = [...insiders].sort((a, b) =>
      Math.max(Number(b.buy_volume), Number(b.sell_volume))
      - Math.max(Number(a.buy_volume), Number(a.sell_volume))
    );

    const topInsiders: TopInsider[] = sorted.slice(0, TOP_INSIDERS_PER_MARKET).map((r) => {
      const buy = Number(r.buy_volume) || 0;
      const sell = Number(r.sell_volume) || 0;
      const positionValue = Math.max(buy, sell);
      const concentration = positionValue / Math.max(Number(r.total_volume_usdc) || 1, 1);
      return {
        address: shortenAddress(r.wallet_address),
        side: buy >= sell ? 'BUY' : 'SELL',
        position: Math.round(positionValue),
        concentration: Math.round(concentration * 100),
        marketsTraded: Number(r.total_markets_traded) || 0,
      };
    });

    results.set(marketId, { count: insiders.length, topInsiders });
    totalInsiders += insiders.length;
  }

  // ── Step 3: MERGE results into market_insiders ─────────────────────────
  // One row per market. We only write markets with insider_count > 0; the
  // cleanup DELETE below removes rows that haven't been refreshed in 24h
  // (i.e. markets that had insiders before but don't anymore).
  const entries = [...results.entries()];
  const MERGE_BATCH = 500;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < entries.length; i += MERGE_BATCH) {
    const chunk = entries.slice(i, i + MERGE_BATCH);
    const sourceRows = chunk
      .map(([marketId, result]) => {
        const idEsc = marketId.replace(/'/g, "\\'");
        const topJson = JSON.stringify(result.topInsiders).replace(/'/g, "\\'");
        return `SELECT '${idEsc}' AS market_id, ${result.count} AS insider_count, '${topJson}' AS top_insiders, TIMESTAMP('${nowIso}') AS computed_at`;
      })
      .join('\nUNION ALL\n');

    const mergeSQL = `
      MERGE \`${dataset}.market_insiders\` AS target
      USING (${sourceRows}) AS source
      ON target.market_id = source.market_id
      WHEN MATCHED THEN UPDATE SET
        insider_count = source.insider_count,
        top_insiders = source.top_insiders,
        computed_at = source.computed_at
      WHEN NOT MATCHED THEN
        INSERT (market_id, insider_count, top_insiders, computed_at)
        VALUES (source.market_id, source.insider_count, source.top_insiders, source.computed_at)
    `;

    try {
      await bq.rawQuery(mergeSQL);
    } catch (err) {
      errors.push(`Merge batch ${i}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── Step 4: Cleanup stale rows ─────────────────────────────────────────
  // Markets that had insiders previously but don't anymore. The DELETE is
  // bounded by `computed_at < now - 24h`, so it's a single cheap query.
  try {
    await bq.rawQuery(`
      DELETE FROM \`${dataset}.market_insiders\`
      WHERE computed_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
    `);
  } catch (err) {
    errors.push(`Cleanup delete: ${err instanceof Error ? err.message : err}`);
  }

  return {
    marketsScanned: byMarket.size,
    marketsWithInsiders: results.size,
    insidersFound: totalInsiders,
    errors,
    duration_ms: Date.now() - startTime,
  };
}
