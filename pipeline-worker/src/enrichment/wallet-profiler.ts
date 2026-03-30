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

  const profileResult = await incrementalProfileWallets();
  errors.push(...profileResult.errors);
  updated += profileResult.updated;

  const credResult = await computeCredibility();
  errors.push(...credResult.errors);
  updated += credResult.updated;

  return { updated, errors };
}

/**
 * Incrementally update wallet stats from recent trades only (last 12h).
 * Adds to existing totals rather than replacing them.
 */
async function incrementalProfileWallets(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Only look at trades from last 12 hours (matches job interval)
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

  // Fetch recent trades — partition-pruned by timestamp
  const { data: recentTrades, error: tError } = await bq
    .from('trades')
    .select('wallet_address, market_id, size_usdc, timestamp')
    .gte('timestamp', twelveHoursAgo);

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
      total_markets_traded: existing.total_markets_traded + newData.newMarkets.size,
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
