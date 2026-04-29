/**
 * Case Study Core — shared logic for the build-case-study CLI.
 *
 * Exports:
 *   - loadSnapshotSeries: load frozen snapshot rows for a set of markets in a window
 *   - loadMarketMetadata: fetch title/category for a set of market ids
 *   - loadEdgeNeighbors: find markets connected to a trigger via market_edges
 *   - computeLaggedCorrelation: Pearson corr with best-fit lag search
 *   - computeImpact: price_delta and volume_delta_pct around a pivot timestamp
 *   - rankAffected: sort + cap to top N
 *   - writeStudy: insert rows into case_studies + case_study_series + case_study_markets
 */

import { bq } from '../../core/bigquery.js';

// ─── Types ───

export type StudyType = 'volume_shock' | 'external_event' | 'calendar' | 'resolution';

export interface SnapshotRow {
  market_id: string;
  timestamp: string;
  yes_price: number | null;
  volume_24h: number | null;
  liquidity: number | null;
}

export interface MarketMeta {
  condition_id: string;
  question: string;
  category: string;
}

export interface AffectedMarket {
  market_id: string;
  market_title: string;
  category: string;
  role: 'trigger' | 'anchor' | 'affected';
  lag_hours: number | null;
  price_delta: number | null;
  volume_delta_pct: number | null;
  lagged_correlation: number | null;
  best_lag_hours: number | null;
  rank: number;
}

export interface StudyMeta {
  slug: string;
  title: string;
  study_type: StudyType;
  trigger_timestamp: string;          // ISO
  trigger_market_id: string | null;
  trigger_market_title: string | null;
  external_headline: string | null;
  external_source_url: string | null;
  calendar_event_name: string | null;
  window_start: string;                // ISO
  window_end: string;                  // ISO
  evidence_stat: string | null;
  narrative_md: string | null;
  affected_count: number;
  max_lag_hours: number | null;
  published: boolean;
}

// ─── Snapshot loading ───

/**
 * Load raw market_snapshots rows for a set of markets in [start, end].
 * Returns one row per (market, timestamp) sorted by timestamp ascending.
 */
export async function loadSnapshotSeries(
  marketIds: string[],
  windowStart: string,
  windowEnd: string,
): Promise<SnapshotRow[]> {
  if (marketIds.length === 0) return [];

  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const { data, error } = await bq.rawQuery<SnapshotRow>(
    `
    SELECT
      market_id,
      timestamp,
      yes_price,
      volume_24h,
      liquidity
    FROM \`${dataset}.market_snapshots\`
    WHERE market_id IN UNNEST(@ids)
      AND timestamp BETWEEN TIMESTAMP(@start) AND TIMESTAMP(@end)
    ORDER BY market_id, timestamp
    `,
    { ids: marketIds, start: windowStart, end: windowEnd },
  );

  if (error) throw new Error(`loadSnapshotSeries: ${error.message}`);
  return data ?? [];
}

// ─── Market metadata ───

export async function loadMarketMetadata(marketIds: string[]): Promise<Map<string, MarketMeta>> {
  const map = new Map<string, MarketMeta>();
  if (marketIds.length === 0) return map;

  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const { data, error } = await bq.rawQuery<MarketMeta>(
    `
    SELECT condition_id, question, category
    FROM \`${dataset}.markets\`
    WHERE condition_id IN UNNEST(@ids)
    `,
    { ids: marketIds },
  );

  if (error) throw new Error(`loadMarketMetadata: ${error.message}`);
  for (const m of data ?? []) {
    map.set(m.condition_id, {
      condition_id: m.condition_id,
      question: m.question ?? '(unknown)',
      category: m.category ?? 'other',
    });
  }
  return map;
}

// ─── Edge neighbors (for volume_shock + resolution modes) ───

export async function loadEdgeNeighbors(marketId: string): Promise<string[]> {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const { data, error } = await bq.rawQuery<{ neighbor: string }>(
    `
    SELECT market_b AS neighbor
    FROM \`${dataset}.market_edges\`
    WHERE market_a = @id
    UNION DISTINCT
    SELECT market_a AS neighbor
    FROM \`${dataset}.market_edges\`
    WHERE market_b = @id
    `,
    { id: marketId },
  );
  if (error) throw new Error(`loadEdgeNeighbors: ${error.message}`);
  return (data ?? []).map((r) => r.neighbor);
}

// ─── Wide universe (for external-event --universe wide) ───

/**
 * Load every market with meaningful snapshot activity inside the study window.
 * Used when we want to discover connections fresh from price co-movement
 * instead of reading them from `market_edges`. `minAvgVolume` filters out
 * dead books so we don't correlate against flat-priced dust markets.
 */
