-- Run this in BigQuery console to create all tables.
-- Make sure you've already created the dataset "clearline_terminal" in your GCP project.
-- (BigQuery Console > Create Dataset > Dataset ID: clearline_terminal)

-- 1. market_snapshots — partitioned by day, clustered on market_id
CREATE TABLE IF NOT EXISTS clearline_terminal.market_snapshots (
  market_id STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  yes_price FLOAT64,
  no_price FLOAT64,
  volume_24h FLOAT64,
  total_volume FLOAT64,
  liquidity FLOAT64,
  spread FLOAT64,
  book_depth_bid_5c FLOAT64,
  book_depth_ask_5c FLOAT64,
  book_imbalance FLOAT64,
  cost_move_up_5pct FLOAT64,
  cost_move_down_5pct FLOAT64,
  unique_traders_24h INT64
)
PARTITION BY DATE(timestamp)
CLUSTER BY market_id;

-- 2. trades — partitioned by day, clustered on market_id + wallet_address
CREATE TABLE IF NOT EXISTS clearline_terminal.trades (
  transaction_hash STRING NOT NULL,
  market_id STRING NOT NULL,
  wallet_address STRING NOT NULL,
  side STRING,
  size_tokens FLOAT64,
  price FLOAT64,
  size_usdc FLOAT64,
  outcome STRING,
  outcome_index INT64,
  timestamp TIMESTAMP NOT NULL
)
PARTITION BY DATE(timestamp)
CLUSTER BY market_id, wallet_address;

-- 3. wallets — clustered on address
CREATE TABLE IF NOT EXISTS clearline_terminal.wallets (
  address STRING NOT NULL,
  username STRING,
  pseudonym STRING,
  accuracy_score FLOAT64,
  accuracy_sample_size INT64,
  total_trades INT64,
  total_volume_usdc FLOAT64,
  total_markets_traded INT64,
  credibility_score FLOAT64,
  total_pnl_usdc FLOAT64,
  first_seen_polymarket TIMESTAMP,
  last_updated TIMESTAMP
)
CLUSTER BY address;

-- 4. wallet_signals — partitioned by day, clustered on wallet_address + market_id
CREATE TABLE IF NOT EXISTS clearline_terminal.wallet_signals (
  wallet_address STRING NOT NULL,
  market_id STRING NOT NULL,
  wallet_age_delta_score FLOAT64,
  trade_concentration_score FLOAT64,
  position_size_score FLOAT64,
  conviction_score FLOAT64,
  entry_timing_score FLOAT64,
  composite_score FLOAT64,
  computed_at TIMESTAMP
)
PARTITION BY DATE(computed_at)
CLUSTER BY wallet_address, market_id;

-- 5. market_analytics — clustered on market_id
CREATE TABLE IF NOT EXISTS clearline_terminal.market_analytics (
  market_id STRING NOT NULL,
  momentum_1h FLOAT64,
  momentum_6h FLOAT64,
  momentum_24h FLOAT64,
  volatility_24h FLOAT64,
  convergence_speed FLOAT64,
  price_reversion_rate FLOAT64,
  vwap_24h FLOAT64,
  buy_sell_ratio FLOAT64,
  smart_money_flow FLOAT64,
  book_imbalance FLOAT64,
  liquidity_asymmetry FLOAT64,
  is_publishable BOOL,
  coverage_score FLOAT64,
  coverage_by_metric STRING,
  missing_dependencies STRING,
  computed_at TIMESTAMP
)
CLUSTER BY market_id;

-- 6. wallet_positions — clustered on market_id + wallet_address
CREATE TABLE IF NOT EXISTS clearline_terminal.wallet_positions (
  wallet_address STRING NOT NULL,
  market_id STRING NOT NULL,
  outcome STRING,
  position_size FLOAT64,
  entry_price FLOAT64,
  snapshot_time TIMESTAMP
)
CLUSTER BY market_id, wallet_address;

-- 7. flagged_moves — clustered on market_id
CREATE TABLE IF NOT EXISTS clearline_terminal.flagged_moves (
  market_id STRING NOT NULL,
  detection_timestamp TIMESTAMP,
  move_start_time TIMESTAMP,
  move_end_time TIMESTAMP,
  price_start FLOAT64,
  price_end FLOAT64,
  price_delta FLOAT64,
  total_volume_usdc FLOAT64,
  unique_wallets INT64,
  wallet_concentration_top1 FLOAT64,
  wallet_concentration_top3 FLOAT64,
  wallet_concentration_top5 FLOAT64,
  flagged_wallet_count INT64,
  cluster_score INT64,
  book_depth_at_start FLOAT64,
  confidence_score INT64,
  informed_activity_index INT64,
  catalyst_type STRING,
  catalyst_description STRING,
  signal_direction STRING,
  summary_text STRING
)
CLUSTER BY market_id;

-- 8. market_correlations — clustered on market_id_a + market_id_b
CREATE TABLE IF NOT EXISTS clearline_terminal.market_correlations (
  market_id_a STRING NOT NULL,
  market_id_b STRING NOT NULL,
  window_hours INT64,
  correlation FLOAT64,
  computed_at TIMESTAMP
)
CLUSTER BY market_id_a, market_id_b;
