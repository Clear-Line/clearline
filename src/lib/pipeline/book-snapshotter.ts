/**
 * Book Snapshotter — fetches order book depth and spread for active markets.
 * Updates market_snapshots with book_depth and spread data.
 * Run every 10 minutes.
 */

import { supabaseAdmin } from '../supabase';
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

export async function snapshotBooks(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;

  // Get active political/economic markets with their CLOB token IDs
  const { data: markets, error: mktError } = await supabaseAdmin
    .from('markets')
    .select('condition_id, clob_token_ids, outcomes')
    .eq('is_active', true)
    .in('category', ['politics', 'economics']);

  if (mktError || !markets) {
    return { updated: 0, errors: [`Failed to fetch markets: ${mktError?.message}`] };
  }

  // Process markets concurrently in batches of 10, collect snapshot rows
  const snapshotRows: {
    market_id: string;
    timestamp: string;
    yes_price: number;
    no_price: number;
    spread: number | null;
    book_depth_bid_5c: number;
    book_depth_ask_5c: number;
  }[] = [];

  const CONCURRENCY = 10;
  for (let i = 0; i < markets.length; i += CONCURRENCY) {
    const batch = markets.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (market) => {
      try {
        const tokenIds = market.clob_token_ids as string[];
        if (!tokenIds || tokenIds.length < 1) return;

        const yesTokenId = tokenIds[0];
        const book = await fetchOrderBook(yesTokenId);

        const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
        const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
        const midpoint = (bestBid + bestAsk) / 2;
        const spread = bestAsk - bestBid;

        const bidDepth = computeDepthWithin5Cents(book.bids, midpoint, 'bid');
        const askDepth = computeDepthWithin5Cents(book.asks, midpoint, 'ask');

        snapshotRows.push({
          market_id: market.condition_id,
          timestamp: new Date().toISOString(),
          yes_price: midpoint,
          no_price: 1 - midpoint,
          spread: spread > 0 ? spread : null,
          book_depth_bid_5c: bidDepth,
          book_depth_ask_5c: askDepth,
        });
      } catch (err) {
        errors.push(`Book ${market.condition_id}: ${err}`);
      }
    }));
  }

  // Batch insert all snapshots
  const BATCH_SIZE = 500;
  for (let i = 0; i < snapshotRows.length; i += BATCH_SIZE) {
    const batch = snapshotRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from('market_snapshots')
      .insert(batch);

    if (error) {
      errors.push(`Snapshot batch offset=${i}: ${error.message}`);
    } else {
      updated += batch.length;
    }
  }

  return { updated, errors };
}
