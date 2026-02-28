/**
 * Local test script — runs Tier 1 + Move Detection directly against Supabase.
 * No server needed, no timeout limits.
 *
 * Usage:  npx tsx --tsconfig tsconfig.json scripts/test-analysis.ts
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// Load .env.local manually
const envPath = resolve(process.cwd(), '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  let val = trimmed.slice(eqIdx + 1).trim();
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (!process.env[key]) process.env[key] = val;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseServiceKey);

async function checkTableCounts() {
  console.log('\n=== TABLE COUNTS ===');

  const tables = ['markets', 'trades', 'wallets', 'wallet_signals', 'flagged_moves', 'market_snapshots'];
  for (const table of tables) {
    const { count } = await db.from(table).select('*', { count: 'exact', head: true });
    console.log(`  ${table}: ${count ?? 'error'}`);
  }

  const { count: activeMarkets } = await db.from('markets').select('*', { count: 'exact', head: true }).eq('is_active', true).in('category', ['politics', 'economics']);
  console.log(`  active politics/economics markets: ${activeMarkets}`);

  const { count: signalsAbove04 } = await db.from('wallet_signals').select('*', { count: 'exact', head: true }).gt('composite_score', 0.4);
  console.log(`  wallet_signals with composite > 0.4: ${signalsAbove04}`);

  const { count: signalsAbove05 } = await db.from('wallet_signals').select('*', { count: 'exact', head: true }).gt('composite_score', 0.5);
  console.log(`  wallet_signals with composite > 0.5: ${signalsAbove05}`);
}

async function runTier1() {
  console.log('\n=== RUNNING TIER 1 ANALYSIS ===');
  console.log('(No timeout — will process ALL wallets)\n');

  const { computeTier1Signals } = await import('../src/lib/analysis/tier1-signals');

  const start = Date.now();
  const result = await computeTier1Signals();
  const elapsed = Date.now() - start;

  console.log(`  Duration: ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`  Computed: ${result.computed}`);
  console.log(`  Flagged (composite > 0.5): ${result.flagged}`);
  console.log(`  Telemetry:`, JSON.stringify(result.telemetry, null, 2));
  if (result.errors.length > 0) {
    console.log(`  Errors:`, result.errors);
  }

  return result;
}

async function runMoveDetection() {
  console.log('\n=== RUNNING MOVE DETECTION ===\n');

  const { detectAndFlagMoves } = await import('../src/lib/analysis/move-detector');

  const start = Date.now();
  const result = await detectAndFlagMoves();
  const elapsed = Date.now() - start;

  console.log(`  Duration: ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`  Markets scanned: ${result.detected}`);
  console.log(`  Clusters flagged: ${result.flagged}`);
  console.log(`  Telemetry:`, JSON.stringify(result.telemetry, null, 2));
  if (result.errors.length > 0) {
    console.log(`  Errors:`, result.errors);
  }

  return result;
}

async function main() {
  console.log('Clearline Analysis Test Runner');
  console.log('==============================');

  await checkTableCounts();

  console.log('\n--- Step 1: Tier 1 Signals ---');
  await runTier1();

  const { count: signalsAfter } = await db.from('wallet_signals').select('*', { count: 'exact', head: true });
  console.log(`\n  wallet_signals after Tier 1: ${signalsAfter}`);

  console.log('\n--- Step 2: Move Detection ---');
  await runMoveDetection();

  const { count: flagsAfter } = await db.from('flagged_moves').select('*', { count: 'exact', head: true });
  console.log(`\n  flagged_moves after detection: ${flagsAfter}`);

  const { data: sampleFlags } = await db
    .from('flagged_moves')
    .select('market_id, cluster_score, unique_wallets, signal_direction, summary_text')
    .order('detection_timestamp', { ascending: false })
    .limit(5);

  if (sampleFlags && sampleFlags.length > 0) {
    console.log('\n  Recent flagged moves:');
    for (const f of sampleFlags) {
      console.log(`    Market: ${f.market_id.slice(0, 20)}... | Score: ${f.cluster_score} | Wallets: ${f.unique_wallets} | Dir: ${f.signal_direction}`);
      console.log(`    ${f.summary_text}\n`);
    }
  }

  console.log('\n=== DONE ===');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
