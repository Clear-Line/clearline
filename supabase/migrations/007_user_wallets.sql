-- Personal wallet linking: a Clearline user can attach one or more Polygon
-- addresses to their account to see their positions on the constellation map.
-- Paste-address only — no cryptographic ownership verification, since all
-- Polymarket data is already public.

CREATE TABLE IF NOT EXISTS user_wallets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_address VARCHAR(42) NOT NULL,   -- lowercased 0x-prefixed hex
  label VARCHAR(64),                      -- optional user nickname
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_address ON user_wallets(wallet_address);
