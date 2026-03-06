-- 003_analytics_tables.sql
-- Adds analytics infrastructure: market_analytics, wallet_positions, market_correlations
-- plus new columns on markets, market_snapshots, and wallets.

-- ─── New columns on existing tables ───

ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolution_outcome TEXT;

ALTER TABLE market_snapshots ADD COLUMN IF NOT EXISTS cost_move_up_5pct REAL;
ALTER TABLE market_snapshots ADD COLUMN IF NOT EXISTS cost_move_down_5pct REAL;
ALTER TABLE market_snapshots ADD COLUMN IF NOT EXISTS book_imbalance REAL;

ALTER TABLE wallets ADD COLUMN IF NOT EXISTS credibility_score REAL;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS total_pnl_usdc REAL;

-- ─── market_analytics ───
-- Precomputed per-market quantitative metrics, refreshed every ~15 min.

CREATE TABLE IF NOT EXISTS market_analytics (
  market_id        TEXT        NOT NULL REFERENCES markets(condition_id),
  computed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Price behavior
  momentum_1h           REAL,
  momentum_6h           REAL,
  momentum_24h          REAL,
  volatility_24h        REAL,   -- realized vol (prediction-market VIX)
  convergence_speed     REAL,
  price_reversion_rate  REAL,

  -- Volume / flow
  vwap_24h              REAL,
  buy_sell_ratio        REAL,
  smart_money_flow      REAL,   -- net USD flow from wallets with accuracy > 70%

  -- Order book
  book_imbalance        REAL,   -- bid_depth / (bid_depth + ask_depth)
  liquidity_asymmetry   REAL,   -- cost_up / cost_down ratio

  PRIMARY KEY (market_id)
);

-- ─── wallet_positions ───
-- Periodic position snapshots for flagged / whale wallets.

DROP TABLE IF EXISTS wallet_positions;
CREATE TABLE wallet_positions (
  id              BIGSERIAL   PRIMARY KEY,
  wallet_address  TEXT        NOT NULL,
  market_id       TEXT        NOT NULL,
  position_size   REAL        NOT NULL,
  outcome         TEXT        NOT NULL,
  snapshot_time   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_wallet ON wallet_positions(wallet_address, market_id);
CREATE INDEX IF NOT EXISTS idx_wp_time   ON wallet_positions(snapshot_time);

-- ─── market_correlations ───
-- Pairwise price correlations between related markets (computed weekly).

CREATE TABLE IF NOT EXISTS market_correlations (
  market_id_a   TEXT NOT NULL,
  market_id_b   TEXT NOT NULL,
  correlation   REAL NOT NULL,
  window_hours  INT  NOT NULL DEFAULT 168,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (market_id_a, market_id_b, window_hours)
);
