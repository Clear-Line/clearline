/**
 * Trade Monitor — fetches recent trades for active markets and stores in Supabase.
 * Run every 2 minutes.
 */

import { supabaseAdmin } from '../supabase';
import { fetchMarketTrades } from './polymarket';

export async function pollTrades(): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;
  let skipped = 0;

  // Get all active markets from our DB
  const { data: markets, error: mktError } = await supabaseAdmin
    .from('markets')
    .select('condition_id')
    .eq('is_active', true);

  if (mktError || !markets) {
    return { inserted: 0, skipped: 0, errors: [`Failed to fetch markets: ${mktError?.message}`] };
  }

  for (const market of markets) {
    try {
      const trades = await fetchMarketTrades(market.condition_id, 50);

      for (const t of trades) {
        if (!t.transactionHash || !t.proxyWallet) continue;

        const row = {
          market_id: market.condition_id,
          wallet_address: t.proxyWallet,
          side: t.side,
          size_tokens: t.size,
          size_usdc: t.usdcSize,
          price: t.price,
          outcome: t.outcome,
          outcome_index: t.outcomeIndex,
          transaction_hash: t.transactionHash,
          timestamp: new Date(t.timestamp * 1000).toISOString(),
        };

        const { error: insertError } = await supabaseAdmin
          .from('trades')
          .upsert(row, { onConflict: 'transaction_hash', ignoreDuplicates: true });

        if (insertError) {
          // Duplicate hash = already stored, skip silently
          if (insertError.code === '23505') {
            skipped++;
          } else {
            errors.push(`Trade ${t.transactionHash}: ${insertError.message}`);
          }
        } else {
          inserted++;
        }

        // Upsert wallet record
        await supabaseAdmin
          .from('wallets')
          .upsert(
            {
              address: t.proxyWallet,
              username: t.name || null,
              pseudonym: t.pseudonym || null,
              last_updated: new Date().toISOString(),
            },
            { onConflict: 'address' },
          );
      }
    } catch (err) {
      errors.push(`Market ${market.condition_id}: ${err}`);
    }
  }

  return { inserted, skipped, errors };
}
