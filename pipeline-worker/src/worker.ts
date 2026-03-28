/**
 * Clearline Pipeline Worker — persistent Node.js process.
 *
 * Runs on Railway. Manages:
 *   1. WebSocket connection to Polymarket (real-time data)
 *   2. Scheduled pipeline jobs (ingestion → enrichment → intelligence)
 *   3. Dirty market tracking (only recompute what changed)
 */

import { registerJob, startScheduler } from './core/scheduler.js';
import { dirtyTracker } from './core/dirty-tracker.js';
import { bq } from './core/bigquery.js';
import { supabaseAdmin } from './core/supabase.js';

// ─── Ingestion Layer ───
import { pollMarkets } from './ingestion/market-discovery.js';
import { snapshotBooks } from './ingestion/book-fetcher.js';
import { pollTrades } from './ingestion/trade-fetcher.js';

// ─── Enrichment Layer ───
import { computeAnalytics } from './enrichment/analytics-engine.js';
import { computeEdgeAnalytics } from './enrichment/edge-engine.js';
import { profileWallets } from './enrichment/wallet-profiler.js';
import { computeAccuracy } from './enrichment/accuracy-computer.js';
import { computeTier1Signals } from './enrichment/tier1-signals.js';
import { computeCorrelations } from './enrichment/correlation-engine.js';
import { trackPositions } from './enrichment/position-tracker.js';

// ─── Intelligence Layer ───
import { computeCandidateScores } from './intelligence/candidate-ranker.js';
import { scanForAlerts } from './intelligence/alert-generator.js';
import { detectAndFlagMoves } from './intelligence/move-detector.js';

// ─── WebSocket ───
// import { startWsConsumer, updateSubscriptions } from './ingestion/ws-consumer.js';

// ─── Health endpoint for Railway ───
import http from 'node:http';
const PORT = parseInt(process.env.PORT || '3000', 10);
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(PORT, () => console.log(`[Worker] Health server on port ${PORT}`));

// ─── Startup ───

console.log('╔══════════════════════════════════════╗');
console.log('║   CLEARLINE PIPELINE WORKER v1.0     ║');
console.log('║   Ingestion → Enrichment → Intel     ║');
console.log('╚══════════════════════════════════════╝');
console.log('');

// ─── Register Jobs ───

// Ingestion: every 5 minutes
registerJob('market-discovery', '*/5 * * * *', async () => {
  const result = await pollMarkets();
  console.log(`  → Markets upserted: ${result.upserted}, errors: ${result.errors.length}`);
  if (result.errors.length > 0) console.log(`  → Errors: ${result.errors.slice(0, 3).join('; ')}`);
});

registerJob('book-fetcher', '*/5 * * * *', async () => {
  const result = await snapshotBooks();
  console.log(`  → Books updated: ${result.updated}, errors: ${result.errors.length}`);
});

registerJob('trade-fetcher', '*/5 * * * *', async () => {
  const result = await pollTrades();
  console.log(`  → Trades inserted: ${result.inserted}, markets: ${result.telemetry.marketsSelected}`);
});

// Enrichment: every 10 minutes
registerJob('analytics', '*/10 * * * *', async () => {
  const result = await computeAnalytics();
  console.log(`  → Analytics computed: ${result.computed}, errors: ${result.errors.length}`);
});

registerJob('edge-analytics', '*/10 * * * *', async () => {
  const result = await computeEdgeAnalytics();
  console.log(`  → Edge computed: ${result.computed}, bullish: ${result.telemetry.bullishMarkets}, bearish: ${result.telemetry.bearishMarkets}`);
});

registerJob('candidates', '*/10 * * * *', async () => {
  const result = await computeCandidateScores();
  console.log(`  → Candidates scored: ${result.computed}, top: ${result.telemetry.topScore}, filtered: ${result.telemetry.filteredOut}`);
  if (result.errors.length > 0) console.log(`  → Candidate errors: ${result.errors.slice(0, 3).join('; ')}`);
});

// Enrichment: every 30 minutes
registerJob('wallet-profiler', '*/30 * * * *', async () => {
  const result = await profileWallets();
  console.log(`  → Wallets profiled: ${result.updated}, errors: ${result.errors.length}`);
});

registerJob('accuracy', '*/30 * * * *', async () => {
  const result = await computeAccuracy();
  console.log(`  → Resolved: ${result.resolved}, wallets updated: ${result.walletsUpdated}`);
});

registerJob('tier1-signals', '*/30 * * * *', async () => {
  const result = await computeTier1Signals();
  console.log(`  → Tier1 computed: ${result.computed}, flagged: ${result.flagged}`);
});

registerJob('positions', '*/30 * * * *', async () => {
  const result = await trackPositions();
  console.log(`  → Positions tracked: ${result.tracked}, errors: ${result.errors.length}`);
});

// Intelligence: every 30 minutes
registerJob('alerts', '*/30 * * * *', async () => {
  const result = await scanForAlerts();
  console.log(`  → Alerts: ${result.alerts.length}`);
});

registerJob('move-detector', '*/30 * * * *', async () => {
  const result = await detectAndFlagMoves();
  console.log(`  → Moves detected: ${result.detected}, flagged: ${result.flagged}`);
});

// Correlations: every 60 minutes
registerJob('correlations', '0 * * * *', async () => {
  const result = await computeCorrelations();
  console.log(`  → Correlations computed: ${result.computed}, errors: ${result.errors.length}`);
});

// ─── Start Scheduler ───

startScheduler();

// ─── Run initial pipeline on startup ───

async function runInitialPipeline(): Promise<void> {
  console.log('\n[Worker] Running initial pipeline cycle...\n');

  try {
    console.log('[1/6] Market discovery...');
    const markets = await pollMarkets();
    console.log(`  → ${markets.upserted} markets upserted`);

    console.log('[2/6] Book snapshots...');
    const books = await snapshotBooks();
    console.log(`  → ${books.updated} books updated`);

    console.log('[3/6] Trade fetching...');
    const trades = await pollTrades();
    console.log(`  → ${trades.inserted} trades inserted`);

    console.log('[4/6] Analytics + Edge...');
    const [analytics, edge] = await Promise.all([
      computeAnalytics(),
      computeEdgeAnalytics(),
    ]);
    console.log(`  → Analytics: ${analytics.computed}, Edge: ${edge.computed}`);

    console.log('[5/6] Candidate scoring...');
    const candidates = await computeCandidateScores();
    console.log(`  → ${candidates.computed} candidates scored (top: ${candidates.telemetry.topScore})`);

    console.log('[6/6] Alerts + Moves...');
    const [alerts, moves] = await Promise.all([
      scanForAlerts(),
      detectAndFlagMoves(),
    ]);
    console.log(`  → Alerts: ${alerts.alerts.length}, Moves flagged: ${moves.flagged}`);

    console.log('\n[Worker] Initial pipeline complete. Scheduler is running.\n');
  } catch (err) {
    console.error('[Worker] Initial pipeline error:', err);
    console.log('[Worker] Scheduler will retry on next cycle.\n');
  }
}

// Start initial pipeline after a short delay to let env vars settle
setTimeout(runInitialPipeline, 2000);

// ─── Keep process alive ───
process.on('SIGINT', () => {
  console.log('\n[Worker] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Worker] Received SIGTERM, shutting down...');
  process.exit(0);
});
