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
}
