/**
 * scan-hedged-arbs — find candidate hedged-arb pairs inside a case study.
 *
 * For a given study slug, read that slug's ranked markets (case_study_markets)
 * and their frozen hourly series (case_study_series). For every unordered
 * pair (A, B), compute Pearson corr between A and B on aligned hourly buckets.
 * Then pull the *latest* yes_price for A and B from market_snapshots
 * (partition-filtered) and flag pairs where:
 *
 *   |corr(A,B)| >= 0.6  AND  (yes_A + yes_B > 1.02  OR  yes_A + yes_B < 0.98)
 *
 * High co-movement + a YES-sum that violates 1.0 is the structural signature
 * of a hedged-arb candidate (NO/NO mutual-exclusivity or YES/YES implication).
 *
 * Writes a markdown report to pipeline-worker/out/arb-scan-<slug>.md.
 * Read-only against BigQuery — no DB writes.
 *
 * Usage:
 *   tsx src/scripts/scan-hedged-arbs.ts <slug> [--min-corr 0.6] [--min-sum-delta 0.02] [--top-pairs 25]
 */

import { bq } from '../core/bigquery.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface Args {
  slug: string;
  minCorr: number;
  minSumDelta: number;
  topPairs: number;
  minPrice: number;
  maxPrice: number;
  anyRole: boolean;
  noNoOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  let slug: string | null = null;
  let minCorr = 0.6;
  let minSumDelta = 0.02;
  let topPairs = 25;
  let minPrice = 0.03;
  let maxPrice = 0.97;
  let anyRole = false;     // default: require pair to contain anchor/trigger
  let noNoOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--min-corr') minCorr = parseFloat(argv[++i]);
    else if (a === '--min-sum-delta') minSumDelta = parseFloat(argv[++i]);
    else if (a === '--top-pairs') topPairs = parseInt(argv[++i], 10);
    else if (a === '--min-price') minPrice = parseFloat(argv[++i]);
    else if (a === '--max-price') maxPrice = parseFloat(argv[++i]);
    else if (a === '--any-role') anyRole = true;
    else if (a === '--no-no-only') noNoOnly = true;
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else if (!slug) slug = a;
    else throw new Error(`Unexpected positional arg: ${a}`);
  }
  if (!slug) throw new Error('Usage: tsx scan-hedged-arbs.ts <slug> [flags]');
  return { slug, minCorr, minSumDelta, topPairs, minPrice, maxPrice, anyRole, noNoOnly };
}

interface StudyMarket {
  market_id: string;
  market_title: string;
  category: string | null;
  role: string;
  rank: number | null;
  lagged_correlation: number | null;
}

interface SeriesPoint {
  market_id: string;
  timestamp: string;
  yes_price: number | null;
}

