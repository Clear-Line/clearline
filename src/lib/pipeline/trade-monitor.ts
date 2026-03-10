/**
 * Trade Monitor — fetches recent trades for active markets and stores in Supabase.
 *
 * Improvements over original:
 *   - Paginated trade fetching (up to 5 pages per market)
 *   - Per-request 429 retry with exponential backoff
 *   - Freshness-aware candidate selection (recent snapshots only)
 *   - Lower concurrency (5 instead of 10) to reduce 429 rate
 *   - Richer telemetry for observability
 */

import { supabaseAdmin } from '../supabase';
import { fetchMarketTradesPaginated } from './polymarket';

const BATCH_SIZE = 5;          // concurrent market fetches (down from 10)
const MAX_PAGES_PER_MARKET = 5;
const PAGE_SIZE = 100;

export async function pollTrades(): Promise<{
  inserted: number;
  skipped: number;
  errors: string[];
  telemetry: {
    marketsSelected: number;
    marketsSucceeded: number;
    marketsRateLimited: number;
    marketsEmpty: number;
    walletsUpserted: number;
    pagesFetched: number;
    retriesUsed: number;
    newTradesInserted: number;
    duplicateTradesSkipped: number;
  };
}> {
  const startTime = Date.now();
  const TIME_BUDGET_MS = 50_000;
  const errors: string[] = [];
  let inserted = 0;
  let skipped = 0;
  let marketsSucceeded = 0;
  let marketsRateLimited = 0;
  let marketsEmpty = 0;
  let walletsUpserted = 0;
  let totalPagesFetched = 0;
  let totalRetries = 0;
  let duplicatesSkipped = 0;

  // --- Freshness-aware candidate selection ---
  // Only consider snapshots from the last 6 hours, ranked by volume
  const sixHoursAgo = new Date(Date.now() - 6 * 3600000).toISOString();
  const { data: volSnaps } = await supabaseAdmin
    .from('market_snapshots')
    .select('market_id, volume_24h')
    .gte('timestamp', sixHoursAgo)
    .gt('volume_24h', 0)
    .order('volume_24h', { ascending: false })
    .limit(5000);

  // Deduplicate and take top 800 unique markets
  const seen = new Set<string>();
  const volMarketIds: string[] = [];
  for (const s of volSnaps ?? []) {
    if (!seen.has(s.market_id)) {
      seen.add(s.market_id);
      volMarketIds.push(s.market_id);
      if (volMarketIds.length >= 800) break;
    }
  }

  // Fetch market metadata, only active ones (no category filter)
  const ID_BATCH = 200;
  const markets: { condition_id: string }[] = [];
  for (let i = 0; i < volMarketIds.length; i += ID_BATCH) {
    const batch = volMarketIds.slice(i, i + ID_BATCH);
    const { data, error: batchErr } = await supabaseAdmin
      .from('markets')
      .select('condition_id')
      .in('condition_id', batch)
      .eq('is_active', true);
    if (batchErr) {
      errors.push(`Market query batch ${i}: ${batchErr.message}`);
      continue;
    }
    if (data) markets.push(...data);
  }

  if (markets.length === 0) {
    return {
      inserted: 0, skipped: 0,
      errors: errors.length > 0 ? errors : ['No active markets found'],
      telemetry: {
        marketsSelected: 0, marketsSucceeded: 0, marketsRateLimited: 0,
        marketsEmpty: 0, walletsUpserted: 0, pagesFetched: 0, retriesUsed: 0,
        newTradesInserted: 0, duplicateTradesSkipped: 0,
      },
    };
  }

  // --- Process markets with paginated fetch + retry ---
  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      errors.push(`Time budget reached at market ${i}/${markets.length}, will continue next run`);
      break;
    }
    const batch = markets.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (market) => {
      try {
        const result = await fetchMarketTradesPaginated(market.condition_id, {
          maxPages: MAX_PAGES_PER_MARKET,
          pageSize: PAGE_SIZE,
        });

        totalPagesFetched += result.pages;
        totalRetries += result.retries;

        if (!result.trades || result.trades.length === 0) {
          marketsEmpty++;
          skipped++;
          return;
        }

        marketsSucceeded++;

        // Build batch rows
        const tradeRows = result.trades
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
          const beforeCount = inserted;
          const { error: insertError, count } = await supabaseAdmin
            .from('trades')
            .upsert(tradeRows, { onConflict: 'transaction_hash', ignoreDuplicates: true, count: 'exact' });

          if (insertError) {
            errors.push(`Trades ${market.condition_id}: ${insertError.message}`);
          } else {
            const actualInserted = count ?? 0;
            inserted += actualInserted;
            duplicatesSkipped += tradeRows.length - actualInserted;
          }
        }

        // Batch upsert wallets
        const walletMap = new Map<string, { address: string; username: string | null; pseudonym: string | null; last_updated: string }>();
        for (const t of result.trades) {
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
          const { error: walletErr } = await supabaseAdmin
            .from('wallets')
            .upsert(walletRows, { onConflict: 'address' });
          if (walletErr) {
            errors.push(`Wallets ${market.condition_id}: ${walletErr.message}`);
          } else {
            walletsUpserted += walletRows.length;
          }
        }
      } catch (err) {
        const errStr = String(err);
        if (errStr.includes('429') || errStr.includes('rate')) {
          marketsRateLimited++;
        }
        errors.push(`Market ${market.condition_id}: ${err}`);
      }
    }));
  }

  return {
    inserted,
    skipped,
    errors,
    telemetry: {
      marketsSelected: markets.length,
      marketsSucceeded,
      marketsRateLimited,
      marketsEmpty,
      walletsUpserted,
      pagesFetched: totalPagesFetched,
      retriesUsed: totalRetries,
      newTradesInserted: inserted,
      duplicateTradesSkipped: duplicatesSkipped,
    },
  };
}
