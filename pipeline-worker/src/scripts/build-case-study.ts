/**
 * build-case-study — CLI for authoring Clearline case studies.
 *
 * Four modes, one tool. Writes frozen rows to case_studies + case_study_series
 * + case_study_markets so each study survives the 30-day snapshot rolloff.
 *
 * Usage:
 *   tsx src/scripts/build-case-study.ts <mode> [flags...]
 *
 * Modes:
 *   volume-shock    Detected volume/liquidity spike on a market
 *   external-event  News / headline anchored at a timestamp
 *   calendar        Replay a known big-date window (election night, CPI, ...)
 *   resolution      Backwards look at correlated markets before a resolution
 *
 * See README or the plan file for concrete flag examples.
 */

import {
  loadSnapshotSeries,
  loadMarketMetadata,
  loadEdgeNeighbors,
  loadTopMarketsInWindow,
  loadActiveMarketsInWindow,
  computeLaggedCorrelation,
  computeImpact,
  rankAffected,
  writeStudy,
  buildEvidenceStat,
  type SnapshotRow,
  type AffectedMarket,
  type StudyMeta,
  type StudyType,
} from './lib/case-study-core.js';

// ─── Flag parsing ───

interface Flags {
  [key: string]: string;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val == null || val.startsWith('--')) {
        flags[key] = 'true';
      } else {
        flags[key] = val;
        i++;
      }
    }
  }
  return flags;
}

function required(flags: Flags, key: string): string {
  const v = flags[key];
  if (!v) {
    console.error(`Missing required --${key}`);
    process.exit(1);
  }
  return v;
}

function optional(flags: Flags, key: string): string | null {
  return flags[key] ?? null;
}

function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ─── Shared builder ───

interface BuildParams {
  slug: string;
  title: string;
  type: StudyType;
  triggerIso: string;
  triggerMarketId: string | null;
  externalHeadline: string | null;
  externalSourceUrl: string | null;
  calendarEventName: string | null;
  windowStart: string;
  windowEnd: string;
  candidateIds: string[];    // all markets to load snapshots for
  anchorIds?: string[];      // for external_event, these are "role: anchor"
  skipLagLoop?: boolean;     // calendar mode uses straight pre/post impact
  pivotIso: string;          // where to split pre vs post (trigger for most, window start for calendar)
  minAbsPriceDelta?: number; // drop non-trigger/anchor markets with tiny price moves
  minAbsCorr?: number;       // drop non-trigger/anchor markets below this correlation
  minSnapshots?: number;     // drop markets with fewer snapshots than this in the window
  titleKeywordsRe?: RegExp;  // optional post-filter: only keep affected markets whose title matches
  excludeCategories?: Set<string>;     // drop markets whose category is in this set
  excludeTitleRe?: RegExp;             // drop markets whose title matches (intraday/weather noise)
}

