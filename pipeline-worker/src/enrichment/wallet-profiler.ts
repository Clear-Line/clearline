/**
 * Wallet Profiler — incrementally aggregates trade data for wallet statistics.
 *
 * Key change from v1: stats are INCREMENTED with new data since last run,
 * not recomputed from scratch. This means total_trades, total_volume, etc.
 * accumulate over time even though the trades table only retains 3 days.
 *
 * Also computes credibility_score using a fixed normalization scale.
 */

import { bq } from '../core/bigquery.js';

export async function profileWallets(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Backfill wallets that have accuracy data but no trade stats
  const backfillResult = await backfillWalletStats();
  errors.push(...backfillResult.errors);
  updated += backfillResult.updated;

  const profileResult = await incrementalProfileWallets();
  errors.push(...profileResult.errors);
  updated += profileResult.updated;

  const credResult = await computeCredibility();
  errors.push(...credResult.errors);
  updated += credResult.updated;

  return { updated, errors };
}

/**
 * Backfill wallet stats for wallets that have accuracy data (wins/losses)
 * but no trade stats (total_trades = 0 or null). Uses a single BigQuery
 * aggregation over the trades table (3-day retention).
 */
async function backfillWalletStats(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Find wallets that have been scored but have no trade stats
  const { data: needsBackfill, error: qErr } = await bq
    .from('wallets')
    .select('address')
    .gt('accuracy_sample_size', 0)
    .lte('total_trades', 0);

  // Also fetch wallets where total_trades is null
  const { data: needsBackfillNull } = await bq
    .from('wallets')
    .select('address')
    .gt('accuracy_sample_size', 0)
    .eq('total_trades', 0);

  const backfillAddresses = new Set<string>();
  for (const w of needsBackfill ?? []) backfillAddresses.add(w.address);
  for (const w of needsBackfillNull ?? []) backfillAddresses.add(w.address);

  if (backfillAddresses.size === 0) {
    return { updated: 0, errors: qErr ? [`Backfill query: ${qErr.message}`] : [] };
  }

  console.log(`[WalletProfiler] Backfilling stats for ${backfillAddresses.size} wallets...`);

  // Aggregate from trades table in batches
  const addresses = [...backfillAddresses];
  const BATCH = 200;
  const bqDataset = process.env.BQ_DATASET || 'polymarket';

  for (let i = 0; i < addresses.length; i += BATCH) {
    const batch = addresses.slice(i, i + BATCH);

    const { data: agg, error: aggErr } = await bq.rawQuery<{
      wallet_address: string;
      trade_count: number;
      total_volume: number;
      markets_traded: number;
    }>(`
      SELECT wallet_address,
             COUNT(*) as trade_count,
             SUM(CAST(size_usdc AS FLOAT64)) as total_volume,
             COUNT(DISTINCT market_id) as markets_traded
      FROM \`${process.env.GCP_PROJECT_ID}.${bqDataset}.trades\`
      WHERE wallet_address IN UNNEST(@wallets)
      GROUP BY wallet_address
    `, { wallets: batch });

    if (aggErr) {
      errors.push(`Backfill agg batch ${i}: ${aggErr.message}`);
      continue;
    }

    if (!agg || agg.length === 0) continue;

    const upsertRows = agg.map((row) => ({
      address: row.wallet_address,
      total_trades: Number(row.trade_count) || 0,
      total_volume_usdc: Math.round((Number(row.total_volume) || 0) * 100) / 100,
      total_markets_traded: Number(row.markets_traded) || 0,
      last_updated: new Date().toISOString(),
    }));

    const { error: uErr } = await bq
      .from('wallets')
      .upsert(upsertRows, { onConflict: 'address' });

    if (uErr) {
      errors.push(`Backfill upsert batch ${i}: ${uErr.message}`);
    } else {
      updated += upsertRows.length;
    }
  }

  console.log(`[WalletProfiler] Backfilled ${updated} wallets from trades table`);

  // Recompute total_markets_traded from wallet_trade_positions (permanent, accurate source)
  // This replaces the additive increment approach that caused double-counting.
  const dsName = process.env.BQ_DATASET || 'polymarket';
  try {
    await bq.rawQuery(`
      UPDATE \`${process.env.GCP_PROJECT_ID}.${dsName}.wallets\` AS w
      SET total_markets_traded = sub.market_count
      FROM (
        SELECT wallet_address, COUNT(DISTINCT market_id) AS market_count
        FROM \`${process.env.GCP_PROJECT_ID}.${dsName}.wallet_trade_positions\`
        GROUP BY wallet_address
      ) AS sub
      WHERE w.address = sub.wallet_address
        AND (w.total_markets_traded IS NULL OR w.total_markets_traded != sub.market_count)
    `);
    console.log('[WalletProfiler] Recomputed total_markets_traded from positions');
  } catch (err) {
    errors.push(`Markets traded recompute: ${err instanceof Error ? err.message : err}`);
  }

  return { updated, errors };
}

