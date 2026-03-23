/**
 * Book Snapshotter — fetches order book depth and spread for active markets.
 * Updates market_snapshots with book_depth and spread data.
 * Run every 10 minutes.
 */

import { supabaseAdmin } from '../supabase';
import { bq } from '../bigquery';
import { fetchOrderBook, fetchSpread } from './polymarket';

function computeDepthWithin5Cents(
  levels: { price: string; size: string }[],
  midpoint: number,
  side: 'bid' | 'ask',
): number {
  let depth = 0;
  for (const level of levels) {
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    const diff = side === 'bid' ? midpoint - price : price - midpoint;
    if (diff <= 0.05) {
      depth += size * price; // approximate USD value
    }
  }
  return depth;
}

/**
 * Compute book imbalance: total bid size / (total bid size + total ask size).
 * > 0.5 means more bid support (buying pressure).
 */
function computeBookImbalance(
  bids: { price: string; size: string }[],
  asks: { price: string; size: string }[],
): number | null {
  let bidTotal = 0;
  let askTotal = 0;
  for (const b of bids) bidTotal += parseFloat(b.size) || 0;
  for (const a of asks) askTotal += parseFloat(a.size) || 0;
  if (bidTotal + askTotal === 0) return null;
  return bidTotal / (bidTotal + askTotal);
}

/**
 * Compute cost-to-move: walk the book until cumulative purchase/sale
 * would move the price by `targetDelta` from midpoint.
 * Returns the total USD cost to achieve that price impact.
 */
function computeCostToMove(
  levels: { price: string; size: string }[],
  midpoint: number,
  targetDelta: number,
  direction: 'up' | 'down',
): number | null {
  if (levels.length === 0 || midpoint <= 0) return null;

  const targetPrice = direction === 'up'
    ? midpoint * (1 + targetDelta)
    : midpoint * (1 - targetDelta);

  let totalCost = 0;
  let currentPrice = midpoint;

  // Levels should be sorted: asks ascending, bids descending (as returned by CLOB)
  for (const level of levels) {
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) continue;

    // Check if this level reaches our target
    if (direction === 'up' && price >= targetPrice) {
      // We've reached the target price level
      totalCost += size * price; // consume this level
      return totalCost;
    }
    if (direction === 'down' && price <= targetPrice) {
      totalCost += size * price;
      return totalCost;
    }

    totalCost += size * price;
    currentPrice = price;
  }

  // If we walked the entire book without reaching target, return total cost
  return totalCost > 0 ? totalCost : null;
}

