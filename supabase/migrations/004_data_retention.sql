-- 004_data_retention.sql
-- Automatic data retention to stay within Supabase free tier (500MB).
-- Keeps recent data for analytics, deletes old rows that are no longer useful.

-- ─── Function: cleanup_old_data ───
-- Called via API endpoint on a daily cron.

CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_snapshots    BIGINT := 0;
  deleted_trades       BIGINT := 0;
  deleted_res_trades   BIGINT := 0;
  deleted_positions    BIGINT := 0;
  deleted_correlations BIGINT := 0;
  deleted_signals      BIGINT := 0;
  deleted_moves        BIGINT := 0;
BEGIN
  -- market_snapshots: keep 3 days (analytics only needs 24h)
  WITH d AS (
    DELETE FROM market_snapshots
    WHERE "timestamp" < now() - INTERVAL '3 days'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_snapshots FROM d;

  -- trades: keep 7 days for active markets
  WITH d AS (
    DELETE FROM trades
    WHERE "timestamp" < now() - INTERVAL '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_trades FROM d;

  -- trades for resolved markets: accuracy already computed, no longer needed
  WITH d AS (
    DELETE FROM trades
    WHERE market_id IN (
      SELECT condition_id FROM markets WHERE is_resolved = true
    )
    RETURNING 1
  )
  SELECT count(*) INTO deleted_res_trades FROM d;

  -- wallet_positions: keep 3 days
  WITH d AS (
    DELETE FROM wallet_positions
    WHERE snapshot_time < now() - INTERVAL '3 days'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_positions FROM d;

  -- market_correlations: keep latest computation only (delete > 14 days)
  WITH d AS (
    DELETE FROM market_correlations
    WHERE computed_at < now() - INTERVAL '14 days'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_correlations FROM d;

  -- wallet_signals: keep 3 days
  WITH d AS (
    DELETE FROM wallet_signals
    WHERE computed_at < now() - INTERVAL '3 days'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_signals FROM d;

  -- flagged_moves: keep 14 days
  WITH d AS (
    DELETE FROM flagged_moves
    WHERE detection_timestamp < now() - INTERVAL '14 days'
    RETURNING 1
  )
  SELECT count(*) INTO deleted_moves FROM d;

  RETURN jsonb_build_object(
    'deleted_snapshots', deleted_snapshots,
    'deleted_trades', deleted_trades,
    'deleted_resolved_trades', deleted_res_trades,
    'deleted_positions', deleted_positions,
    'deleted_correlations', deleted_correlations,
    'deleted_signals', deleted_signals,
    'deleted_moves', deleted_moves
  );
END;
$$;
