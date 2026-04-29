/**
 * build-analysis-md — produce a detailed per-study markdown analysis file.
 *
 * For each slug: pulls case_studies header, all case_study_markets (trigger +
 * anchors + affected), computes per-market pre/post/min/max/Δ stats from
 * case_study_series, then computes pairwise Pearson correlations across every
 * market in the study and flags structurally-interesting pairs:
 *
 *   • SUM > 1 candidates (NO/NO mutual-exclusivity hedge structure)
 *   • SUM < 1 candidates (YES/YES implication hedge structure, tradeable
 *     prices only, |corr| ≥ 0.85)
 *
 * Writes out/analysis-<slug>.md. Read-only, no DB writes.
 *
 * Usage: tsx src/scripts/build-analysis-md.ts [slug1 slug2 ...]
 *   (no slugs → runs all 4 case studies)
 */

import { bq } from '../core/bigquery.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_SLUGS = [
  'iran-hormuz-apr-2026',
  'hungary-orban-defeat-apr-2026',
  'israel-hezbollah-ceasefire-apr-2026',
  'hormuz-multinational-mission-apr-2026',
];

// Pair flagging thresholds
const HIGH_CORR = 0.8;
const MISPRICE_DELTA = 0.02;     // |YES_A + YES_B − 1| ≥ this
const IMPLIC_MIN_CORR = 0.85;    // extra stringency for YES/YES candidates
const TRADEABLE_MIN = 0.03;
const TRADEABLE_MAX = 0.97;

interface StudyMeta {
  slug: string;
  title: string;
  study_type: string;
  trigger_timestamp: string;
  window_start: string;
  window_end: string;
  external_headline: string | null;
  external_source_url: string | null;
  trigger_market_id: string | null;
  evidence_stat: string | null;
  affected_count: number;
  max_lag_hours: number | null;
  created_at: string;
}

interface MarketRow {
  market_id: string;
  market_title: string;
  category: string | null;
  role: 'trigger' | 'anchor' | 'affected';
  rank: number;
  lag_hours: number | null;
  price_delta: number | null;
  volume_delta_pct: number | null;
  lagged_correlation: number | null;
  best_lag_hours: number | null;
}

interface SeriesPoint {
  market_id: string;
  timestamp: string;
  yes_price: number | null;
  volume_24h: number | null;
}

interface LatestPriceRow {
  market_id: string;
  yes_price: number | null;
  timestamp: string;
  resolved_at: string | null;
}

interface MarketStats {
  snapshots: number;
  firstPrice: number | null;
  lastPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  avgVolume24h: number | null;
  maxVolume24h: number | null;
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

function hourBucket(iso: string): number {
  return Math.floor(new Date(iso).getTime() / (60 * 60 * 1000));
}

function alignedPairCorr(a: SeriesPoint[], b: SeriesPoint[]): { corr: number | null; n: number } {
  const aMap = new Map<number, number>();
  for (const p of a) {
    if (p.yes_price == null) continue;
    aMap.set(hourBucket(p.timestamp), p.yes_price);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of b) {
    if (p.yes_price == null) continue;
    const v = aMap.get(hourBucket(p.timestamp));
    if (v != null) { xs.push(v); ys.push(p.yes_price); }
  }
  return { corr: pearson(xs, ys), n: xs.length };
}

function perMarketStats(series: SeriesPoint[]): MarketStats {
  if (series.length === 0) {
    return {
      snapshots: 0, firstPrice: null, lastPrice: null,
      minPrice: null, maxPrice: null, avgVolume24h: null, maxVolume24h: null,
    };
  }
  const prices = series.map((s) => s.yes_price).filter((v): v is number => v != null);
  const vols = series.map((s) => s.volume_24h).filter((v): v is number => v != null);
  return {
    snapshots: series.length,
    firstPrice: prices[0] ?? null,
    lastPrice: prices[prices.length - 1] ?? null,
    minPrice: prices.length > 0 ? Math.min(...prices) : null,
    maxPrice: prices.length > 0 ? Math.max(...prices) : null,
    avgVolume24h: vols.length > 0 ? vols.reduce((a, b) => a + b, 0) / vols.length : null,
    maxVolume24h: vols.length > 0 ? Math.max(...vols) : null,
  };
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return 'n/a';
  return `${(n * 100).toFixed(digits)}%`;
}

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null) return 'n/a';
  return n.toFixed(digits);
}

