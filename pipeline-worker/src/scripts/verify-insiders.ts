/**
 * Verification query — pulls a sample of market_insiders rows joined to
 * market questions so we can eyeball whether the insider list looks
 * insider-shaped (high concentration, low markets-traded, real money).
 *
 * Run from pipeline-worker dir:
 *   node --env-file=../.env.local --import tsx src/scripts/verify-insiders.ts
 */

import { bq } from '../core/bigquery.js';

async function main() {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;

  const summary = await bq.rawQuery<{
    markets_with_insiders: number;
    max_insiders: number;
    avg_insiders: number;
    last_run: string;
  }>(`
    SELECT
      COUNT(*) AS markets_with_insiders,
      MAX(insider_count) AS max_insiders,
      ROUND(AVG(insider_count), 2) AS avg_insiders,
      MAX(computed_at) AS last_run
    FROM \`${dataset}.market_insiders\`
  `);
  console.log('\n=== Summary ===');
  console.log(summary.data?.[0]);

  const sample = await bq.rawQuery<{
    question: string;
    category: string;
    insider_count: number;
    top_insiders: string;
  }>(`
    SELECT
      m.question,
      m.category,
      i.insider_count,
      i.top_insiders
    FROM \`${dataset}.market_insiders\` i
    JOIN \`${dataset}.markets\` m ON m.condition_id = i.market_id
    ORDER BY i.insider_count DESC
    LIMIT 10
  `);

  console.log('\n=== Top 10 markets by insider count ===');
  for (const row of sample.data ?? []) {
    console.log(`\n[${row.category}] ${row.question}`);
    console.log(`  insider_count: ${row.insider_count}`);
    try {
      const insiders = JSON.parse(row.top_insiders);
      for (const ins of insiders) {
        console.log(`    ${ins.address}  ${ins.side}  $${ins.position.toLocaleString()}  ${ins.concentration}% conc  ${ins.marketsTraded} mkts`);
      }
    } catch (e) {
      console.log('  [failed to parse top_insiders]', e);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[verify] Fatal:', err);
  process.exit(1);
});
