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

  // ─── BTC market cycles (accuracy tracking — permanent, no purge) ───
  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.btc_market_cycles\` (
      id STRING NOT NULL,
      condition_id STRING NOT NULL,
      timeframe STRING NOT NULL,
      question STRING,
      window_start TIMESTAMP,
      window_end TIMESTAMP NOT NULL,
      initial_polymarket_prob FLOAT64,
      initial_derivatives_prob FLOAT64,
      initial_sds FLOAT64,
      initial_sds_direction STRING,
      initial_confidence STRING,
      initial_spot_price FLOAT64,
      signal_captured_at TIMESTAMP,
      is_resolved BOOL,
      resolution_outcome STRING,
      resolved_at TIMESTAMP,
      clearline_predicted_up BOOL,
      polymarket_predicted_up BOOL,
      clearline_correct BOOL,
      polymarket_correct BOOL,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    )
    CLUSTER BY timeframe
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

  // Add ML prediction columns to crypto_signals (idempotent)
  for (const col of [
    { name: 'ml_prob', type: 'FLOAT64' },
    { name: 'ml_features_computed', type: 'BOOL' },
  ]) {
    try {
      await bq.rawQuery(
        `ALTER TABLE \`${dataset}.crypto_signals\` ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) {
        console.warn(`[EnsureTables] Failed to add crypto_signals.${col.name}: ${msg}`);
      }
    }
  }

  // ─── Pipeline metadata (key-value store for chain listener state) ───
  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.pipeline_metadata\` (
      key STRING NOT NULL,
      value STRING,
      updated_at TIMESTAMP
    )
    CLUSTER BY key
  `);

  console.log('[EnsureTables] Pipeline metadata table ready');

  // ─── Wallet trade positions (accumulated from chain listener, NOT purged) ───
  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.wallet_trade_positions\` (
      wallet_address STRING NOT NULL,
      market_id STRING NOT NULL,
      outcome STRING,
      buy_volume FLOAT64,
      sell_volume FLOAT64,
      avg_buy_price FLOAT64,
      buy_count INT64,
      sell_count INT64,
      last_trade_at TIMESTAMP,
      updated_at TIMESTAMP
    )
    CLUSTER BY market_id, wallet_address
  `);

  console.log('[EnsureTables] Wallet trade positions table ready');

  // ─── Market edges (constellation map — pairwise market relationships) ───
  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.market_edges\` (
      market_a STRING NOT NULL,
      market_b STRING NOT NULL,
      wallet_overlap FLOAT64,
      shared_wallets INT64,
      price_corr FLOAT64,
      corr_samples INT64,
      combined_weight FLOAT64,
      updated_at TIMESTAMP
    )
    CLUSTER BY market_a
  `);

  console.log('[EnsureTables] Market edges table ready');

  // ─── Case studies (permanent, frozen at creation — no purge) ───
  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.case_studies\` (
      slug STRING NOT NULL,
      title STRING NOT NULL,
      study_type STRING NOT NULL,
      trigger_timestamp TIMESTAMP NOT NULL,
      trigger_market_id STRING,
      trigger_market_title STRING,
      external_headline STRING,
      external_source_url STRING,
      calendar_event_name STRING,
      window_start TIMESTAMP NOT NULL,
      window_end TIMESTAMP NOT NULL,
      evidence_stat STRING,
      narrative_md STRING,
      affected_count INT64,
      max_lag_hours FLOAT64,
      published BOOL,
      created_at TIMESTAMP,
      updated_at TIMESTAMP
    )
    CLUSTER BY slug
  `);

  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.case_study_series\` (
      slug STRING NOT NULL,
      market_id STRING NOT NULL,
      timestamp TIMESTAMP NOT NULL,
      yes_price FLOAT64,
      volume_24h FLOAT64,
      liquidity FLOAT64
    )
    CLUSTER BY slug, market_id
  `);

  await bq.rawQuery(`
    CREATE TABLE IF NOT EXISTS \`${dataset}.case_study_markets\` (
      slug STRING NOT NULL,
      market_id STRING NOT NULL,
      market_title STRING,
      category STRING,
      role STRING,
      lag_hours FLOAT64,
      price_delta FLOAT64,
      volume_delta_pct FLOAT64,
      lagged_correlation FLOAT64,
      best_lag_hours FLOAT64,
      rank INT64
    )
    CLUSTER BY slug
  `);

  console.log('[EnsureTables] Case studies tables ready');
}