export async function loadActiveMarketsInWindow(
  windowStart: string,
  windowEnd: string,
  minAvgVolume: number,
  maxMarkets: number = 5000,
): Promise<string[]> {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const { data, error } = await bq.rawQuery<{ market_id: string }>(
    `
    SELECT market_id, AVG(volume_24h) AS avg_volume
    FROM \`${dataset}.market_snapshots\`
    WHERE timestamp BETWEEN TIMESTAMP(@start) AND TIMESTAMP(@end)
    GROUP BY market_id
    HAVING avg_volume >= @minVol
    ORDER BY avg_volume DESC
    LIMIT @maxMarkets
    `,
    { start: windowStart, end: windowEnd, minVol: minAvgVolume, maxMarkets },
  );
  if (error) throw new Error(`loadActiveMarketsInWindow: ${error.message}`);
  return (data ?? []).map((r) => r.market_id);
}

// ─── Top calendar candidates (for calendar mode) ───

export async function loadTopMarketsInWindow(
  category: string | null,
  windowStart: string,
  windowEnd: string,
  topN: number,
): Promise<string[]> {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const categoryFilter = category ? 'AND m.category = @category' : '';
  const { data, error } = await bq.rawQuery<{ market_id: string }>(
    `
    SELECT
      s.market_id,
      AVG(s.volume_24h) AS avg_volume
    FROM \`${dataset}.market_snapshots\` s
    JOIN \`${dataset}.markets\` m ON m.condition_id = s.market_id
    WHERE s.timestamp BETWEEN TIMESTAMP(@start) AND TIMESTAMP(@end)
      ${categoryFilter}
    GROUP BY s.market_id
    HAVING avg_volume > 0
    ORDER BY avg_volume DESC
    LIMIT @topN
    `,
    category
      ? { start: windowStart, end: windowEnd, topN, category }
      : { start: windowStart, end: windowEnd, topN },
  );
  if (error) throw new Error(`loadTopMarketsInWindow: ${error.message}`);
  return (data ?? []).map((r) => r.market_id);
}

// ─── Correlation math ───

/**
 * Align two series by nearest-timestamp matching and return parallel arrays.
 * Snapshots are ~hourly, so we match by hour bucket.
 */
function alignByHour(
  a: SnapshotRow[],
  b: SnapshotRow[],
): { ax: number[]; bx: number[]; timestamps: number[] } {
  const bucket = (iso: string) => {
    const d = new Date(iso);
    return Math.floor(d.getTime() / (60 * 60 * 1000));
  };
  const aMap = new Map<number, number>();
  for (const row of a) {
    if (row.yes_price == null) continue;
    aMap.set(bucket(row.timestamp), row.yes_price);
  }
  const ax: number[] = [];
  const bx: number[] = [];
  const timestamps: number[] = [];
  for (const row of b) {
    if (row.yes_price == null) continue;
    const t = bucket(row.timestamp);
    const av = aMap.get(t);
    if (av != null) {
      ax.push(av);
      bx.push(row.yes_price);
      timestamps.push(t);
    }
  }
  return { ax, bx, timestamps };
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3) return null;
  const n = xs.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return null;
  return num / denom;
}

/**
 * Compute Pearson correlation between trigger series and candidate series
 * at several time offsets. Returns the offset (in hours) that maximizes |corr|.
 */
const LAG_OFFSETS_HOURS = [0, 1, 2, 4, 6, 12, 24];

export function computeLaggedCorrelation(
  trigger: SnapshotRow[],
  candidate: SnapshotRow[],
): { bestLag: number; bestCorr: number } | null {
  let best: { bestLag: number; bestCorr: number } | null = null;

  for (const lag of LAG_OFFSETS_HOURS) {
    // Shift candidate backwards by `lag` hours so the same hour bucket aligns
    // "candidate at t+lag" with "trigger at t". This models "trigger moved, then
    // candidate reacted `lag` hours later".
    const shifted = candidate.map((row) => ({
      ...row,
      timestamp: new Date(new Date(row.timestamp).getTime() - lag * 60 * 60 * 1000).toISOString(),
    }));
    const { ax, bx } = alignByHour(trigger, shifted);
    const corr = pearson(ax, bx);
    if (corr == null) continue;
    if (best == null || Math.abs(corr) > Math.abs(best.bestCorr)) {
      best = { bestLag: lag, bestCorr: corr };
    }
  }
  return best;
}

// ─── Impact metrics ───

export function computeImpact(
  series: SnapshotRow[],
  pivotISO: string,
  halfWindowHours: number = 6,
): { priceDelta: number | null; volumeDeltaPct: number | null } {
  const pivot = new Date(pivotISO).getTime();
  const halfMs = halfWindowHours * 60 * 60 * 1000;

  let preP = 0, preC = 0, postP = 0, postC = 0;
  let preV = 0, preVC = 0, postV = 0, postVC = 0;

  for (const row of series) {
    const t = new Date(row.timestamp).getTime();
    if (row.yes_price != null) {
      if (t >= pivot - halfMs && t < pivot) { preP += row.yes_price; preC++; }
      else if (t >= pivot && t <= pivot + halfMs) { postP += row.yes_price; postC++; }
    }
    if (row.volume_24h != null) {
      if (t >= pivot - halfMs && t < pivot) { preV += row.volume_24h; preVC++; }
      else if (t >= pivot && t <= pivot + halfMs) { postV += row.volume_24h; postVC++; }
    }
  }

  const priceDelta = preC > 0 && postC > 0 ? postP / postC - preP / preC : null;
  const volumeDeltaPct =
    preVC > 0 && postVC > 0 && preV > 0 ? postV / postVC / (preV / preVC) - 1 : null;
  return { priceDelta, volumeDeltaPct };
}

