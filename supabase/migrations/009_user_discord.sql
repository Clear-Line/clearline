-- User Discord linkage + watchlist alert log
--
-- The Clearline product runs ONE Discord server with a shared #alerts channel.
-- Users join the server, link their Discord identity via OAuth2 `identify` scope
-- once, and the pipeline worker @mentions their stored snowflake when
-- watchlisted markets move. No bot token, no per-user webhooks.

CREATE TABLE IF NOT EXISTS user_discord (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  discord_user_id VARCHAR(32) NOT NULL,       -- Discord snowflake
  discord_username VARCHAR(64),
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  min_price_move NUMERIC NOT NULL DEFAULT 0.05,
  window_hours INT NOT NULL DEFAULT 24,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_discord_discord_user_id
  ON user_discord(discord_user_id);

-- Deduplication log: prevents re-alerting the same user about the same market
-- while still allowing fresh alerts when the price drifts back.
CREATE TABLE IF NOT EXISTS user_market_alert_log (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_id VARCHAR(128) NOT NULL,
  alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  price_at_alert NUMERIC NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alert_log_user_market
  ON user_market_alert_log(user_id, market_id, alerted_at DESC);
