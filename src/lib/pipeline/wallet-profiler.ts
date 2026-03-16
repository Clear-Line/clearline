/**
 * Wallet Profiler — aggregates trade data to compute wallet statistics.
 * Updates wallets table with total_trades, total_volume_usdc, total_markets_traded,
 * first_seen_polymarket, and accuracy_score.
 */

import { supabaseAdmin } from '../supabase';
import { bq } from '../bigquery';

export async function profileWallets(): Promise<{ updated: number; errors: string[] }> {
  const startTime = Date.now();
  const TIME_BUDGET_MS = 50_000; // leave 10s buffer for Vercel's 60s limit
  const errors: string[] = [];
  let updated = 0;

  // No RPC in BigQuery — use JS fallback aggregation directly
  const fallbackResult = await fallbackProfileWallets();
  errors.push(...fallbackResult.errors);
  updated += fallbackResult.updated;

  // After basic profiling, compute credibility scores and PnL (if time remains)
  if (Date.now() - startTime < TIME_BUDGET_MS) {
    const credResult = await computeCredibilityAndPnl(TIME_BUDGET_MS - (Date.now() - startTime));
    errors.push(...credResult.errors);
    updated += credResult.updated;
  } else {
    errors.push('Time budget reached before credibility computation, will continue next run');
  }

  return { updated, errors };
}

/**
 * Compute credibility_score and total_pnl_usdc for wallets.
 *
 * credibility_score = 40% accuracy + 30% normalized PnL + 30% entry_timing
 * total_pnl_usdc = realized PnL from trades in resolved markets
 */