async function buildStudy(params: BuildParams): Promise<void> {
  const {
    slug, title, type, triggerIso, triggerMarketId,
    externalHeadline, externalSourceUrl, calendarEventName,
    windowStart, windowEnd, candidateIds, anchorIds, skipLagLoop, pivotIso,
    minAbsPriceDelta = 0, minAbsCorr = 0, minSnapshots = 0, titleKeywordsRe,
    excludeCategories, excludeTitleRe,
  } = params;

  if (candidateIds.length === 0) {
    console.error('No candidate markets to analyze. Aborting.');
    process.exit(1);
  }

  console.log(`[build-case-study] ${type} / ${slug}`);
  console.log(`  window: ${windowStart} → ${windowEnd}`);
  console.log(`  candidates: ${candidateIds.length}`);

  // Load snapshots + metadata in parallel
  const [allRows, metaMap] = await Promise.all([
    loadSnapshotSeries(candidateIds, windowStart, windowEnd),
    loadMarketMetadata(candidateIds),
  ]);

  console.log(`  loaded ${allRows.length} snapshot rows`);

  // Group series by market
  const byMarket = new Map<string, SnapshotRow[]>();
  for (const row of allRows) {
    const arr = byMarket.get(row.market_id) ?? [];
    arr.push(row);
    byMarket.set(row.market_id, arr);
  }

  // Build affected list
  const triggerSeries = triggerMarketId ? byMarket.get(triggerMarketId) ?? [] : [];
  const affected: AffectedMarket[] = [];

  // Push trigger row first (if there is one)
  if (triggerMarketId) {
    const triggerMeta = metaMap.get(triggerMarketId);
    const triggerImpact = computeImpact(triggerSeries, pivotIso);
    affected.push({
      market_id: triggerMarketId,
      market_title: triggerMeta?.question ?? '(unknown)',
      category: triggerMeta?.category ?? 'other',
      role: 'trigger',
      lag_hours: 0,
      price_delta: triggerImpact.priceDelta,
      volume_delta_pct: triggerImpact.volumeDeltaPct,
      lagged_correlation: 1,
      best_lag_hours: 0,
      rank: 0,
    });
  }

  const anchorSet = new Set(anchorIds ?? []);

  for (const candidateId of candidateIds) {
    if (candidateId === triggerMarketId) continue;
    const candidateSeries = byMarket.get(candidateId) ?? [];
    if (candidateSeries.length < 2) continue;

    const candidateMeta = metaMap.get(candidateId);
    const impact = computeImpact(candidateSeries, pivotIso);

    let correlation: number | null = null;
    let bestLag: number | null = null;
    if (!skipLagLoop && triggerSeries.length > 1) {
      const result = computeLaggedCorrelation(triggerSeries, candidateSeries);
      if (result) {
        correlation = result.bestCorr;
        bestLag = result.bestLag;
      }
    }

    const isAnchor = anchorSet.has(candidateId);
    if (!isAnchor) {
      // Filter non-anchor "affected" markets — anchors always survive.
      if (minSnapshots > 0 && candidateSeries.length < minSnapshots) continue;
      if (minAbsCorr > 0 && (correlation == null || Math.abs(correlation) < minAbsCorr)) continue;
      if (minAbsPriceDelta > 0 && (impact.priceDelta == null || Math.abs(impact.priceDelta) < minAbsPriceDelta)) continue;
      if (titleKeywordsRe && !titleKeywordsRe.test(candidateMeta?.question ?? '')) continue;
      if (excludeCategories && excludeCategories.has(candidateMeta?.category ?? '')) continue;
      if (excludeTitleRe && excludeTitleRe.test(candidateMeta?.question ?? '')) continue;
    }

    affected.push({
      market_id: candidateId,
      market_title: candidateMeta?.question ?? '(unknown)',
      category: candidateMeta?.category ?? 'other',
      role: isAnchor ? 'anchor' : 'affected',
      lag_hours: bestLag,
      price_delta: impact.priceDelta,
      volume_delta_pct: impact.volumeDeltaPct,
      lagged_correlation: correlation,
      best_lag_hours: bestLag,
      rank: 0,
    });
  }

  // Always preserve trigger + all anchors; rank only true 'affected' rows.
  const triggerRow = affected.find((a) => a.role === 'trigger');
  const anchorRows = affected.filter((a) => a.role === 'anchor');
  const affectedOnly = affected.filter((a) => a.role === 'affected');
  const topAffected = 60;
  const rankedAffected = rankAffected(affectedOnly, topAffected);
  // Re-rank numbering so anchors are rank 1..N and affected continue after
  const anchorRanked = anchorRows.map((a, i) => ({ ...a, rank: i + 1 }));
  const affectedRanked = rankedAffected.map((a, i) => ({ ...a, rank: anchorRows.length + i + 1 }));
  const ranked = [...anchorRanked, ...affectedRanked];
  const finalMarkets = triggerRow ? [triggerRow, ...ranked] : ranked;

  // Evidence stats
  const lagValues = ranked
    .map((m) => m.best_lag_hours)
    .filter((v): v is number => v != null);
  const maxLag = lagValues.length > 0 ? Math.max(...lagValues) : null;
  const avgLag = avg(lagValues);

  const meta: StudyMeta = {
    slug,
    title,
    study_type: type,
    trigger_timestamp: triggerIso,
    trigger_market_id: triggerMarketId,
    trigger_market_title: triggerMarketId ? metaMap.get(triggerMarketId)?.question ?? null : null,
    external_headline: externalHeadline,
    external_source_url: externalSourceUrl,
    calendar_event_name: calendarEventName,
    window_start: windowStart,
    window_end: windowEnd,
    evidence_stat: buildEvidenceStat(type, ranked.length, maxLag, avgLag),
    narrative_md: null,
    affected_count: ranked.length,
    max_lag_hours: maxLag,
    published: false,
  };

  console.log(`  evidence: ${meta.evidence_stat}`);
  console.log(`  writing frozen rows to BigQuery...`);

  await writeStudy(meta, allRows, finalMarkets);

  console.log(`\n✅ Draft case study saved: ${slug}`);
  console.log(`   Type:     ${type}`);
  console.log(`   Affected: ${ranked.length} markets`);
  console.log(`   Stat:     ${meta.evidence_stat}`);
  console.log(`\nTo publish, write the narrative and flip published=true:`);
  console.log(`  UPDATE \`<dataset>.case_studies\` SET narrative_md = '...', published = true WHERE slug = '${slug}';\n`);
}

