/**
 * One-off CLI to trigger the insider-detector once and print its result.
 * Used to validate the detector before relying on the cron in worker.ts.
 *
 * Run from repo root:
 *   node --env-file=.env.local --import tsx pipeline-worker/src/scripts/trigger-insider-detector.ts
 */

import { ensureTables } from '../core/ensure-tables.js';
import { runInsiderDetector } from '../intelligence/insider-detector.js';

async function main() {
  console.log('[trigger] Ensuring market_insiders table exists...');
  await ensureTables();

  console.log('[trigger] Running insider-detector...');
  const result = await runInsiderDetector();

  console.log('\n[trigger] Result:');
  console.log(JSON.stringify(result, null, 2));

  if (result.errors.length > 0) {
    console.error('\n[trigger] FAILED with errors above');
    process.exit(1);
  }

  console.log('\n[trigger] OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('[trigger] Fatal error:', err);
  process.exit(1);
});
