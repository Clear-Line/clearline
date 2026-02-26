-- ============================================
-- MARKETS
-- ============================================
CREATE TABLE IF NOT EXISTS markets (
  condition_id VARCHAR(66) PRIMARY KEY,
  question TEXT NOT NULL,
  slug VARCHAR(255),
  event_id VARCHAR(66),
  category VARCHAR(100),
  outcomes JSONB NOT NULL DEFAULT '["Yes", "No"]',
  clob_token_ids JSONB NOT NULL DEFAULT '[]',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  is_resolved BOOLEAN DEFAULT FALSE,
  resolved_outcome VARCHAR(50),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_active ON markets(is_active);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_markets_event ON markets(event_id);

-- ============================================
-- MARKET SNAPSHOTS (time-series)
-- ============================================
CREATE TABLE IF NOT EXISTS market_snapshots (
  id BIGSERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  yes_price DECIMAL(8,6) NOT NULL,
  no_price DECIMAL(8,6) NOT NULL,
  volume_24h DECIMAL(16,2),
  total_volume DECIMAL(16,2),
  liquidity DECIMAL(16,2),
  spread DECIMAL(8,6),
  book_depth_bid_5c DECIMAL(16,2),
  book_depth_ask_5c DECIMAL(16,2),
  unique_traders_24h INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_market_time ON market_snapshots(market_id, timestamp DESC);

-- ============================================
-- TRADES
-- ============================================
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  wallet_address VARCHAR(42) NOT NULL,
  side VARCHAR(4) NOT NULL,
  size_tokens DECIMAL(20,6) NOT NULL,
  size_usdc DECIMAL(16,2) NOT NULL,
  price DECIMAL(8,6) NOT NULL,
  outcome VARCHAR(50) NOT NULL,
  outcome_index INTEGER NOT NULL,
  transaction_hash VARCHAR(66) UNIQUE,
  timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_market_time ON trades(market_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_wallet ON trades(wallet_address, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_market_wallet ON trades(market_id, wallet_address);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);

-- ============================================
-- WALLETS
-- ============================================
CREATE TABLE IF NOT EXISTS wallets (
  address VARCHAR(42) PRIMARY KEY,
  first_seen_chain TIMESTAMPTZ,
  first_seen_polymarket TIMESTAMPTZ,
  total_markets_traded INTEGER DEFAULT 0,
  total_volume_usdc DECIMAL(16,2) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  accuracy_score DECIMAL(5,4),
  accuracy_sample_size INTEGER DEFAULT 0,
  username VARCHAR(255),
  pseudonym VARCHAR(255),
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_accuracy ON wallets(accuracy_score DESC) WHERE accuracy_sample_size >= 5;

-- ============================================
-- FLAGGED MOVES
-- ============================================
CREATE TABLE IF NOT EXISTS flagged_moves (
  id BIGSERIAL PRIMARY KEY,
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  detection_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  move_start_time TIMESTAMPTZ NOT NULL,
  move_end_time TIMESTAMPTZ NOT NULL,
  price_start DECIMAL(8,6) NOT NULL,
  price_end DECIMAL(8,6) NOT NULL,
  price_delta DECIMAL(8,6) NOT NULL,
  total_volume_usdc DECIMAL(16,2) NOT NULL,
  unique_wallets INTEGER NOT NULL,
  wallet_concentration_top1 DECIMAL(5,4),
  wallet_concentration_top3 DECIMAL(5,4),
  wallet_concentration_top5 DECIMAL(5,4),
  flagged_wallet_count INTEGER DEFAULT 0,
  cluster_score DECIMAL(8,2),
  book_depth_at_start DECIMAL(16,2),
  confidence_score INTEGER NOT NULL,
  informed_activity_index INTEGER NOT NULL,
  catalyst_type VARCHAR(20),
  catalyst_description TEXT,
  signal_direction VARCHAR(5),
  summary_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flagged_market_time ON flagged_moves(market_id, detection_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_flagged_confidence ON flagged_moves(confidence_score DESC);
