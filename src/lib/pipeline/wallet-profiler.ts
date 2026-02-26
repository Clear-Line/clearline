/**
 * Wallet Profiler — aggregates trade data to compute wallet statistics.
 * Updates wallets table with total_trades, total_volume_usdc, total_markets_traded,
 * first_seen_polymarket, and accuracy_score.
 */

import { supabaseAdmin } from '../supabase';

export async function profileWallets(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Aggregate trade stats per wallet using a single SQL query
  const { data: stats, error: queryError } = await supabaseAdmin.rpc('compute_wallet_stats');

  if (queryError) {
    // If RPC doesn't exist yet, fall back to manual aggregation
    return fallbackProfileWallets();
  }

  if (!stats || stats.length === 0) {
    return { updated: 0, errors: ['No wallet stats computed'] };
  }

  // Batch upsert wallets in chunks of 500
  const CHUNK = 500;
  const now = new Date().toISOString();
  const rows = stats.map((w: { wallet_address: string; total_trades: number; total_volume_usdc: number; total_markets_traded: number; first_seen_polymarket: string }) => ({
    address: w.wallet_address,
    total_trades: w.total_trades,
    total_volume_usdc: w.total_volume_usdc,
    total_markets_traded: w.total_markets_traded,
    first_seen_polymarket: w.first_seen_polymarket,
    last_updated: now,
  }));

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error: updateError } = await supabaseAdmin
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

/**
 * Fallback: compute wallet stats in JS if the Supabase RPC function doesn't exist.
 */
async function fallbackProfileWallets(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Get all wallets
  const { data: wallets, error: wError } = await supabaseAdmin
    .from('wallets')
    .select('address');

  if (wError || !wallets) {
    return { updated: 0, errors: [`Failed to fetch wallets: ${wError?.message}`] };
  }

  // Fetch all trades at once and aggregate in JS
  const { data: allTrades, error: tError } = await supabaseAdmin
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
    const { error: updateError } = await supabaseAdmin
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
