/**
 * Position Tracker — snapshots current positions of flagged/whale wallets.
 *
 * Uses fetchMarketHolders() to get current open positions for markets
 * where flagged wallets are active. Enables position delta tracking
 * and wallet concentration analysis.
 *
 * Run every 30 minutes.
 */

import { supabaseAdmin } from '../supabase';
import { fetchMarketHolders } from './polymarket';

export async function trackPositions(): Promise<{
  tracked: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let tracked = 0;

  // ─── Step 1: Get flagged wallets (composite_score > 0.4) ───

  const { data: flaggedRows, error: fErr } = await supabaseAdmin
    .from('wallet_signals')
    .select('wallet_address, market_id')
    .gt('composite_score', 0.4);

  if (fErr || !flaggedRows || flaggedRows.length === 0) {
    return { tracked: 0, errors: fErr ? [`Wallet signals query: ${fErr.message}`] : [] };
  }

  const flaggedWallets = new Set(flaggedRows.map((r) => r.wallet_address));

  // Get unique market IDs where flagged wallets are active
  const marketIds = [...new Set(flaggedRows.map((r) => r.market_id))];

  // Filter to only active markets
  const ID_BATCH = 200;
  const activeMarketIds: string[] = [];
  for (let i = 0; i < marketIds.length; i += ID_BATCH) {
    const batch = marketIds.slice(i, i + ID_BATCH);
    const { data } = await supabaseAdmin
      .from('markets')
      .select('condition_id')
      .in('condition_id', batch)
      .eq('is_active', true);
    if (data) activeMarketIds.push(...data.map((m) => m.condition_id));
  }

  if (activeMarketIds.length === 0) {
    return { tracked: 0, errors };
  }

  // ─── Step 2: Fetch positions per market and filter to flagged wallets ───
  // Time budget: stop after ~45s to stay within Vercel's 60s limit

  const startTime = Date.now();
  const TIME_BUDGET_MS = 45_000;

  const positionRows: {
    wallet_address: string;
    market_id: string;
    position_size: number;
    outcome: string;
    snapshot_time: string;
  }[] = [];

  const CONCURRENCY = 5;
  const now = new Date().toISOString();

  for (let i = 0; i < activeMarketIds.length; i += CONCURRENCY) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      errors.push(`Time budget reached at market ${i}/${activeMarketIds.length}, will continue next run`);
      break;
    }

    const batch = activeMarketIds.slice(i, i + CONCURRENCY);

    await Promise.all(
      batch.map(async (marketId) => {
        try {
          const holders = await fetchMarketHolders(marketId);
          if (!holders || holders.length === 0) return;

          for (const h of holders) {
            if (!flaggedWallets.has(h.proxyWallet)) continue;
            if (!h.size || h.size <= 0) continue;

            positionRows.push({
              wallet_address: h.proxyWallet,
              market_id: marketId,
              position_size: h.size,
              outcome: h.outcome || 'Unknown',
              snapshot_time: now,
            });
          }
        } catch (err) {
          errors.push(`Holders ${marketId}: ${err}`);
        }
      }),
    );
  }

  // ─── Step 3: Batch insert position snapshots ───

  const INSERT_BATCH = 500;
  for (let i = 0; i < positionRows.length; i += INSERT_BATCH) {
    const chunk = positionRows.slice(i, i + INSERT_BATCH);
    const { error } = await supabaseAdmin
      .from('wallet_positions')
      .insert(chunk);

    if (error) {
      errors.push(`Position insert batch ${i}: ${error.message}`);
    } else {
      tracked += chunk.length;
    }
  }

  return { tracked, errors };
}
