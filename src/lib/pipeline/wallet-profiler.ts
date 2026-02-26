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

  // Batch update wallets in chunks of 50
  const CHUNK = 50;
  for (let i = 0; i < stats.length; i += CHUNK) {
    const chunk = stats.slice(i, i + CHUNK);

    for (const w of chunk) {
      const { error: updateError } = await supabaseAdmin
        .from('wallets')
        .update({
          total_trades: w.total_trades,
          total_volume_usdc: w.total_volume_usdc,
          total_markets_traded: w.total_markets_traded,
          first_seen_polymarket: w.first_seen_polymarket,
          last_updated: new Date().toISOString(),
        })
        .eq('address', w.wallet_address);

      if (updateError) {
        errors.push(`Wallet ${w.wallet_address}: ${updateError.message}`);
      } else {
        updated++;
      }
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

  // Process in batches of 20
  const BATCH = 20;
  for (let i = 0; i < wallets.length; i += BATCH) {
    const batch = wallets.slice(i, i + BATCH);

    await Promise.all(batch.map(async (wallet) => {
      try {
        // Get all trades for this wallet
        const { data: trades, error: tError } = await supabaseAdmin
          .from('trades')
          .select('market_id, size_usdc, timestamp')
          .eq('wallet_address', wallet.address);

        if (tError || !trades) {
          errors.push(`Wallet ${wallet.address}: ${tError?.message}`);
          return;
        }

        if (trades.length === 0) return;

        const totalTrades = trades.length;
        const totalVolume = trades.reduce((sum, t) => sum + Number(t.size_usdc || 0), 0);
        const uniqueMarkets = new Set(trades.map(t => t.market_id)).size;
        const firstSeen = trades
          .map(t => new Date(t.timestamp))
          .sort((a, b) => a.getTime() - b.getTime())[0]
          .toISOString();

        const { error: updateError } = await supabaseAdmin
          .from('wallets')
          .update({
            total_trades: totalTrades,
            total_volume_usdc: totalVolume,
            total_markets_traded: uniqueMarkets,
            first_seen_polymarket: firstSeen,
            last_updated: new Date().toISOString(),
          })
          .eq('address', wallet.address);

        if (updateError) {
          errors.push(`Update ${wallet.address}: ${updateError.message}`);
        } else {
          updated++;
        }
      } catch (err) {
        errors.push(`Wallet ${wallet.address}: ${err}`);
      }
    }));
  }

  return { updated, errors };
}
