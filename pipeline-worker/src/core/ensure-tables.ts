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

  // ─── Crypto derivatives table ───
  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.crypto_derivatives\` (
      id STRING NOT NULL,
      asset STRING NOT NULL,
      funding_rate FLOAT64,
      funding_rate_timestamp TIMESTAMP,
      spot_price FLOAT64,
      cvd_1h FLOAT64,
      cvd_4h FLOAT64,
      cvd_raw_buy_vol FLOAT64,
      cvd_raw_sell_vol FLOAT64,
      options_skew FLOAT64,
      oi_change_pct FLOAT64,
      liquidation_ratio FLOAT64,
      fetched_at TIMESTAMP
    )
    CLUSTER BY asset
  `);

  // ─── Crypto signals table ───
  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.crypto_signals\` (
      id STRING NOT NULL,
      asset STRING NOT NULL,
      timeframe STRING NOT NULL,
      polymarket_prob FLOAT64,
      polymarket_market_id STRING,
      polymarket_question STRING,
      derivatives_prob FLOAT64,
      sds FLOAT64,
      sds_direction STRING,
      signal_funding_rate FLOAT64,
      signal_cvd FLOAT64,
      signal_options_skew FLOAT64,
      signal_oi FLOAT64,
      signal_liquidation FLOAT64,
      signals_active INT64,
      signals_agreeing INT64,
      agreement_score FLOAT64,
      confidence STRING,
      spot_price FLOAT64,
      window_end TIMESTAMP,
      computed_at TIMESTAMP
    )
    CLUSTER BY asset
  `);

  console.log('[EnsureTables] Crypto tables ready');

  // Add open_interest_raw column (idempotent)
  try {
    await bq.rawQuery(
      `ALTER TABLE \`${dataset}.crypto_derivatives\` ADD COLUMN IF NOT EXISTS open_interest_raw FLOAT64`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('already exists')) {
      console.warn(`[EnsureTables] Failed to add crypto_derivatives.open_interest_raw: ${msg}`);
    }
  }
}