interface LatestPrice {
  market_id: string;
  yes_price: number | null;
  timestamp: string;
  resolved_at: string | null;
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

function alignedPairCorr(a: SeriesPoint[], b: SeriesPoint[]): number | null {
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
  return pearson(xs, ys);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;

  // 1. Load ranked markets (and trigger) for this slug.
  const { data: marketsData, error: marketsErr } = await bq.rawQuery<StudyMarket>(
    `SELECT market_id, market_title, category, role, rank, lagged_correlation
     FROM \`${dataset}.case_study_markets\`
     WHERE slug = @slug`,
    { slug: args.slug },
  );
  if (marketsErr) throw new Error(`load markets: ${marketsErr.message}`);
  const markets = marketsData ?? [];
  if (markets.length < 2) {
    console.log(`[scan-hedged-arbs] Need >= 2 markets for slug '${args.slug}', got ${markets.length}`);
    return;
  }

  const marketIds = markets.map((m) => m.market_id);
  const titleByMarket = new Map(markets.map((m) => [m.market_id, m.market_title]));
  const roleByMarket = new Map(markets.map((m) => [m.market_id, m.role]));

  // 2. Load frozen series for all of them in one query.
  const { data: seriesData, error: seriesErr } = await bq.rawQuery<SeriesPoint>(
    `SELECT market_id, timestamp, yes_price
     FROM \`${dataset}.case_study_series\`
     WHERE slug = @slug
       AND market_id IN UNNEST(@ids)
     ORDER BY market_id, timestamp`,
    { slug: args.slug, ids: marketIds },
  );
  if (seriesErr) throw new Error(`load series: ${seriesErr.message}`);
  const seriesByMarket = new Map<string, SeriesPoint[]>();
  for (const p of seriesData ?? []) {
    const arr = seriesByMarket.get(p.market_id) ?? [];
    arr.push(p);
    seriesByMarket.set(p.market_id, arr);
  }

  // 3. Latest price for each market (one batched query, partition-filtered).
  //    Use a 24h lookback to guarantee a fresh point.
  const { data: latestData, error: latestErr } = await bq.rawQuery<LatestPrice>(
    `WITH ranked AS (
       SELECT
         market_id,
         yes_price,
         timestamp,
         ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY timestamp DESC) AS rn
       FROM \`${dataset}.market_snapshots\`
       WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 48 HOUR)
         AND market_id IN UNNEST(@ids)
     )
     SELECT r.market_id, r.yes_price, r.timestamp, m.resolved_at
     FROM ranked r
     LEFT JOIN \`${dataset}.markets\` m ON m.condition_id = r.market_id
     WHERE r.rn = 1`,
    { ids: marketIds },
  );
  if (latestErr) throw new Error(`load latest: ${latestErr.message}`);
  const latestByMarket = new Map<string, LatestPrice>();
  for (const p of latestData ?? []) latestByMarket.set(p.market_id, p);

  // 4. All unordered pairs. Score by |corr| × |sum - 1|, keep top N matches.
  interface Flag {
    a: string;
    b: string;
    corr: number;
    yesA: number;
    yesB: number;
    sum: number;
    kind: 'NO/NO hedge (mutual-exclusivity)' | 'YES/YES hedge (implication)';
    cost: number;
    floorPayout: number;
    bestPayout: number;
    floorReturnPct: number;
    bestReturnPct: number;
  }
  const flags: Flag[] = [];

  for (let i = 0; i < marketIds.length; i++) {
    for (let j = i + 1; j < marketIds.length; j++) {
      const idA = marketIds[i];
      const idB = marketIds[j];

      // By default require at least one anchor/trigger in the pair
      // (filters out noise pairs of two unrelated edge-neighbors).
      if (!args.anyRole) {
        const rA = roleByMarket.get(idA);
        const rB = roleByMarket.get(idB);
        const keyRole = (r: string | undefined) => r === 'anchor' || r === 'trigger';
        if (!keyRole(rA) && !keyRole(rB)) continue;
      }

      const sA = seriesByMarket.get(idA);
      const sB = seriesByMarket.get(idB);
      if (!sA || !sB) continue;

      const corr = alignedPairCorr(sA, sB);
      if (corr == null || Math.abs(corr) < args.minCorr) continue;

      const latA = latestByMarket.get(idA);
      const latB = latestByMarket.get(idB);
      if (!latA?.yes_price || !latB?.yes_price) continue;

      // Skip already-resolved markets — no tradeable edge.
      if (latA.resolved_at || latB.resolved_at) continue;

      const yesA = latA.yes_price;
      const yesB = latB.yes_price;
      // Skip price edges (already-certain markets with no tradeable edge).
      if (yesA < args.minPrice || yesA > args.maxPrice) continue;
      if (yesB < args.minPrice || yesB > args.maxPrice) continue;

      const sum = yesA + yesB;
      const delta = sum - 1;
      if (Math.abs(delta) < args.minSumDelta) continue;
      if (args.noNoOnly && delta <= 0) continue;

      if (delta > 0) {
        // NO/NO hedge: cost = (1 - yesA) + (1 - yesB). Worst case (one YES, one NO) = $1.
        const cost = (1 - yesA) + (1 - yesB);
        const floor = 1;            // exactly one resolves YES -> $1; the impossible "both YES" is the tail
        const best = 2;             // both resolve NO -> $2
        flags.push({
          a: idA, b: idB, corr, yesA, yesB, sum,
          kind: 'NO/NO hedge (mutual-exclusivity)',
          cost, floorPayout: floor, bestPayout: best,
          floorReturnPct: (floor - cost) / cost * 100,
          bestReturnPct: (best - cost) / cost * 100,
        });
      } else {
        // YES/YES hedge (implication): cost = yesA + yesB. If A implies B (or vice versa),
        // you cannot have exactly one YES. Worst legit outcome (both YES or both NO) = $0 or $2.
        // Here "implication mispricing" means market priced too low relative to logical tie.
        const cost = yesA + yesB;
        const floor = 0;   // both NO -> $0; this is the tail of an implication hedge
        const best = 2;    // both YES -> $2
        flags.push({
          a: idA, b: idB, corr, yesA, yesB, sum,
          kind: 'YES/YES hedge (implication)',
          cost, floorPayout: floor, bestPayout: best,
          floorReturnPct: (floor - cost) / cost * 100,
          bestReturnPct: (best - cost) / cost * 100,
        });
      }
    }
  }

  flags.sort((x, y) => Math.abs(y.sum - 1) * Math.abs(y.corr) - Math.abs(x.sum - 1) * Math.abs(x.corr));
  const top = flags.slice(0, args.topPairs);

  // 5. Write markdown report.
  const outPath = resolve(process.cwd(), 'out', `arb-scan-${args.slug}.md`);
  await mkdir(dirname(outPath), { recursive: true });

  const lines: string[] = [];
  lines.push(`# Hedged-arb scan — ${args.slug}`);
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push('');
  lines.push('## Read this first');
  lines.push('');
  lines.push('This report is **scouting, not execution**. Every flagged pair is a *candidate*, not a trade. Before sizing anything:');
  lines.push('');
  lines.push('- **Tail cell.** The "floor return" assumes the logically-impossible outcome (both YES for a mutual-exclusivity pair, both NO for an implication pair) has probability ~0. Estimate it honestly; 3% is often realistic, 10% kills the trade.');
  lines.push('- **Orderbook depth.** The quoted YES prices are latest snapshot prints, not the full book. A $500 fill may execute 2–5¢ worse than printed — your edge shrinks.');
  lines.push('- **UMA resolution risk.** Polymarket markets have had contested resolutions. An N/A or disputed resolve can invalidate the hedge.');
  lines.push('- **Fees + Polygon gas.** Polymarket charges a small trade fee and you pay gas on every fill. Eats into thin edges.');
  lines.push('- **Correlation is inside the event window.** Pairs that co-moved during the trigger may decouple afterwards. Re-check before firing.');
  lines.push('');
  lines.push(`## Scan parameters`);
  lines.push('');
  lines.push(`- slug: \`${args.slug}\``);
  lines.push(`- markets scanned: ${markets.length} (${marketIds.length} with series)`);
  lines.push(`- pairs evaluated: ${(marketIds.length * (marketIds.length - 1)) / 2}`);
  lines.push(`- |corr| threshold: ${args.minCorr}`);
  lines.push(`- |sum − 1| threshold: ${args.minSumDelta}`);
  lines.push(`- price bounds: [${args.minPrice}, ${args.maxPrice}] (resolved markets excluded)`);
  lines.push(`- role filter: ${args.anyRole ? 'any' : 'at least one anchor/trigger per pair'}`);
  lines.push(`- direction filter: ${args.noNoOnly ? 'NO/NO only (mutual exclusivity)' : 'both directions'}`);
  lines.push(`- flags found: ${flags.length} (showing top ${top.length})`);
  lines.push('');

  if (top.length === 0) {
    lines.push('_No pairs passed the filters. Try lowering --min-corr or --min-sum-delta, or widen the study window so more markets have overlapping hours._');
  } else {
    lines.push('## Flagged pairs');
    lines.push('');
    top.forEach((f, idx) => {
      const tA = titleByMarket.get(f.a) ?? '(unknown)';
      const tB = titleByMarket.get(f.b) ?? '(unknown)';
      lines.push(`### ${idx + 1}. ${f.kind}`);
      lines.push('');
      const rA = roleByMarket.get(f.a) ?? '?';
      const rB = roleByMarket.get(f.b) ?? '?';
      lines.push(`- **A** (${rA}): ${tA}`);
      lines.push(`  - \`${f.a}\``);
      lines.push(`  - YES = ${f.yesA.toFixed(3)}`);
      lines.push(`- **B** (${rB}): ${tB}`);
      lines.push(`  - \`${f.b}\``);
      lines.push(`  - YES = ${f.yesB.toFixed(3)}`);
      lines.push(`- corr(A,B) in-window = ${f.corr.toFixed(3)}`);
      lines.push(`- YES_A + YES_B = ${f.sum.toFixed(3)}  (Δ from 1.00 = ${(f.sum - 1).toFixed(3)})`);
      lines.push(`- Hedge cost per share-pair: $${f.cost.toFixed(3)}`);
      lines.push(`- Floor payout (assuming tail ≈ 0): $${f.floorPayout.toFixed(2)}  →  **${f.floorReturnPct.toFixed(1)}%** return`);
      lines.push(`- Best payout: $${f.bestPayout.toFixed(2)}  →  ${f.bestReturnPct.toFixed(1)}% return`);
      lines.push('');
    });
  }

  await writeFile(outPath, lines.join('\n'));
  console.log(`[scan-hedged-arbs] wrote ${outPath}  (${flags.length} flags, showing top ${top.length})`);
}

main().catch((err) => {
  console.error('[scan-hedged-arbs]', err instanceof Error ? err.message : err);
  process.exit(1);
});