async function computeCredibilityAndPnl(remainingMs = 40_000): Promise<{ updated: number; errors: string[] }> {
  const credStart = Date.now();
  const errors: string[] = [];
  let updated = 0;

  // Get wallets that have accuracy scores
  const { data: wallets, error: wErr } = await bq
    .from('wallets')
    .select('address, accuracy_score, accuracy_sample_size')
    .not('accuracy_score', 'is', null);

  if (wErr || !wallets || wallets.length === 0) {
    return { updated: 0, errors: wErr ? [`Credibility wallet query: ${wErr.message}`] : [] };
  }

  const walletAddresses = wallets.map((w) => w.address);

  // Get resolved markets and their outcomes
  const { data: resolvedMarkets } = await supabaseAdmin
    .from('markets')
    .select('condition_id, resolution_outcome')
    .eq('is_resolved', true)
    .not('resolution_outcome', 'is', null);

  const resolutionMap = new Map<string, string>();
  for (const m of resolvedMarkets ?? []) {
    resolutionMap.set(m.condition_id, m.resolution_outcome);
  }

  // Fetch trades for these wallets in resolved markets
  const resolvedIds = [...resolutionMap.keys()];
  const ID_BATCH = 200;
  const allTrades: {
    wallet_address: string;
    market_id: string;
    side: string;
    outcome: string;
    price: number;
    size_usdc: number;
  }[] = [];

  for (let i = 0; i < resolvedIds.length; i += ID_BATCH) {
    if (Date.now() - credStart > remainingMs) {
      errors.push(`Credibility time budget reached at trade fetch ${i}/${resolvedIds.length}`);
      break;
    }
    const batch = resolvedIds.slice(i, i + ID_BATCH);
    const { data } = await bq
      .from('trades')
      .select('wallet_address, market_id, side, outcome, price, size_usdc')
      .in('market_id', batch)
      .in('wallet_address', walletAddresses);

    if (data) allTrades.push(...data);
  }

  // Compute PnL per wallet
  const pnlByWallet = new Map<string, number>();

  for (const t of allTrades) {
    const resolution = resolutionMap.get(t.market_id);
    if (!resolution) continue;

    const isWinningOutcome = t.outcome === resolution;
    const price = Number(t.price) || 0;
    const usdc = Number(t.size_usdc) || 0;
    if (price <= 0 || usdc <= 0) continue;

    let pnl = 0;
    if (t.side === 'BUY') {
      // Bought at price P. If winning: profit = (1/P - 1) * usdc. If losing: loss = -usdc
      pnl = isWinningOutcome ? usdc * (1 / price - 1) : -usdc;
    } else {
      // Sold at price P. If winning: loss. If losing: profit = usdc
      pnl = isWinningOutcome ? -usdc * (1 / price - 1) : usdc;
    }

    pnlByWallet.set(t.wallet_address, (pnlByWallet.get(t.wallet_address) ?? 0) + pnl);
  }

  // Get entry timing scores for credibility weighting
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

  // Normalize PnL
  const pnlValues = [...pnlByWallet.values()].map(Math.abs);
  const maxPnl = pnlValues.length > 0 ? Math.max(...pnlValues) : 1;

  const updateRows = [];
  for (const w of wallets) {
    const accuracy = Number(w.accuracy_score) || 0;
    const pnl = pnlByWallet.get(w.address) ?? 0;
    const normalizedPnl = maxPnl > 0 ? Math.max(0, Math.min(1, (pnl / maxPnl + 1) / 2)) : 0.5;
    const timing = timingByWallet.get(w.address);
    const avgTiming = timing && timing.count > 0 ? timing.sum / timing.count : 0.5;

    const credibility = accuracy * 0.4 + normalizedPnl * 0.3 + avgTiming * 0.3;

    updateRows.push({
      address: w.address,
      total_pnl_usdc: Math.round(pnl * 100) / 100,
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

/**
 * Fallback: compute wallet stats in JS if the Supabase RPC function doesn't exist.
 */
async function fallbackProfileWallets(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Get all wallets
  const { data: wallets, error: wError } = await bq
    .from('wallets')
    .select('address');

  if (wError || !wallets) {
    return { updated: 0, errors: [`Failed to fetch wallets: ${wError?.message}`] };
  }

  // Fetch all trades at once and aggregate in JS
  const { data: allTrades, error: tError } = await bq
    .from('trades')
    .select('wallet_address, market_id, size_usdc, timestamp');

  if (tError || !allTrades) {
    return { updated: 0, errors: [`Failed to fetch trades: ${tError?.message}`] };
  }

  // Group trades by wallet
  const tradesByWallet = new Map<string, typeof allTrades>();
  for (const t of allTrades) {
    if (!tradesByWallet.has(t.wallet_address)) tradesByWallet.set(t.wallet_address, []);
    tradesByWallet.get(t.wallet_address)!.push(t);
  }

  // Build update rows
  const now = new Date().toISOString();
  const walletRows = [];

  for (const wallet of wallets) {
    const trades = tradesByWallet.get(wallet.address);
    if (!trades || trades.length === 0) continue;

    const totalTrades = trades.length;
    const totalVolume = trades.reduce((sum, t) => sum + Number(t.size_usdc || 0), 0);
    const uniqueMarkets = new Set(trades.map(t => t.market_id)).size;
    const firstSeen = trades
      .map(t => new Date(t.timestamp))
      .sort((a, b) => a.getTime() - b.getTime())[0]
      .toISOString();

    walletRows.push({
      address: wallet.address,
      total_trades: totalTrades,
      total_volume_usdc: totalVolume,
      total_markets_traded: uniqueMarkets,
      first_seen_polymarket: firstSeen,
      last_updated: now,
    });
  }

  // Batch upsert in chunks of 500
  const BATCH = 500;
  for (let i = 0; i < walletRows.length; i += BATCH) {
    const chunk = walletRows.slice(i, i + BATCH);
    const { error: updateError } = await bq
      .from('wallets')
      .upsert(chunk, { onConflict: 'address' });

    if (updateError) {
      errors.push(`Wallet batch offset=${i}: ${updateError.message}`);
    } else {
      updated += chunk.length;
    }
  }

  return { updated, errors };
}