// ─── Mode handlers ───

async function runVolumeShock(flags: Flags): Promise<void> {
  const slug = required(flags, 'slug');
  const marketId = required(flags, 'market');
  const triggerIso = required(flags, 'trigger');
  const title = optional(flags, 'title') ?? slug;
  const windowBefore = Number(optional(flags, 'window-before') ?? '24');
  const windowAfter = Number(optional(flags, 'window-after') ?? '48');

  const windowStart = addHours(triggerIso, -windowBefore);
  const windowEnd = addHours(triggerIso, windowAfter);

  // Candidates = trigger + edge neighbors
  const neighbors = await loadEdgeNeighbors(marketId);
  const candidateIds = Array.from(new Set([marketId, ...neighbors]));
  console.log(`[volume-shock] ${neighbors.length} edge neighbors found`);

  await buildStudy({
    slug,
    title,
    type: 'volume_shock',
    triggerIso,
    triggerMarketId: marketId,
    externalHeadline: null,
    externalSourceUrl: null,
    calendarEventName: null,
    windowStart,
    windowEnd,
    candidateIds,
    pivotIso: triggerIso,
  });
}

async function runExternalEvent(flags: Flags): Promise<void> {
  const slug = required(flags, 'slug');
  const triggerIso = required(flags, 'trigger');
  const headline = required(flags, 'headline');
  const anchorsRaw = required(flags, 'anchors');
  const source = optional(flags, 'source');
  const title = optional(flags, 'title') ?? headline;
  const windowBefore = Number(optional(flags, 'window-before') ?? '6');
  const windowAfter = Number(optional(flags, 'window-after') ?? '24');

  const anchorIds = anchorsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  if (anchorIds.length === 0) {
    console.error('--anchors must list at least one market id');
    process.exit(1);
  }

  const windowStart = addHours(triggerIso, -windowBefore);
  const windowEnd = addHours(triggerIso, windowAfter);

  // --universe: "edges" (default — anchors + pre-computed market_edges neighbors)
  //             "wide"  (every market with activity in the window — discovers
  //                      connections fresh instead of reading them from the graph)
  const universe = optional(flags, 'universe') ?? 'edges';
  let candidateIds: string[];
  if (universe === 'wide') {
    const minVol = Number(optional(flags, 'min-volume') ?? '500');
    const active = await loadActiveMarketsInWindow(windowStart, windowEnd, minVol);
    candidateIds = Array.from(new Set([...anchorIds, ...active]));
    console.log(`[external-event] wide universe: ${anchorIds.length} anchors + ${active.length} active markets (min avg vol $${minVol})`);
  } else {
    const neighborLists = await Promise.all(anchorIds.map((id) => loadEdgeNeighbors(id)));
    candidateIds = Array.from(new Set([...anchorIds, ...neighborLists.flat()]));
    console.log(`[external-event] edge universe: ${anchorIds.length} anchors + ${candidateIds.length - anchorIds.length} neighbors`);
  }

  const minAbsPriceDelta = Number(optional(flags, 'min-price-delta') ?? '0');
  const minAbsCorr = Number(optional(flags, 'min-corr') ?? '0');
  const minSnapshots = Number(optional(flags, 'min-snapshots') ?? '0');
  const titleKeywords = optional(flags, 'title-keywords');
  const titleKeywordsRe = titleKeywords ? new RegExp(titleKeywords, 'i') : undefined;
  const excludeCatsRaw = optional(flags, 'exclude-categories');
  const excludeCategories = excludeCatsRaw
    ? new Set(excludeCatsRaw.split(',').map((s) => s.trim().toLowerCase()))
    : undefined;
  // Default block for intraday/weather/sports-schedule style noise titles
  const excludeTitlePattern = optional(flags, 'exclude-title-pattern')
    ?? 'highest temperature|lowest temperature|Up or Down on|O/U \\d|FC vs\\.|Spread:|Game \\d Winner|NHL|NBA|NFL|EPL|Premier League|MLB|vs\\. [A-Z]';
  const excludeTitleRe = excludeTitlePattern ? new RegExp(excludeTitlePattern, 'i') : undefined;

  // Optional: pick a non-first anchor as the correlation reference via --trigger-anchor <id>
  const triggerAnchor = optional(flags, 'trigger-anchor') ?? anchorIds[0];

  await buildStudy({
    slug,
    title,
    type: 'external_event',
    triggerIso,
    triggerMarketId: triggerAnchor,
    externalHeadline: headline,
    externalSourceUrl: source,
    calendarEventName: null,
    windowStart,
    windowEnd,
    candidateIds,
    anchorIds,
    pivotIso: triggerIso,
    minAbsPriceDelta,
    minAbsCorr,
    minSnapshots,
    titleKeywordsRe,
    excludeCategories,
    excludeTitleRe,
  });
}