function fmtDollar(n: number | null | undefined): string {
  if (n == null) return 'n/a';
  return `$${Math.round(n).toLocaleString()}`;
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|');
}

async function buildAnalysis(slug: string): Promise<void> {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;

  // 1. Study meta
  const { data: studyRows, error: se } = await bq.rawQuery<StudyMeta>(
    `SELECT slug, title, study_type, trigger_timestamp, window_start, window_end,
       external_headline, external_source_url, trigger_market_id,
       evidence_stat, affected_count, max_lag_hours, created_at
     FROM \`${dataset}.case_studies\` WHERE slug = @slug`,
    { slug },
  );
  if (se) throw new Error(`case_studies: ${se.message}`);
  const study = studyRows?.[0];
  if (!study) { console.warn(`[${slug}] not found — skipping`); return; }

  // 2. Market roster
  const { data: marketsData, error: me } = await bq.rawQuery<MarketRow>(
    `SELECT market_id, market_title, category, role, rank,
       lag_hours, price_delta, volume_delta_pct, lagged_correlation, best_lag_hours
     FROM \`${dataset}.case_study_markets\`
     WHERE slug = @slug
     ORDER BY
       CASE role WHEN 'trigger' THEN 0 WHEN 'anchor' THEN 1 ELSE 2 END,
       rank`,
    { slug },
  );
  if (me) throw new Error(`case_study_markets: ${me.message}`);
  const markets = marketsData ?? [];
  if (markets.length < 2) { console.warn(`[${slug}] <2 markets — skipping`); return; }

  const marketIds = markets.map((m) => m.market_id);
  const titleByMarket = new Map(markets.map((m) => [m.market_id, m.market_title]));
  const roleByMarket = new Map(markets.map((m) => [m.market_id, m.role]));
  const categoryByMarket = new Map(markets.map((m) => [m.market_id, m.category ?? 'other']));

  // 3. Frozen series (full study window) for every market
  const { data: seriesData, error: seeErr } = await bq.rawQuery<SeriesPoint>(
    `SELECT market_id, timestamp, yes_price, volume_24h
     FROM \`${dataset}.case_study_series\`
     WHERE slug = @slug AND market_id IN UNNEST(@ids)
     ORDER BY market_id, timestamp`,
    { slug, ids: marketIds },
  );
  if (seeErr) throw new Error(`case_study_series: ${seeErr.message}`);
  const seriesByMarket = new Map<string, SeriesPoint[]>();
  for (const p of seriesData ?? []) {
    const arr = seriesByMarket.get(p.market_id) ?? [];
    arr.push(p);
    seriesByMarket.set(p.market_id, arr);
  }

  // 4. Latest live price (partition-filtered, resolved status)
  const { data: latestData, error: le } = await bq.rawQuery<LatestPriceRow>(
    `WITH ranked AS (
       SELECT market_id, yes_price, timestamp,
         ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY timestamp DESC) AS rn
       FROM \`${dataset}.market_snapshots\`
       WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 72 HOUR)
         AND market_id IN UNNEST(@ids)
     )
     SELECT r.market_id, r.yes_price, r.timestamp, m.resolved_at
     FROM ranked r
     LEFT JOIN \`${dataset}.markets\` m ON m.condition_id = r.market_id
     WHERE r.rn = 1`,
    { ids: marketIds },
  );
  if (le) throw new Error(`latest price: ${le.message}`);
  const latestByMarket = new Map<string, LatestPriceRow>();
  for (const p of latestData ?? []) latestByMarket.set(p.market_id, p);

  // 5. Compute per-market stats
  const statsByMarket = new Map<string, MarketStats>();
  for (const id of marketIds) {
    statsByMarket.set(id, perMarketStats(seriesByMarket.get(id) ?? []));
  }

  // 6. Pairwise correlations across all markets in the study
  interface PairRow {
    a: string; b: string;
    corr: number;
    n: number;              // aligned sample count
    yesA: number | null;
    yesB: number | null;
    sum: number | null;
  }
  const pairs: PairRow[] = [];
  for (let i = 0; i < marketIds.length; i++) {
    for (let j = i + 1; j < marketIds.length; j++) {
      const idA = marketIds[i], idB = marketIds[j];
      const sA = seriesByMarket.get(idA) ?? [];
      const sB = seriesByMarket.get(idB) ?? [];
      if (sA.length < 3 || sB.length < 3) continue;
      const { corr, n } = alignedPairCorr(sA, sB);
      if (corr == null) continue;
      const yesA = latestByMarket.get(idA)?.yes_price ?? null;
      const yesB = latestByMarket.get(idB)?.yes_price ?? null;
      const sum = yesA != null && yesB != null ? yesA + yesB : null;
      pairs.push({ a: idA, b: idB, corr, n, yesA, yesB, sum });
    }
  }

  // Classify
  const isTradeable = (p: number | null) =>
    p != null && p >= TRADEABLE_MIN && p <= TRADEABLE_MAX;
  const notResolved = (id: string) => !latestByMarket.get(id)?.resolved_at;

  const noNoPairs = pairs.filter((p) =>
    p.sum != null && p.sum - 1 >= MISPRICE_DELTA && Math.abs(p.corr) >= HIGH_CORR
    && isTradeable(p.yesA) && isTradeable(p.yesB)
    && notResolved(p.a) && notResolved(p.b),
  ).sort((a, b) => (b.sum! - 1) * Math.abs(b.corr) - (a.sum! - 1) * Math.abs(a.corr));

  const yesYesPairs = pairs.filter((p) =>
    p.sum != null && 1 - p.sum >= MISPRICE_DELTA && Math.abs(p.corr) >= IMPLIC_MIN_CORR
    && isTradeable(p.yesA) && isTradeable(p.yesB)
    && notResolved(p.a) && notResolved(p.b),
  ).sort((a, b) => (1 - a.sum!) * Math.abs(a.corr) < (1 - b.sum!) * Math.abs(b.corr) ? 1 : -1);

  // Also: high-correlation neighbors of any anchor/trigger for narrative
  const keyRoles = new Set(['anchor', 'trigger']);
  const anchorNeighbors = pairs
    .filter((p) => {
      const ra = roleByMarket.get(p.a);
      const rb = roleByMarket.get(p.b);
      return (keyRoles.has(ra ?? '') || keyRoles.has(rb ?? ''))
        && Math.abs(p.corr) >= 0.85;
    })
    .sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));

  // ─── Write markdown ───
  const lines: string[] = [];

  // Header
  lines.push(`# Case Study Analysis — ${study.title}`);
  lines.push('');
  lines.push(`> \`${slug}\``);
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()} from frozen BigQuery snapshot._`);
  lines.push('');
  lines.push('## 1. Metadata');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Slug | \`${slug}\` |`);
  lines.push(`| Type | ${study.study_type} |`);
  lines.push(`| Trigger timestamp | ${study.trigger_timestamp} |`);
  lines.push(`| Window | ${study.window_start} → ${study.window_end} |`);
  lines.push(`| Headline | ${study.external_headline ?? '(none)'} |`);
  lines.push(`| Source | ${study.external_source_url ?? '(none)'} |`);
  lines.push(`| Evidence stat | ${study.evidence_stat ?? '(none)'} |`);
  lines.push(`| Affected count | ${study.affected_count} |`);
  lines.push(`| Max lag hours | ${study.max_lag_hours ?? 'n/a'} |`);
  lines.push(`| Study built at | ${study.created_at} |`);
  lines.push('');
  lines.push('## 2. Roster summary');
  lines.push('');
  const roles = { trigger: 0, anchor: 0, affected: 0 } as Record<string, number>;
  for (const m of markets) roles[m.role] = (roles[m.role] ?? 0) + 1;
  lines.push(`- **Trigger markets:** ${roles.trigger}`);
  lines.push(`- **Anchor markets:** ${roles.anchor}`);
  lines.push(`- **Affected markets:** ${roles.affected}`);
  lines.push(`- **Total:** ${markets.length} markets across **${seriesByMarket.size}** with series`);
  const totalSeries = Array.from(seriesByMarket.values()).reduce((a, b) => a + b.length, 0);
  lines.push(`- **Total snapshots in window:** ${totalSeries.toLocaleString()}`);
  lines.push('');

  // ─── Trigger detail ───
  const trig = markets.find((m) => m.role === 'trigger');
  if (trig) {
    const s = statsByMarket.get(trig.market_id)!;
    const latest = latestByMarket.get(trig.market_id);
    lines.push('## 3. Trigger market');
    lines.push('');
    lines.push(`**${escapeMd(trig.market_title)}**`);
    lines.push(`- condition_id: \`${trig.market_id}\``);
    lines.push(`- category: ${trig.category ?? 'other'}`);
    lines.push(`- price at window start: ${fmt(s.firstPrice)}`);
    lines.push(`- price at window end: ${fmt(s.lastPrice)}`);
    lines.push(`- price range in window: [${fmt(s.minPrice)}, ${fmt(s.maxPrice)}]`);
    lines.push(`- Δprice around trigger (±6h): ${fmt(trig.price_delta)}`);
    lines.push(`- Δvolume around trigger (±6h): ${fmtPct(trig.volume_delta_pct)}`);
    lines.push(`- avg 24h volume in window: ${fmtDollar(s.avgVolume24h)}`);
    lines.push(`- peak 24h volume: ${fmtDollar(s.maxVolume24h)}`);
    lines.push(`- snapshots: ${s.snapshots}`);
    lines.push(`- latest live price: ${latest?.yes_price != null ? fmt(latest.yes_price) : 'n/a'}${latest?.resolved_at ? ` _(RESOLVED ${latest.resolved_at.slice(0, 10)})_` : ''}`);
    lines.push('');
  }

  // ─── Anchors ───
  const anchors = markets.filter((m) => m.role === 'anchor');
  if (anchors.length > 0) {
    lines.push('## 4. Anchor markets');
    lines.push('');
    lines.push('| Rank | Title | Category | First→Last | Range | Δprice (±6h) | Δvol (±6h) | Lag | Corr to trigger | Latest | Avg vol | Snaps |');
    lines.push('| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const m of anchors) {
      const s = statsByMarket.get(m.market_id)!;
      const latest = latestByMarket.get(m.market_id);
      const latestCell = latest?.resolved_at
        ? `${fmt(latest.yes_price)} (R)`
        : fmt(latest?.yes_price);
      lines.push(`| ${m.rank} | ${escapeMd(m.market_title.slice(0, 72))} | ${m.category ?? 'other'} | ${fmt(s.firstPrice)}→${fmt(s.lastPrice)} | [${fmt(s.minPrice)}, ${fmt(s.maxPrice)}] | ${fmt(m.price_delta)} | ${fmtPct(m.volume_delta_pct)} | ${m.best_lag_hours ?? 'n/a'}h | ${fmt(m.lagged_correlation)} | ${latestCell} | ${fmtDollar(s.avgVolume24h)} | ${s.snapshots} |`);
    }
    lines.push('');
  }

  // ─── Ranked affected ───
  const affected = markets.filter((m) => m.role === 'affected');
  lines.push('## 5. Ranked affected markets');
  lines.push('');
  lines.push('Ranked by `|corr| × (1 + log(1 + |Δvol|))`. All rows passed `min-snapshots`, `min-corr`, `min-price-delta` filters.');
  lines.push('');
  lines.push('| Rank | Title | Category | First→Last | Δprice | Δvol | Lag | Corr | Latest | Avg vol | Snaps |');
  lines.push('| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const m of affected) {
    const s = statsByMarket.get(m.market_id)!;
    const latest = latestByMarket.get(m.market_id);
    const latestCell = latest?.resolved_at
      ? `${fmt(latest.yes_price)} (R)`
      : fmt(latest?.yes_price);
    lines.push(`| ${m.rank} | ${escapeMd(m.market_title.slice(0, 72))} | ${m.category ?? 'other'} | ${fmt(s.firstPrice)}→${fmt(s.lastPrice)} | ${fmt(m.price_delta)} | ${fmtPct(m.volume_delta_pct)} | ${m.best_lag_hours ?? 'n/a'}h | ${fmt(m.lagged_correlation)} | ${latestCell} | ${fmtDollar(s.avgVolume24h)} | ${s.snapshots} |`);
  }
  lines.push('');

  // ─── NO/NO mispricings (the structural arb the user asked for) ───
  lines.push('## 6. Structural mispricings — **sum of YES prices > 1** with high correlation');
  lines.push('');
  lines.push('> These are the primary hedge candidates: markets that move together (|corr| ≥ 0.8), both tradeable (prices in [0.03, 0.97]), **both YES priced so they sum > 1.02**. If the two events cannot both resolve YES, buying NO on each collects the mispricing.');
  lines.push('');
  lines.push(`Threshold: |corr| ≥ ${HIGH_CORR}, sum ≥ ${1 + MISPRICE_DELTA}.`);
  lines.push('');
  lines.push(`**Pairs flagged: ${noNoPairs.length}.**`);
  lines.push('');
  if (noNoPairs.length === 0) {
    lines.push('_No sum>1 mispricings at these thresholds._');
  } else {
    noNoPairs.slice(0, 30).forEach((p, i) => {
      const tA = titleByMarket.get(p.a) ?? '';
      const tB = titleByMarket.get(p.b) ?? '';
      const rA = roleByMarket.get(p.a) ?? '?';
      const rB = roleByMarket.get(p.b) ?? '?';
      const cost = (1 - p.yesA!) + (1 - p.yesB!);
      const floorRet = (1 - cost) / cost;
      const bestRet = (2 - cost) / cost;
      lines.push(`### ${i + 1}. ${escapeMd(tA)}  **×**  ${escapeMd(tB)}`);
      lines.push('');
      lines.push(`- A (${rA}): \`${p.a}\`  —  YES = **${fmt(p.yesA)}**`);
      lines.push(`- B (${rB}): \`${p.b}\`  —  YES = **${fmt(p.yesB)}**`);
      lines.push(`- corr(A,B) in-window: **${fmt(p.corr)}** (aligned n=${p.n})`);
      lines.push(`- **YES_A + YES_B = ${fmt(p.sum)}**  →  Δ from 1.00 = **+${fmt(p.sum! - 1)}**`);
      lines.push(`- NO/NO hedge cost: $${fmt(cost)}  |  floor payout: $1.00 (if tail≈0) → **${fmtPct(floorRet)} return**  |  best payout: $2.00 → ${fmtPct(bestRet)}`);
      lines.push('');
    });
  }

  // ─── YES/YES implication candidates ───
  lines.push('## 7. Implication candidates — **sum < 1** with very high correlation');
  lines.push('');
  lines.push('> Secondary: high |corr| markets where YES_A + YES_B < 0.98. If A and B are functionally equivalent bets (e.g. "Tisza wins" × "Orbán loses") and the market is paying less than $1 on both combined, the basket is underpriced.');
  lines.push('');
  lines.push(`Threshold: |corr| ≥ ${IMPLIC_MIN_CORR}, sum ≤ ${1 - MISPRICE_DELTA}.`);
  lines.push('');
  lines.push(`**Pairs flagged: ${yesYesPairs.length}.**`);
  lines.push('');
  if (yesYesPairs.length === 0) {
    lines.push('_No sum<1 implication candidates at these thresholds._');
  } else {
    yesYesPairs.slice(0, 20).forEach((p, i) => {
      const tA = titleByMarket.get(p.a) ?? '';
      const tB = titleByMarket.get(p.b) ?? '';
      const rA = roleByMarket.get(p.a) ?? '?';
      const rB = roleByMarket.get(p.b) ?? '?';
      lines.push(`### ${i + 1}. ${escapeMd(tA)}  **×**  ${escapeMd(tB)}`);
      lines.push('');
      lines.push(`- A (${rA}): \`${p.a}\`  —  YES = **${fmt(p.yesA)}**`);
      lines.push(`- B (${rB}): \`${p.b}\`  —  YES = **${fmt(p.yesB)}**`);
      lines.push(`- corr(A,B) in-window: **${fmt(p.corr)}** (aligned n=${p.n})`);
      lines.push(`- **YES_A + YES_B = ${fmt(p.sum)}**  →  Δ from 1.00 = **${fmt(p.sum! - 1)}**`);
      lines.push('');
    });
  }

  // ─── Highest-corr neighbors of any anchor/trigger ───
  lines.push('## 8. Strongest price connections to anchors/trigger');
  lines.push('');
  lines.push('> Every pair where one side is anchor/trigger and |corr| ≥ 0.85. This is the "what moved with the event" view — not filtered to tradeable prices.');
  lines.push('');
  lines.push('| Corr | n | A (role) | B (role) | YES_A | YES_B | Sum |');
  lines.push('| ---: | ---: | --- | --- | ---: | ---: | ---: |');
  for (const p of anchorNeighbors.slice(0, 30)) {
    const tA = titleByMarket.get(p.a) ?? '';
    const tB = titleByMarket.get(p.b) ?? '';
    const rA = roleByMarket.get(p.a) ?? '?';
    const rB = roleByMarket.get(p.b) ?? '?';
    lines.push(`| ${fmt(p.corr)} | ${p.n} | ${escapeMd(tA.slice(0, 55))} (${rA}) | ${escapeMd(tB.slice(0, 55))} (${rB}) | ${fmt(p.yesA)} | ${fmt(p.yesB)} | ${fmt(p.sum)} |`);
  }
  lines.push('');

  // ─── Caveats ───
  lines.push('## 9. Caveats for writing the case study');
  lines.push('');
  lines.push('- **Prices are live** (last 72h from `market_snapshots`), not frozen at trigger time. If the study window is weeks old, the mispricing you see today may have already been arbed away.');
  lines.push('- **Correlation is in-window** — computed only across the study window hours. Pairs may decouple outside.');
  lines.push('- **Pearson ≠ causation.** Two markets at 4¢ that both spiked on the same news will read corr ≈ 0.9 even if their underlyings are unrelated. Read each pair in context.');
  lines.push('- **Tail cell risk.** The "floor return" on NO/NO pairs assumes the "both YES" outcome has ≈0% probability. Estimate it honestly for each specific pair.');
  lines.push('- **Orderbook depth, fees, UMA resolution risk.** Top-of-book prices here are not fill prices for size. Polymarket charges fees and gas; UMA has contested resolutions.');
  lines.push('- **Short-dated noise.** Intraday crypto-price markers and social-post-count markets can pass all filters but carry no signal about the trigger event; treat them as noise unless they clearly align with the narrative.');
  lines.push('');

  const outPath = resolve(process.cwd(), 'out', `analysis-${slug}.md`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join('\n'));
  console.log(`[${slug}] wrote ${outPath}  —  ${markets.length} markets, ${noNoPairs.length} sum>1 pairs, ${yesYesPairs.length} sum<1 pairs`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slugs = args.length > 0 ? args : DEFAULT_SLUGS;
  for (const slug of slugs) {
    try {
      await buildAnalysis(slug);
    } catch (err) {
      console.error(`[${slug}]`, err instanceof Error ? err.message : err);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
