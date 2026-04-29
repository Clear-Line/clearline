/**
 * One-off CLI to count crypto-crypto edges in market_edges.
 *
 * Run from pipeline-worker dir:
 *   node --env-file=../.env.local --import tsx src/scripts/check-crypto-edges.ts
 */

import { bq } from '../core/bigquery.js';

async function main() {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;

  const { data, error } = await bq.rawQuery<{
    total_edges: number;
    crypto_crypto: number;
    politics_politics: number;
    cross_crypto: number;
  }>(`
    WITH labeled AS (
      SELECT e.*, ma.category AS cat_a, mb.category AS cat_b
      FROM \`${dataset}.market_edges\` e
      JOIN \`${dataset}.markets\` ma ON ma.condition_id = e.market_a
      JOIN \`${dataset}.markets\` mb ON mb.condition_id = e.market_b
      WHERE e.combined_weight > 0.15
    )
    SELECT
      COUNT(*) AS total_edges,
      COUNTIF(cat_a = 'crypto' AND cat_b = 'crypto') AS crypto_crypto,
      COUNTIF(cat_a = 'politics' AND cat_b = 'politics') AS politics_politics,
      COUNTIF((cat_a = 'crypto') != (cat_b = 'crypto')) AS cross_crypto
    FROM labeled
  `);

  if (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }

  console.log(JSON.stringify(data?.[0], null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
