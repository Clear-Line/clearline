import { bq } from '../core/bigquery.js';

async function main() {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET}`;
  const slugs = [
    'iran-hormuz-apr-2026',
    'hungary-orban-defeat-apr-2026',
    'israel-hezbollah-ceasefire-apr-2026',
    'hormuz-multinational-mission-apr-2026',
  ];

  // 1. Study-level diagnostics
  console.log('\n===== STUDY SUMMARY =====');
  for (const slug of slugs) {
    const { data: meta } = await bq.rawQuery<any>(
      `SELECT study_type, trigger_timestamp, window_start, window_end, affected_count, max_lag_hours
       FROM \`${dataset}.case_studies\` WHERE slug = @slug`,
      { slug },
    );
    const { data: seriesCount } = await bq.rawQuery<any>(
      `SELECT COUNT(*) AS n, COUNT(DISTINCT market_id) AS markets
       FROM \`${dataset}.case_study_series\` WHERE slug = @slug`,
      { slug },
    );
    const { data: roleCounts } = await bq.rawQuery<any>(
      `SELECT role, COUNT(*) AS n
       FROM \`${dataset}.case_study_markets\` WHERE slug = @slug
       GROUP BY role ORDER BY role`,
      { slug },
    );
    const m = meta?.[0];
    const s = seriesCount?.[0];
    const roles = (roleCounts ?? []).map((r: any) => `${r.role}=${r.n}`).join(' ');
    console.log(`\n${slug}`);
    console.log(`  window: ${m?.window_start} → ${m?.window_end}`);
    console.log(`  roles: ${roles}`);
    console.log(`  series: ${s?.n} snapshot rows across ${s?.markets} markets`);
  }

  // 2. Check anchor resolution status
  console.log('\n\n===== ANCHOR RESOLUTION STATUS =====');
  for (const slug of slugs) {
    const { data } = await bq.rawQuery<any>(
      `SELECT m.market_title, m.role, mk.resolved_at, mk.is_resolved,
         (SELECT COUNT(*) FROM \`${dataset}.case_study_series\` s
          WHERE s.slug = @slug AND s.market_id = m.market_id) AS snap_count
       FROM \`${dataset}.case_study_markets\` m
       LEFT JOIN \`${dataset}.markets\` mk ON mk.condition_id = m.market_id
       WHERE m.slug = @slug AND m.role IN ('trigger', 'anchor')
       ORDER BY m.role, m.rank`,
      { slug },
    );
    console.log(`\n${slug}`);
    for (const r of data ?? []) {
      const resolved = r.resolved_at ? `RESOLVED ${r.resolved_at.slice(0, 10)}` : 'active';
      console.log(`  [${r.role}] snap=${String(r.snap_count).padStart(3)} ${resolved.padEnd(20)} ${r.market_title.slice(0, 75)}`);
    }
  }

  // 3. Per-market snapshot density for top-ranked affected
  console.log('\n\n===== TOP-RANKED AFFECTED: SNAPSHOT DENSITY =====');
  for (const slug of slugs) {
    const { data } = await bq.rawQuery<any>(
      `SELECT m.rank, m.market_title, ROUND(m.lagged_correlation, 3) AS corr,
         ROUND(m.price_delta, 3) AS dp,
         (SELECT COUNT(*) FROM \`${dataset}.case_study_series\` s
          WHERE s.slug = @slug AND s.market_id = m.market_id) AS snap_count
       FROM \`${dataset}.case_study_markets\` m
       WHERE m.slug = @slug AND m.role = 'affected'
       ORDER BY ABS(COALESCE(m.lagged_correlation, 0)) DESC
       LIMIT 12`,
      { slug },
    );
    console.log(`\n${slug}`);
    for (const r of data ?? []) {
      console.log(`  rank ${String(r.rank).padStart(2)} snap=${String(r.snap_count).padStart(3)}  ${r.market_title.slice(0, 80)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
