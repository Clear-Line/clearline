-- User market watchlist
-- Users star individual prediction markets from the constellation map.
-- Starred markets get a subtle marker on the map and feed the alert worker.

CREATE TABLE IF NOT EXISTS user_market_watchlist (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id VARCHAR(128) NOT NULL, -- Polymarket condition_id
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_user_market_watchlist_user_id
  ON user_market_watchlist(user_id);

-- Critical for the alert worker, which scans WHERE market_id = ? to find
-- everyone watching a given market.
CREATE INDEX IF NOT EXISTS idx_user_market_watchlist_market_id
  ON user_market_watchlist(market_id);