/**
 * Incrementally update wallet stats from recent trades only.
 * Uses a dedicated watermark in pipeline_metadata to prevent double-counting.
 */
async function incrementalProfileWallets(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Use a dedicated watermark stored in pipeline_metadata — NOT derived from wallets table.
  // This prevents double-counting when the profiler runs multiple times.
  const WATERMARK_KEY = 'wallet_profiler_watermark';
  const { data: wmRow } = await bq
    .from('pipeline_metadata')
    .select('value')
    .eq('key', WATERMARK_KEY)
    .limit(1);

  const watermark = wmRow?.[0]?.value
    ? new Date(wmRow[0].value).toISOString()
    : new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const runTimestamp = new Date().toISOString();

  // Fetch trades since watermark — partition-pruned by timestamp
  const { data: recentTrades, error: tError } = await bq
    .from('trades')
    .select('wallet_address, market_id, size_usdc, timestamp')
    .gte('timestamp', watermark);

  if (tError) {
    return { updated: 0, errors: [`Failed to fetch recent trades: ${tError.message}`] };
  }

  if (!recentTrades || recentTrades.length === 0) {
    return { updated: 0, errors: [] };
  }

  // Group by wallet
  const walletNewData = new Map<string, {
    newTrades: number;
    newVolume: number;
    newMarkets: Set<string>;
    earliestTimestamp: string;
    username: string | null;
    pseudonym: string | null;
  }>();

  for (const t of recentTrades) {
    const existing = walletNewData.get(t.wallet_address) ?? {
      newTrades: 0, newVolume: 0, newMarkets: new Set<string>(),
      earliestTimestamp: t.timestamp, username: null, pseudonym: null,
    };

    existing.newTrades++;
    existing.newVolume += Number(t.size_usdc) || 0;
    existing.newMarkets.add(t.market_id);
    if (t.timestamp < existing.earliestTimestamp) {
      existing.earliestTimestamp = t.timestamp;
    }

    walletNewData.set(t.wallet_address, existing);
  }

  // Fetch existing wallet rows to read current totals
  const addresses = [...walletNewData.keys()];
  const existingMap = new Map<string, {
    total_trades: number;
    total_volume_usdc: number;
    total_markets_traded: number;
    first_seen_polymarket: string | null;
  }>();

  const ADDR_BATCH = 200;
  for (let i = 0; i < addresses.length; i += ADDR_BATCH) {
    const batch = addresses.slice(i, i + ADDR_BATCH);
    const { data } = await bq
      .from('wallets')
      .select('address, total_trades, total_volume_usdc, total_markets_traded, first_seen_polymarket')
      .in('address', batch);

    if (data) {
      for (const row of data) {
        existingMap.set(row.address, {
          total_trades: row.total_trades ?? 0,
          total_volume_usdc: row.total_volume_usdc ?? 0,
          total_markets_traded: row.total_markets_traded ?? 0,
          first_seen_polymarket: row.first_seen_polymarket ?? null,
        });
      }
    }
  }

  // Build incremental upsert rows
  const upsertRows = [];
  const now = new Date().toISOString();

  for (const [address, newData] of walletNewData) {
    const existing = existingMap.get(address) ?? {
      total_trades: 0, total_volume_usdc: 0,
      total_markets_traded: 0, first_seen_polymarket: null,
    };

    const row: Record<string, unknown> = {
      address,
      total_trades: existing.total_trades + newData.newTrades,
      total_volume_usdc: Math.round((existing.total_volume_usdc + newData.newVolume) * 100) / 100,
      // Note: total_markets_traded is NOT incremented here — it's recomputed
      // in the backfill phase from wallet_trade_positions to avoid double-counting
      last_updated: now,
    };

    // Only set first_seen if not already set
    if (!existing.first_seen_polymarket) {
      row.first_seen_polymarket = newData.earliestTimestamp;
    }

    upsertRows.push(row);
  }

  // Batch upsert
  const BATCH = 500;
  for (let i = 0; i < upsertRows.length; i += BATCH) {
    const chunk = upsertRows.slice(i, i + BATCH);
    const { error } = await bq
      .from('wallets')
      .upsert(chunk, { onConflict: 'address' });

    if (error) {
      errors.push(`Profile batch ${i}: ${error.message}`);
    } else {
      updated += chunk.length;
    }
  }

  // Save watermark so next run doesn't re-process these trades
  if (updated > 0) {
    try {
      await bq.from('pipeline_metadata').upsert(
        [{ key: WATERMARK_KEY, value: runTimestamp, updated_at: runTimestamp }],
        { onConflict: 'key' },
      );
    } catch (err) {
      errors.push(`Save watermark: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[WalletProfiler] Incremented stats for ${updated} wallets from ${recentTrades.length} trades`);
  return { updated, errors };
}

/**
 * Compute credibility_score for wallets that have accuracy data.
 * Uses fixed normalization (not relative to current batch).
 *
 * credibility = 40% accuracy + 30% normalized_pnl + 30% entry_timing
 */
async function computeCredibility(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  const { data: wallets, error: wErr } = await bq
    .from('wallets')
    .select('address, accuracy_score, accuracy_sample_size, total_pnl_usdc')
    .not('accuracy_score', 'is', null)
    .gte('accuracy_sample_size', 3);

  if (wErr || !wallets || wallets.length === 0) {
    return { updated: 0, errors: wErr ? [`Credibility query: ${wErr.message}`] : [] };
  }

  // Get entry timing scores
  const walletAddresses = wallets.map((w: { address: string }) => w.address);
  const { data: signalRows } = await bq
    .from('wallet_signals')
    .select('wallet_address, entry_timing_score')
    .in('wallet_address', walletAddresses);

  const timingByWallet = new Map<string, { sum: number; count: number }>();
  for (const s of signalRows ?? []) {
    const existing = timingByWallet.get(s.wallet_address) ?? { sum: 0, count: 0 };
    existing.sum += Number(s.entry_timing_score) || 0;
    existing.count++;
    timingByWallet.set(s.wallet_address, existing);
  }

  // Fixed-scale normalization for PnL (not relative to batch max)
  const PNL_SCALE = 10000; // $10k = max normalized PnL

  const updateRows = [];
  for (const w of wallets) {
    const accuracy = Number(w.accuracy_score) || 0;
    const pnl = Number(w.total_pnl_usdc) || 0;

    // Normalize PnL to [0, 1] using fixed scale
    const normalizedPnl = Math.max(0, Math.min(1, (pnl / PNL_SCALE + 1) / 2));

    const timing = timingByWallet.get(w.address);
    const avgTiming = timing && timing.count > 0 ? timing.sum / timing.count : 0.5;

    const credibility = accuracy * 0.4 + normalizedPnl * 0.3 + avgTiming * 0.3;

    updateRows.push({
      address: w.address,
      credibility_score: Math.round(credibility * 1000) / 1000,
    });
  }

  const BATCH = 500;
  for (let i = 0; i < updateRows.length; i += BATCH) {
    const chunk = updateRows.slice(i, i + BATCH);
    const { error } = await bq
      .from('wallets')
      .upsert(chunk, { onConflict: 'address' });

    if (error) {
      errors.push(`Credibility batch ${i}: ${error.message}`);
    } else {
      updated += chunk.length;
    }
  }

  return { updated, errors };
}
