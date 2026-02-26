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

  // Get active markets with their CLOB token IDs
  const { data: markets, error: mktError } = await supabaseAdmin
    .from('markets')
    .select('condition_id, clob_token_ids, outcomes')
    .eq('is_active', true);

  if (mktError || !markets) {
    return { updated: 0, errors: [`Failed to fetch markets: ${mktError?.message}`] };
  }

  for (const market of markets) {
    try {
      const tokenIds = market.clob_token_ids as string[];
      if (!tokenIds || tokenIds.length < 1) continue;

      const yesTokenId = tokenIds[0];

      // Fetch order book for YES token
      const book = await fetchOrderBook(yesTokenId);

      // Compute midpoint
      const bestBid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
      const bestAsk = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
      const midpoint = (bestBid + bestAsk) / 2;
      const spread = bestAsk - bestBid;

      // Compute depth within 5 cents of midpoint
      const bidDepth = computeDepthWithin5Cents(book.bids, midpoint, 'bid');
      const askDepth = computeDepthWithin5Cents(book.asks, midpoint, 'ask');

      // Insert a snapshot row
      const { error: snapError } = await supabaseAdmin
        .from('market_snapshots')
        .insert({
          market_id: market.condition_id,
          yes_price: midpoint,
          no_price: 1 - midpoint,
          spread: spread > 0 ? spread : null,
          book_depth_bid_5c: bidDepth,
          book_depth_ask_5c: askDepth,
        });

      if (snapError) {
        errors.push(`Snapshot ${market.condition_id}: ${snapError.message}`);
      } else {
        updated++;
      }
    } catch (err) {
      errors.push(`Book ${market.condition_id}: ${err}`);
    }
  }

  return { updated, errors };
}