// ─── Ranking ───

export function rankAffected(markets: AffectedMarket[], topN: number = 20): AffectedMarket[] {
  const scored = markets
    .filter((m) => m.role !== 'trigger')
    .map((m) => {
      const corr = Math.abs(m.lagged_correlation ?? 0);
      const volMag = Math.log(1 + Math.abs(m.volume_delta_pct ?? 0));
      const score = corr * (1 + volMag);
      return { m, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return scored.map((s, i) => ({ ...s.m, rank: i + 1 }));
}

// ─── Writers ───

/**
 * Write a complete case study in one transaction-ish batch:
 *   1. delete any existing rows for this slug (idempotent rebuild)
 *   2. insert case_studies row
 *   3. insert case_study_series rows (frozen time-series)
 *   4. insert case_study_markets rows
 */
export async function writeStudy(
  meta: StudyMeta,
  series: SnapshotRow[],
  markets: AffectedMarket[],
): Promise<void> {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const now = new Date().toISOString();

  // 1. Clean up any prior rows for this slug (rerunning the script rebuilds cleanly)
  await bq.rawQuery(`DELETE FROM \`${dataset}.case_study_series\` WHERE slug = @slug`, { slug: meta.slug });
  await bq.rawQuery(`DELETE FROM \`${dataset}.case_study_markets\` WHERE slug = @slug`, { slug: meta.slug });
  await bq.rawQuery(`DELETE FROM \`${dataset}.case_studies\` WHERE slug = @slug`, { slug: meta.slug });

  // 2. case_studies row
  const studyRow = {
    slug: meta.slug,
    title: meta.title,
    study_type: meta.study_type,
    trigger_timestamp: meta.trigger_timestamp,
    trigger_market_id: meta.trigger_market_id,
    trigger_market_title: meta.trigger_market_title,
    external_headline: meta.external_headline,
    external_source_url: meta.external_source_url,
    calendar_event_name: meta.calendar_event_name,
    window_start: meta.window_start,
    window_end: meta.window_end,
    evidence_stat: meta.evidence_stat,
    narrative_md: meta.narrative_md,
    affected_count: meta.affected_count,
    max_lag_hours: meta.max_lag_hours,
    published: meta.published,
    created_at: now,
    updated_at: now,
  };
  const { error: studyErr } = await bq.from('case_studies').insert(studyRow);
  if (studyErr) throw new Error(`writeStudy (case_studies): ${studyErr.message}`);

  // 3. frozen series
  if (series.length > 0) {
    const seriesRows = series.map((s) => ({
      slug: meta.slug,
      market_id: s.market_id,
      timestamp: s.timestamp,
      yes_price: s.yes_price,
      volume_24h: s.volume_24h,
      liquidity: s.liquidity,
    }));
    const { error: seriesErr } = await bq.from('case_study_series').insert(seriesRows);
    if (seriesErr) throw new Error(`writeStudy (case_study_series): ${seriesErr.message}`);
  }

  // 4. ranked markets
  if (markets.length > 0) {
    const { error: marketsErr } = await bq.from('case_study_markets').insert(
      markets.map((m) => ({
        slug: meta.slug,
        market_id: m.market_id,
        market_title: m.market_title,
        category: m.category,
        role: m.role,
        lag_hours: m.lag_hours,
        price_delta: m.price_delta,
        volume_delta_pct: m.volume_delta_pct,
        lagged_correlation: m.lagged_correlation,
        best_lag_hours: m.best_lag_hours,
        rank: m.rank,
      })),
    );
    if (marketsErr) throw new Error(`writeStudy (case_study_markets): ${marketsErr.message}`);
  }
}

// ─── Evidence stat templates ───

export function buildEvidenceStat(
  type: StudyType,
  affectedCount: number,
  maxLag: number | null,
  avgLag: number | null,
): string {
  switch (type) {
    case 'volume_shock':
      return maxLag != null && avgLag != null
        ? `${affectedCount} correlated markets reacted within ${maxLag.toFixed(0)}h (avg lag ${avgLag.toFixed(1)}h)`
        : `${affectedCount} correlated markets reacted`;
    case 'external_event':
      return avgLag != null
        ? `${affectedCount} markets moved, avg lag ${avgLag.toFixed(1)}h after the headline`
        : `${affectedCount} markets moved after the headline`;
    case 'calendar':
      return `${affectedCount} markets tracked across the event window`;
    case 'resolution':
      return avgLag != null
        ? `${affectedCount} correlated markets showed signal ${avgLag.toFixed(1)}h before resolution`
        : `${affectedCount} correlated markets showed anticipatory signal`;
  }
}
