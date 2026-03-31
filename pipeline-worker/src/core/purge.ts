/**
 * Purge old data from BigQuery to stay within free tier limits.
 * Deletes snapshots and trades older than 3 days.
 */

import { bq } from './bigquery.js';

const RETENTION_DAYS = 3;

export async function purgeOldData(): Promise<{
  snapshotsDeleted: number;
  tradesDeleted: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let snapshotsDeleted = 0;
  let tradesDeleted = 0;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Purge old snapshots
  const snapResult = await bq
    .from('market_snapshots')
    .delete({ count: 'exact' })
    .lt('timestamp', cutoff);

  if (snapResult.error) {
    errors.push(`Snapshot purge: ${snapResult.error.message}`);
  } else {
    snapshotsDeleted = snapResult.count ?? 0;
  }

  // Purge old trades
  const tradeResult = await bq
    .from('trades')
    .delete({ count: 'exact' })
    .lt('timestamp', cutoff);

  if (tradeResult.error) {
    errors.push(`Trade purge: ${tradeResult.error.message}`);
  } else {
    tradesDeleted = tradeResult.count ?? 0;
  }

  // Purge stale market_cards (markets no longer active, computed > 7 days ago)
  const cardCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const cardResult = await bq
    .from('market_cards')
    .delete({ count: 'exact' })
    .lt('computed_at', cardCutoff);

  if (cardResult.error) {
    errors.push(`Card purge: ${cardResult.error.message}`);
  }

  // Purge old crypto derivatives (7-day retention)
  const cryptoCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const derivResult = await bq
    .from('crypto_derivatives')
    .delete({ count: 'exact' })
    .lt('fetched_at', cryptoCutoff);

  if (derivResult.error) {
    errors.push(`Crypto derivatives purge: ${derivResult.error.message}`);
  }

  // Purge old crypto signals (7-day retention)
  const sigResult = await bq
    .from('crypto_signals')
    .delete({ count: 'exact' })
    .lt('computed_at', cryptoCutoff);

  if (sigResult.error) {
    errors.push(`Crypto signals purge: ${sigResult.error.message}`);
  }

  return { snapshotsDeleted, tradesDeleted, errors };
}
