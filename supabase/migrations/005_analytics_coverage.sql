-- 005_analytics_coverage.sql
-- Adds coverage metadata columns to market_analytics for data quality gating.
-- These columns enable the publishability system that prevents exposing
-- incomplete analytics to the frontend.

-- Coverage metadata columns
ALTER TABLE market_analytics ADD COLUMN IF NOT EXISTS is_publishable BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE market_analytics ADD COLUMN IF NOT EXISTS coverage_score NUMERIC(5,2) DEFAULT 0;
ALTER TABLE market_analytics ADD COLUMN IF NOT EXISTS missing_dependencies JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE market_analytics ADD COLUMN IF NOT EXISTS coverage_by_metric JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Index for fast filtering of publishable rows
CREATE INDEX IF NOT EXISTS idx_ma_publishable ON market_analytics(is_publishable) WHERE is_publishable = true;

-- Index for coverage score ordering (for dashboards)
CREATE INDEX IF NOT EXISTS idx_ma_coverage ON market_analytics(coverage_score DESC);

-- Serving view: only publishable analytics
CREATE OR REPLACE VIEW market_analytics_serving AS
  SELECT * FROM market_analytics WHERE is_publishable = true;
