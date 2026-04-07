/**
 * Trade Fetcher — fetches recent trades for active markets and stores in BigQuery.
 *
 * Adapted for Railway worker — no time budget.
 *
 * Features:
 *   - Paginated trade fetching (up to 2 pages per market)
 *   - Per-request 429 retry with exponential backoff
 *   - Freshness-aware candidate selection (recent snapshots only)
 *   - Lower concurrency (5 instead of 10) to reduce 429 rate
 *   - Richer telemetry for observability
 */

import { bq } from '../core/bigquery.js';
import { fetchMarketTradesPaginated } from '../core/polymarket-client.js';
import { dirtyTracker } from '../core/dirty-tracker.js';

const BATCH_SIZE = 10;          // concurrent market fetches
const MAX_PAGES_PER_MARKET = 2; // fewer pages per market = more markets covered
const PAGE_SIZE = 100;

// Polymarket /trades occasionally returns a position-id–shaped string
// (`<address>-<tokenId>`) in the proxyWallet field. Reject anything that
// isn't a plain 0x + 40-hex-char wallet so we don't pollute trades / wallets.
const ETH_ADDR_RE = /^0x[a-f0-9]{40}$/;

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
  const { data: volSnaps } = await bq
    .from('market_snapshots')
    .select('market_id, volume_24h')
    .gte('timestamp', sixHoursAgo)
    .gt('volume_24h', 0)
    .order('volume_24h', { ascending: false })
    .limit(1000);

  // Deduplicate and take top 200 unique markets
  const seen = new Set<string>();
  const volMarketIds: string[] = [];
  for (const s of volSnaps ?? []) {
    if (!seen.has(s.market_id)) {
      seen.add(s.market_id);
      volMarketIds.push(s.market_id);
      if (volMarketIds.length >= 200) break;
    }
  }

  // Fetch market metadata from BigQuery, only active ones
  const ID_BATCH = 200;
  const markets: { condition_id: string }[] = [];
  for (let i = 0; i < volMarketIds.length; i += ID_BATCH) {
    const batch = volMarketIds.slice(i, i + ID_BATCH);
    const { data, error: batchErr } = await bq
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

  // --- Prioritize markets without recent trades ---
  // Fetch markets that already have trades from the last 24h so we can deprioritize them
  const allCandidateIds = markets.map((m) => m.condition_id);
  const recentTradeIds = new Set<string>();
  for (let i = 0; i < allCandidateIds.length; i += ID_BATCH) {
    const batch = allCandidateIds.slice(i, i + ID_BATCH);
    const { data: recentTrades } = await bq
      .from('trades')
      .select('market_id')
      .in('market_id', batch)
      .gte('timestamp', new Date(Date.now() - 24 * 3600000).toISOString());
    if (recentTrades) {
      for (const t of recentTrades) recentTradeIds.add(t.market_id);
    }
  }

  // Put markets without recent trades first, then markets with trades
  const marketsWithout = markets.filter((m) => !recentTradeIds.has(m.condition_id));
  const marketsWith = markets.filter((m) => recentTradeIds.has(m.condition_id));
  markets.length = 0;
  markets.push(...marketsWithout, ...marketsWith);

  // --- Fetch trades from all markets, then batch-write to BigQuery ---
  // Collect all trade/wallet rows in memory first to avoid concurrent DML limits
  const allTradeRows: {
    market_id: string; wallet_address: string; side: string;
    size_tokens: number; price: number; size_usdc: number;
    outcome: string; outcome_index: number;
    transaction_hash: string; timestamp: string;
  }[] = [];
  const allWalletMap = new Map<string, { address: string; username: string | null; pseudonym: string | null; last_updated: string }>();

  for (let i = 0; i < markets.length; i += BATCH_SIZE) {
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

        for (const t of result.trades) {
          if (!t.transactionHash || !t.proxyWallet) continue;
          const addr = t.proxyWallet.toLowerCase();
          if (!ETH_ADDR_RE.test(addr)) continue; // skip malformed (e.g. position-id strings)

          allTradeRows.push({
            market_id: market.condition_id,
            wallet_address: addr,
            side: t.side,
            size_tokens: t.size,
            price: t.price,
            size_usdc: t.usdcSize ?? t.size * t.price,
            outcome: t.outcome,
            outcome_index: t.outcomeIndex,
            transaction_hash: t.transactionHash,
            timestamp: new Date(t.timestamp * 1000).toISOString(),
          });

          // Polymarket returns the proxy-wallet id (`0x...-<tokenId>`) in `t.name`
          // for users who haven't set a real handle. Don't store that as a username.
          const cleanName = t.name && !/^0x[a-fA-F0-9]{40}-/.test(t.name) ? t.name : null;
          allWalletMap.set(addr, {
            address: addr,
            username: cleanName,
            pseudonym: t.pseudonym || null,
            last_updated: new Date().toISOString(),
          });
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

  // --- Sequential batch writes to BigQuery (avoids concurrent DML limit) ---
  const UPSERT_BATCH = 500;
  for (let i = 0; i < allTradeRows.length; i += UPSERT_BATCH) {
    const chunk = allTradeRows.slice(i, i + UPSERT_BATCH);
    const { error: insertError, count } = await bq
      .from('trades')
      .upsert(chunk, { onConflict: 'transaction_hash', ignoreDuplicates: true, count: 'exact' });

    if (insertError) {
      errors.push(`Trade upsert batch ${i}: ${insertError.message}`);
    } else {
      const actualInserted = count ?? 0;
      inserted += actualInserted;
      duplicatesSkipped += chunk.length - actualInserted;
    }
  }

  const walletRows = Array.from(allWalletMap.values());
  if (walletRows.length > 0) {
    for (let i = 0; i < walletRows.length; i += UPSERT_BATCH) {
      const chunk = walletRows.slice(i, i + UPSERT_BATCH);
      const { error: walletErr } = await bq
        .from('wallets')
        .upsert(chunk, { onConflict: 'address' });
      if (walletErr) {
        errors.push(`Wallet upsert batch ${i}: ${walletErr.message}`);
      } else {
        walletsUpserted += chunk.length;
      }
    }
  }

  // Mark all traded markets as dirty for downstream enrichment
  dirtyTracker.markMany([...new Set(allTradeRows.map(t => t.market_id))]);

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
