/**
 * Purge old data from BigQuery to stay within free tier limits.
 * Deletes snapshots and trades older than 3 days.
 */

import { bq } from './bigquery.js';

const TRADE_RETENTION_DAYS = 3;
const SNAPSHOT_RETENTION_DAYS = 30;

export async function purgeOldData(): Promise<{
  snapshotsDeleted: number;
  tradesDeleted: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let snapshotsDeleted = 0;
  let tradesDeleted = 0;
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const tradeCutoff = new Date(Date.now() - TRADE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const snapshotCutoff = new Date(Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Purge old snapshots (30-day retention for price correlation)
  const snapResult = await bq
    .from('market_snapshots')
    .delete({ count: 'exact' })
    .lt('timestamp', snapshotCutoff);

  if (snapResult.error) {
    errors.push(`Snapshot purge: ${snapResult.error.message}`);
  } else {
    snapshotsDeleted = snapResult.count ?? 0;
  }

  // Purge old trades (3-day retention)
  const tradeResult = await bq
    .from('trades')
    .delete({ count: 'exact' })
    .lt('timestamp', tradeCutoff);

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

  // Purge market_edges referencing resolved markets
  try {
    await bq.rawQuery(`
      DELETE FROM \`${dataset}.market_edges\`
      WHERE market_a IN (
        SELECT condition_id FROM \`${dataset}.markets\` WHERE is_resolved = true
      )
      OR market_b IN (
        SELECT condition_id FROM \`${dataset}.markets\` WHERE is_resolved = true
      )
    `);
  } catch (err) {
    errors.push(`Edge cleanup: ${err}`);
  }

  // Purge orphaned wallet_trade_positions for markets already resolved > 1 day ago
  // (safety net in case accuracy-computer's post-scoring cleanup fails)
  try {
    await bq.rawQuery(`
      DELETE FROM \`${dataset}.wallet_trade_positions\` wtp
      WHERE EXISTS (
        SELECT 1 FROM \`${dataset}.markets\` m
        WHERE m.condition_id = wtp.market_id
          AND m.is_resolved = true
          AND m.resolved_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 DAY)
      )
    `);
  } catch (err) {
    errors.push(`Position cleanup: ${err}`);
  }

  return { snapshotsDeleted, tradesDeleted, errors };
}
