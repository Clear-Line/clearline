/**
 * One-off CLI to trigger edge-computer once and print its telemetry.
 *
 * Run from repo root:
 *   node --env-file=.env.local --import tsx pipeline-worker/src/scripts/trigger-edge-computer.ts
 */

import { computeEdges } from '../intelligence/edge-computer.js';

async function main() {
  console.log('[trigger] Running edge-computer...');
  const result = await computeEdges();

  console.log('\n[trigger] Result:');
  console.log(JSON.stringify(result, null, 2));

  if (result.errors.length > 0) {
    console.error('\n[trigger] Non-fatal errors above — check if any are blocking');
  }

  console.log(`\n[trigger] edgesComputed=${result.edgesComputed}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[trigger] Fatal error:', err);
  process.exit(1);
});