async function runCalendar(flags: Flags): Promise<void> {
  const slug = required(flags, 'slug');
  const eventName = required(flags, 'name');
  const startIso = required(flags, 'start');
  const endIso = required(flags, 'end');
  const title = optional(flags, 'title') ?? eventName;
  const category = optional(flags, 'category');
  const topN = Number(optional(flags, 'top-n') ?? '15');

  const candidateIds = await loadTopMarketsInWindow(category, startIso, endIso, topN);
  console.log(`[calendar] ${candidateIds.length} top markets in window`);

  await buildStudy({
    slug,
    title,
    type: 'calendar',
    triggerIso: startIso,
    triggerMarketId: null,
    externalHeadline: null,
    externalSourceUrl: null,
    calendarEventName: eventName,
    windowStart: startIso,
    windowEnd: endIso,
    candidateIds,
    skipLagLoop: true,
    pivotIso: new Date(
      (new Date(startIso).getTime() + new Date(endIso).getTime()) / 2,
    ).toISOString(),
  });
}

async function runResolution(flags: Flags): Promise<void> {
  const slug = required(flags, 'slug');
  const marketId = required(flags, 'market');
  const title = optional(flags, 'title') ?? slug;
  const lookbackDays = Number(optional(flags, 'lookback-days') ?? '14');

  // Look up resolved_at from markets table
  const metaMap = await loadMarketMetadata([marketId]);
  const meta = metaMap.get(marketId);
  if (!meta) {
    console.error(`Market ${marketId} not found in markets table`);
    process.exit(1);
  }

  // Use provided --trigger if given, otherwise the market's resolved_at (not in meta, so we query directly)
  let triggerIso = optional(flags, 'trigger');
  if (!triggerIso) {
    const { bq } = await import('../core/bigquery.js');
    const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
    const { data } = await bq.rawQuery<{ resolved_at: string | null }>(
      `SELECT resolved_at FROM \`${dataset}.markets\` WHERE condition_id = @id LIMIT 1`,
      { id: marketId },
    );
    triggerIso = data?.[0]?.resolved_at ?? null;
    if (!triggerIso) {
      console.error(`Market ${marketId} has no resolved_at — pass --trigger explicitly`);
      process.exit(1);
    }
  }

  const windowStart = addHours(triggerIso, -lookbackDays * 24);
  const windowEnd = triggerIso;

  const neighbors = await loadEdgeNeighbors(marketId);
  const candidateIds = Array.from(new Set([marketId, ...neighbors]));
  console.log(`[resolution] ${neighbors.length} edge neighbors`);

  await buildStudy({
    slug,
    title,
    type: 'resolution',
    triggerIso,
    triggerMarketId: marketId,
    externalHeadline: null,
    externalSourceUrl: null,
    calendarEventName: null,
    windowStart,
    windowEnd,
    candidateIds,
    pivotIso: triggerIso,
  });
}

// ─── Entry point ───

async function main() {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const flags = parseFlags(argv.slice(1));

  try {
    switch (mode) {
      case 'volume-shock':
        await runVolumeShock(flags);
        break;
      case 'external-event':
        await runExternalEvent(flags);
        break;
      case 'calendar':
        await runCalendar(flags);
        break;
      case 'resolution':
        await runResolution(flags);
        break;
      default:
        console.error('Usage: tsx src/scripts/build-case-study.ts <mode> [flags...]');
        console.error('Modes: volume-shock | external-event | calendar | resolution');
        process.exit(1);
    }
  } catch (err) {
    console.error('Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
