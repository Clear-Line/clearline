-- ============================================================
-- SPRINT 0: Data Validation Queries
-- Run these in BigQuery console to validate data richness
-- Replace PROJECT_ID.polymarket with your actual dataset path
-- ============================================================

-- ── Query 0.1: Count wallets with positions in 2+ active markets ──
-- GO: >= 200 wallets | NO-GO: < 50
SELECT COUNT(*) AS multi_market_wallets
FROM (
  SELECT wtp.wallet_address
  FROM `PROJECT_ID.polymarket.wallet_trade_positions` wtp
  JOIN `PROJECT_ID.polymarket.markets` m
    ON m.condition_id = wtp.market_id
  WHERE m.is_active = true AND m.is_resolved = false
  GROUP BY wtp.wallet_address
  HAVING COUNT(DISTINCT wtp.market_id) >= 2
);


-- ── Query 0.2: Top 50 market pairs by shared wallets ──
-- GO: >= 100 pairs with 3+ shared wallets
-- Also note "Bytes processed" in BigQuery console (must be < 500 MB)
WITH active_positions AS (
  SELECT wtp.wallet_address, wtp.market_id
  FROM `PROJECT_ID.polymarket.wallet_trade_positions` wtp
  JOIN `PROJECT_ID.polymarket.markets` m
    ON m.condition_id = wtp.market_id
  WHERE m.is_active = true AND m.is_resolved = false
),
multi_wallets AS (
  SELECT wallet_address
  FROM active_positions
  GROUP BY wallet_address
  HAVING COUNT(DISTINCT market_id) >= 2
),
filtered AS (
  SELECT ap.wallet_address, ap.market_id
  FROM active_positions ap
  JOIN multi_wallets mw ON mw.wallet_address = ap.wallet_address
)
SELECT
  a.market_id AS market_a,
  b.market_id AS market_b,
  COUNT(DISTINCT a.wallet_address) AS shared_wallets
FROM filtered a
JOIN filtered b
  ON a.wallet_address = b.wallet_address
  AND a.market_id < b.market_id
GROUP BY 1, 2
HAVING shared_wallets >= 3
ORDER BY shared_wallets DESC
LIMIT 50;


-- ── Query 0.3: Estimate 30-day snapshot storage ──
-- GO: projected 30-day storage < 500 MB
-- Multiply row_count by 10 (3 days → 30 days) and check estimated_mb * 10
SELECT
  COUNT(*) AS row_count,
  ROUND(COUNT(*) * 120 / 1024 / 1024, 2) AS current_mb,
  ROUND(COUNT(*) * 120 / 1024 / 1024 * 10, 2) AS projected_30d_mb
FROM `PROJECT_ID.polymarket.market_snapshots`;


-- ── Query 0.4: Current snapshot time span per market ──
-- Expected: all markets have at most ~3 days of data
-- Confirms the 14-day accumulation delay for price correlation
SELECT
  market_id,
  COUNT(*) AS snap_count,
  TIMESTAMP_DIFF(MAX(timestamp), MIN(timestamp), DAY) AS days_span,
  MIN(timestamp) AS earliest,
  MAX(timestamp) AS latest
FROM `PROJECT_ID.polymarket.market_snapshots`
GROUP BY market_id
ORDER BY days_span DESC
LIMIT 10;