export async function snapshotBooks(): Promise<{ updated: number; errors: string[] }> {
  const startTime = Date.now();
  const TIME_BUDGET_MS = 30_000; // leave 30s buffer for DB writes
  const errors: string[] = [];
  let updated = 0;
  const MAX_MARKETS = 200; // cap to top markets by volume to fit within Vercel 60s

  // Get all active markets with their CLOB token IDs (no category filter)
  const { data: markets, error: mktError } = await supabaseAdmin
    .from('markets')
    .select('condition_id, clob_token_ids, outcomes')
    .eq('is_active', true);

  const topMarketIds = [...new Set((topSnaps ?? []).map((s: { market_id: string }) => s.market_id))];

  if (topMarketIds.length === 0) {
    return { updated: 0, errors: ['No recent snapshots with volume found'] };
  }

  // Fetch CLOB token IDs from Supabase for these markets only
  const ID_BATCH_SIZE = 200;
  const markets: { condition_id: string; clob_token_ids: string[]; outcomes: string[] }[] = [];
  for (let i = 0; i < topMarketIds.length; i += ID_BATCH_SIZE) {
    const batch = topMarketIds.slice(i, i + ID_BATCH_SIZE);
    const { data, error: mktError } = await supabaseAdmin
      .from('markets')
      .select('condition_id, clob_token_ids, outcomes')
      .in('condition_id', batch)
      .eq('is_active', true);

    if (mktError) {
      errors.push(`Failed to fetch markets batch ${i}: ${mktError.message}`);
      continue;
    }
    if (data) markets.push(...data);
  }

  if (markets.length === 0) {
    return { updated: 0, errors: ['No active markets with CLOB token IDs found'] };
  }

  // Process markets concurrently in batches of 10, collect book data
  const snapshotRows: {
    market_id: string;
    spread: number | null;
    book_depth_bid_5c: number;
    book_depth_ask_5c: number;
    book_imbalance: number | null;
    cost_move_up_5pct: number | null;
    cost_move_down_5pct: number | null;
  }[] = [];

  const CONCURRENCY = 5; // reduced from 10 to avoid rate limits
  for (let i = 0; i < markets.length; i += CONCURRENCY) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      errors.push(`Time budget reached at market ${i}/${markets.length}, will continue next run`);
      break;
    }
    const batch = markets.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (market) => {
      try {
        const tokenIds = market.clob_token_ids as string[];
        if (!tokenIds || tokenIds.length < 1) return;

        const yesTokenId = tokenIds[0];
        const book = await fetchOrderBook(yesTokenId);

        // If the book is empty/invalid, skip instead of writing synthetic 0.50 prices.
        if (!book.bids?.length || !book.asks?.length) return;

        const bestBid = parseFloat(book.bids[0].price);
        const bestAsk = parseFloat(book.asks[0].price);
        const hasValidTopOfBook =
          Number.isFinite(bestBid) &&
          Number.isFinite(bestAsk) &&
          bestBid > 0 &&
          bestAsk > 0 &&
          bestBid < 1 &&
          bestAsk < 1 &&
          bestAsk > bestBid;

        if (!hasValidTopOfBook) return;

        const midpoint = (bestBid + bestAsk) / 2;
        const spread = bestAsk - bestBid;

        const bidDepth = computeDepthWithin5Cents(book.bids, midpoint, 'bid');
        const askDepth = computeDepthWithin5Cents(book.asks, midpoint, 'ask');

        const imbalance = computeBookImbalance(book.bids, book.asks);
        const costUp = computeCostToMove(book.asks, midpoint, 0.05, 'up');
        const costDown = computeCostToMove(book.bids, midpoint, 0.05, 'down');

        snapshotRows.push({
          market_id: market.condition_id,
          spread: spread > 0 ? spread : null,
          book_depth_bid_5c: bidDepth,
          book_depth_ask_5c: askDepth,
          book_imbalance: imbalance,
          cost_move_up_5pct: costUp,
          cost_move_down_5pct: costDown,
        });
      } catch (err) {
        errors.push(`Book ${market.condition_id}: ${err}`);
      }
    }));
  }

  // Batch-upsert book data using MERGE (single DML query per batch of 500)
  // Include market_id + timestamp so the MERGE can match existing snapshots
  const snapshotMap = new Map(snapshotRows.map((r) => [r.market_id, r]));
  const marketIds = snapshotRows.map((r) => r.market_id);

  // Fetch latest snapshot timestamp per market in one query
  const { data: latestSnaps } = await bq
    .from('market_snapshots')
    .select('market_id, timestamp')
    .in('market_id', marketIds)
    .not('volume_24h', 'is', null)
    .order('timestamp', { ascending: false });

  const latestByMarket = new Map<string, string>();
  if (latestSnaps) {
    for (const s of latestSnaps as { market_id: string; timestamp: string }[]) {
      if (!latestByMarket.has(s.market_id)) {
        latestByMarket.set(s.market_id, s.timestamp);
      }
    }
  }

  // Build upsert rows with the composite key (market_id + timestamp)
  const upsertRows = [];
  for (const [marketId, timestamp] of latestByMarket) {
    const row = snapshotMap.get(marketId);
    if (!row) continue;
    upsertRows.push({
      market_id: marketId,
      timestamp,
      spread: row.spread,
      book_depth_bid_5c: row.book_depth_bid_5c,
      book_depth_ask_5c: row.book_depth_ask_5c,
      book_imbalance: row.book_imbalance,
      cost_move_up_5pct: row.cost_move_up_5pct,
      cost_move_down_5pct: row.cost_move_down_5pct,
    });
  }

  // Single MERGE per batch instead of individual UPDATEs
  const UPSERT_BATCH = 500;
  for (let i = 0; i < upsertRows.length; i += UPSERT_BATCH) {
    const chunk = upsertRows.slice(i, i + UPSERT_BATCH);
    const { error } = await bq
      .from('market_snapshots')
      .upsert(chunk, { onConflict: 'market_id,timestamp' });

    if (error) {
      errors.push(`Book upsert batch ${i}: ${error.message}`);
    } else {
      updated += chunk.length;
    }
  }

  return { updated, errors };
}
