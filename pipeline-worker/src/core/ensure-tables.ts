/**
 * Ensure BigQuery tables exist — called once on worker startup.
 * Creates the `markets` table if it doesn't already exist.
 */

import { bq } from './bigquery.js';

export async function ensureTables(): Promise<void> {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;

  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.markets\` (
      condition_id STRING NOT NULL,
      question STRING,
      slug STRING,
      event_id STRING,
      category STRING,
      outcomes STRING,
      clob_token_ids STRING,
      start_date TIMESTAMP,
      end_date TIMESTAMP,
      is_active BOOL,
      is_resolved BOOL,
      resolution_outcome STRING,
      resolved_at TIMESTAMP,
      updated_at TIMESTAMP
    )
    CLUSTER BY condition_id
  `);

  console.log('[EnsureTables] BigQuery markets table ready');

  // Add accumulative wallet columns (idempotent — IF NOT EXISTS)
  const walletColumns = [
    { name: 'wins', type: 'INT64' },
    { name: 'losses', type: 'INT64' },
    { name: 'data_source', type: 'STRING' },
    { name: 'falcon_score', type: 'FLOAT64' },
    { name: 'last_accuracy_update', type: 'TIMESTAMP' },
  ];

  for (const col of walletColumns) {
    try {
      await bq.rawQuery(
        `ALTER TABLE \`${dataset}.wallets\` ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
      );
    } catch (err: unknown) {
      // Ignore "already exists" errors; log anything else
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) {
        console.warn(`[EnsureTables] Failed to add wallets.${col.name}: ${msg}`);
      }
    }
  }

  console.log('[EnsureTables] Wallet accumulative columns ready');
}
