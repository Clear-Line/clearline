import { bq } from '../core/bigquery.js';
import { extractCryptoUnderlying } from '../intelligence/lib/categorize.js';

async function main() {
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const { data, error } = await bq.rawQuery<{ condition_id: string; question: string }>(`
    SELECT condition_id, question
    FROM \`${dataset}.markets\`
    WHERE category = 'crypto' AND is_active = true AND is_resolved = false
  `);
  if (error) { console.error(error.message); process.exit(1); }

  const total = data?.length ?? 0;
  const byUnderlying = new Map<string, number>();
  let withUnderlying = 0;
  for (const m of data ?? []) {
    const u = extractCryptoUnderlying(m.question);
    if (u) {
      withUnderlying++;
      byUnderlying.set(u, (byUnderlying.get(u) ?? 0) + 1);
    }
  }
  console.log(`total crypto markets: ${total}`);
  console.log(`with extractable underlying: ${withUnderlying}`);
  console.log('by underlying:', Object.fromEntries(byUnderlying));
  const pairs = [...byUnderlying.values()].reduce((s, n) => s + (n * (n - 1)) / 2, 0);
  console.log(`expected C(n,2) pairs: ${pairs}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
