-- ============================================
-- WALLET SIGNALS (Tier 1 scores per wallet-market pair)
-- ============================================
CREATE TABLE IF NOT EXISTS wallet_signals (
  id BIGSERIAL PRIMARY KEY,
  wallet_address VARCHAR(42) NOT NULL REFERENCES wallets(address),
  market_id VARCHAR(66) NOT NULL REFERENCES markets(condition_id),
  wallet_age_delta_score DECIMAL(5,4) DEFAULT 0,
  trade_concentration_score DECIMAL(5,4) DEFAULT 0,
  position_size_score DECIMAL(5,4) DEFAULT 0,
  conviction_score DECIMAL(5,4) DEFAULT 0,
  entry_timing_score DECIMAL(5,4) DEFAULT 0,
  composite_score DECIMAL(5,4) DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wallet_address, market_id)
);

CREATE INDEX IF NOT EXISTS idx_signals_composite ON wallet_signals(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_signals_wallet ON wallet_signals(wallet_address);
CREATE INDEX IF NOT EXISTS idx_signals_market ON wallet_signals(market_id);
CREATE INDEX IF NOT EXISTS idx_signals_flagged ON wallet_signals(composite_score DESC) WHERE composite_score > 0.5;
