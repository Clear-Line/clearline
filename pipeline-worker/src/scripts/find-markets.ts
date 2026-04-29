/**
 * find-markets — resolve Polymarket markets by keyword.
 *
 * Prints a ranked table of candidate markets so you can pick `condition_id`s
 * to feed into build-case-study.ts (--market / --anchors).
 *
 * Usage:
 *   tsx src/scripts/find-markets.ts "<kw1> <kw2> ..." [flags]
 *
 * Flags:
 *   --active-only         exclude resolved markets (resolved_at IS NULL)
 *   --since <ISO>         lower bound for volume aggregation (default: 14d ago)
 *   --limit <N>           row cap (default: 30)
 *   --category <name>     filter markets by category
 *
 * Cost: one BigQuery query per run. Both reads are batched; the
 * `market_snapshots` scan is partition-filtered by `--since`.
 */

import { bq } from '../core/bigquery.js';

interface Args {
  keywords: string[];
  activeOnly: boolean;
  since: string;
  limit: number;
  category: string | null;
}

function parseArgs(argv: string[]): Args {
  const kw: string[] = [];
  let activeOnly = false;
  let since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  let limit = 30;
  let category: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--active-only') activeOnly = true;
    else if (a === '--since') since = argv[++i];
    else if (a === '--limit') limit = parseInt(argv[++i], 10);
    else if (a === '--category') category = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
    else kw.push(a.toLowerCase());
  }

  if (kw.length === 0) {
    throw new Error('Provide at least one keyword. Example: tsx find-markets.ts "iran ceasefire" --active-only');
  }
  return { keywords: kw, activeOnly, since, limit, category };
}

interface Row {
  condition_id: string;
  question: string;
  category: string | null;
  resolved_at: string | null;
  avg_volume_24h: number | null;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;

  // Build keyword filter — each keyword must appear in question (case-insensitive)
  const kwClauses = args.keywords.map((_, i) => `LOWER(m.question) LIKE @kw${i}`).join(' AND ');
  const kwParams: Record<string, unknown> = {};
  args.keywords.forEach((k, i) => {
    kwParams[`kw${i}`] = `%${k}%`;
  });

  const activeClause = args.activeOnly ? 'AND m.resolved_at IS NULL' : '';
  const categoryClause = args.category ? 'AND m.category = @category' : '';

  const params: Record<string, unknown> = {
    ...kwParams,
    since: args.since,
    limit: args.limit,
  };
  if (args.category) params.category = args.category;

  const sql = `
    WITH recent_vol AS (
      SELECT
        market_id,
        AVG(volume_24h) AS avg_volume_24h
      FROM \`${dataset}.market_snapshots\`
      WHERE timestamp >= TIMESTAMP(@since)
      GROUP BY market_id
    )
    SELECT
      m.condition_id,
      m.question,
      m.category,
      m.resolved_at,
      rv.avg_volume_24h
    FROM \`${dataset}.markets\` AS m
    LEFT JOIN recent_vol AS rv ON rv.market_id = m.condition_id
    WHERE ${kwClauses}
      ${activeClause}
      ${categoryClause}
    ORDER BY rv.avg_volume_24h DESC NULLS LAST
    LIMIT @limit
  `;

  const { data, error } = await bq.rawQuery<Row>(sql, params);
  if (error) {
    console.error(`[find-markets] Query failed: ${error.message}`);
    process.exit(1);
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    console.log('[find-markets] No matches.');
    return;
  }

  console.log(`\nKeywords: ${args.keywords.join(' AND ')}`);
  console.log(`Since: ${args.since}  |  active-only: ${args.activeOnly}  |  matches: ${rows.length}\n`);

  for (const r of rows) {
    const vol = r.avg_volume_24h != null ? `$${Math.round(r.avg_volume_24h).toLocaleString()}` : 'n/a';
    const resolved = r.resolved_at ? `resolved ${r.resolved_at.slice(0, 10)}` : 'active';
    console.log(`  ${r.condition_id}`);
    console.log(`    ${r.question}`);
    console.log(`    ${r.category ?? 'other'}  |  avg vol24h ${vol}  |  ${resolved}\n`);
  }
}

main().catch((err) => {
  console.error('[find-markets]', err instanceof Error ? err.message : err);
  process.exit(1);
});
