/**
 * Trade Monitor — fetches recent trades for active markets and stores in Supabase.
 * Uses batch inserts for performance.
 */

import { supabaseAdmin } from '../supabase';
import { fetchMarketTrades } from './polymarket';

export async function pollTrades(): Promise<{ inserted: number; skipped: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;
  let skipped = 0;

  // Get top 200 markets by volume — keeps within 60s timeout
  const { data: volSnaps } = await supabaseAdmin
    .from('market_snapshots')
    .select('market_id, volume_24h')
    .gt('volume_24h', 1000)
    .order('volume_24h', { ascending: false })
    .limit(2000);

  // Deduplicate and take the top 200 unique markets
  const seen = new Set<string>();
  const volMarketIds: string[] = [];
  for (const s of volSnaps ?? []) {
    if (!seen.has(s.market_id)) {
      seen.add(s.market_id);
      volMarketIds.push(s.market_id);
      if (volMarketIds.length >= 200) break;
    }
  }

  // Fetch market metadata, only active ones in our focus categories
  const ID_BATCH = 200;
  const markets: { condition_id: string }[] = [];
  for (let i = 0; i < volMarketIds.length; i += ID_BATCH) {
    const batch = volMarketIds.slice(i, i + ID_BATCH);
    const { data } = await supabaseAdmin
      .from('markets')
      .select('condition_id')
      .in('condition_id', batch)
      .eq('is_active', true);
    if (data) markets.push(...data);
  }

  const mktError = null;

  if (mktError || !markets) {
    return { inserted: 0, skipped: 0, errors: [`Failed to fetch markets: ${mktError?.message}`] };
  }

  // Process markets in batches of 10 concurrently
  const BATCH_SIZE = 10;
  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    const batch = markets.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (market) => {
      try {
        const trades = await fetchMarketTrades(market.condition_id, 100);
        if (!trades || trades.length === 0) return;

        // Build batch rows
        const tradeRows = trades
          .filter((t) => t.transactionHash && t.proxyWallet)
          .map((t) => ({
            market_id: market.condition_id,
            wallet_address: t.proxyWallet,
            side: t.side,
            size_tokens: t.size,
            price: t.price,
            size_usdc: t.usdcSize ?? t.size * t.price,
            outcome: t.outcome,
            outcome_index: t.outcomeIndex,
            transaction_hash: t.transactionHash,
            timestamp: new Date(t.timestamp * 1000).toISOString(),
          }));

        // Batch upsert trades
        if (tradeRows.length > 0) {
          const { error: insertError, count } = await supabaseAdmin
            .from('trades')
            .upsert(tradeRows, { onConflict: 'transaction_hash', ignoreDuplicates: true, count: 'exact' });

          if (insertError) {
            errors.push(`Trades ${market.condition_id}: ${insertError.message}`);
          } else {
            inserted += count ?? tradeRows.length;
          }
        }

        // Batch upsert wallets
        const walletMap = new Map<string, { address: string; username: string | null; pseudonym: string | null; last_updated: string }>();
        for (const t of trades) {
          if (!t.proxyWallet) continue;
          walletMap.set(t.proxyWallet, {
            address: t.proxyWallet,
            username: t.name || null,
            pseudonym: t.pseudonym || null,
            last_updated: new Date().toISOString(),
          });
        }

        const walletRows = Array.from(walletMap.values());
        if (walletRows.length > 0) {
          await supabaseAdmin
            .from('wallets')
            .upsert(walletRows, { onConflict: 'address' });
        }
      } catch (err) {
        errors.push(`Market ${market.condition_id}: ${err}`);
      }
    }));
  }

  return { inserted, skipped, errors };
}
