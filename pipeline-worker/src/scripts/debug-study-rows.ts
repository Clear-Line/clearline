import { bq } from '../core/bigquery.js';

async function main() {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET}`;
  const { data } = await bq.rawQuery<any>(
    `SELECT category, COUNT(*) AS n
     FROM \`${dataset}.markets\`
     WHERE condition_id IN (
       SELECT DISTINCT market_id
       FROM \`${dataset}.case_study_markets\`
       WHERE slug IN ('israel-hezbollah-ceasefire-apr-2026', 'hormuz-multinational-mission-apr-2026', 'hungary-orban-defeat-apr-2026')
         AND role = 'affected'
     )
     GROUP BY category
     ORDER BY n DESC`,
  );
  for (const r of data ?? []) console.log(r.category, r.n);
}
main().catch((e) => { console.error(e); process.exit(1); });
