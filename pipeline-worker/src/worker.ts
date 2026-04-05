/**
 * Clearline Pipeline Worker v2.0 — simplified.
 *
 * 6 jobs (down from 13):
 *   Ingestion:    market-discovery, book-fetcher, trade-fetcher
 *   Enrichment:   accuracy, wallet-profiler
 *   Intelligence: smart-money-scanner (→ market_cards table)
 */

import { registerJob, startScheduler } from './core/scheduler.js';
import http from 'node:http';

// ─── Ingestion Layer ───
import { pollMarkets } from './ingestion/market-discovery.js';
import { snapshotBooks } from './ingestion/book-fetcher.js';
import { startChainListener, stopChainListener } from './ingestion/chain-listener.js';
import { loadTokenRegistry } from './core/token-registry.js';

// ─── Enrichment Layer ───
import { computeAccuracy } from './enrichment/accuracy-computer.js';
import { profileWallets } from './enrichment/wallet-profiler.js';
// ─── Intelligence Layer ───
import { scanSmartMoney } from './intelligence/smart-money-scanner.js';
import { computeEdges } from './intelligence/edge-computer.js';

// ─── Maintenance ───
import { ensureTables } from './core/ensure-tables.js';
import { purgeOldData } from './core/purge.js';

// ─── Health endpoint for Railway ───
const PORT = parseInt(process.env.PORT || '3000', 10);
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(PORT, () => console.log(`[Worker] Health server on port ${PORT}`));

// ─── Startup ───

console.log('');
console.log('  CLEARLINE PIPELINE WORKER v4.1 (cost-optimized)');
console.log('  Trades: Polygon chain listener every 15min');
console.log('  Ingestion: 2h | Scanner: 6h | Enrichment: daily');
console.log('  Crypto: DISABLED');
console.log('');

// ─── Register Jobs ───

// Ingestion: every 2 hours (reduced from 30min to cut BigQuery costs)
registerJob('market-discovery', '0 */2 * * *', async () => {
  const result = await pollMarkets();
  console.log(`  -> Markets upserted: ${result.upserted}, errors: ${result.errors.length}`);
  // Refresh token registry so chain listener picks up new markets
  const size = await loadTokenRegistry();
  console.log(`  -> Token registry refreshed: ${size} tokens`);
});

// Book snapshots: every 2 hours (reduced from 30min)
registerJob('book-fetcher', '15 */2 * * *', async () => {
  const result = await snapshotBooks();
  console.log(`  -> Books updated: ${result.updated}, errors: ${result.errors.length}`);
});

// trade-fetcher replaced by chain-listener (started on boot, not cron)

// Enrichment: daily (heavy queries — markets resolve slowly)
registerJob('accuracy', '0 6 * * *', async () => {
  const result = await computeAccuracy();
  console.log(`  -> Resolved: ${result.resolved}, wallets updated: ${result.walletsUpdated}`);
});

// Wallet profiler: daily (cosmetic stats, accuracy is separate)
registerJob('wallet-profiler', '30 6 * * *', async () => {
  const result = await profileWallets();
  console.log(`  -> Wallets profiled: ${result.updated}, errors: ${result.errors.length}`);
});

// Intelligence: every 6 hours — builds market_cards table (reduced from 2h, biggest cost saver)
registerJob('smart-money-scanner', '0 */6 * * *', async () => {
  const result = await scanSmartMoney();
  const t = result.telemetry;
  console.log(`  -> Cards: ${result.cards}, signals: ${t.marketsWithSignal}, wallets: ${t.smartWalletsUsed}`);
  if (t.divergencesDetected > 0) console.log(`  -> Volume divergences: ${t.divergencesDetected}`);
  if (t.vacuumsDetected > 0) console.log(`  -> Liquidity vacuums: ${t.vacuumsDetected}`);
  if (result.errors.length > 0) console.log(`  -> Errors: ${result.errors.slice(0, 3).join('; ')}`);
});

// Maintenance: purge old data daily
registerJob('data-purge', '0 3 * * *', async () => {
  const result = await purgeOldData();
  console.log(`  -> Purged: ${result.snapshotsDeleted} snapshots, ${result.tradesDeleted} trades`);
  if (result.errors.length > 0) console.log(`  -> Purge errors: ${result.errors.join('; ')}`);
});

// Constellation: daily at 3:30am UTC — computes market_edges for constellation map
registerJob('edge-computer', '30 3 * * *', async () => {
  const result = await computeEdges();
  const t = result.telemetry;
  console.log(`  -> Edges: ${result.edgesComputed}, markets: ${t.activeMarkets}, multi-wallets: ${t.multiMarketWallets}`);
  console.log(`  -> Pairs with overlap: ${t.pairsWithOverlap}, with correlation: ${t.pairsWithCorrelation}`);
  if (result.errors.length > 0) console.log(`  -> Errors: ${result.errors.slice(0, 3).join('; ')}`);
});

// ─── Start Scheduler ───

startScheduler();

// ─── Run initial pipeline on startup ───

async function runInitialPipeline(): Promise<void> {
  console.log('\n[Worker] Running initial pipeline cycle...\n');

  try {
    // Ensure BigQuery tables exist before any pipeline work
    await ensureTables();

    console.log('[1/5] Market discovery...');
    const markets = await pollMarkets();
    console.log(`  -> ${markets.upserted} markets upserted`);

    console.log('[2/5] Book snapshots + Chain listener...');
    const books = await snapshotBooks();
    console.log(`  -> ${books.updated} books`);

    // Load token registry and start on-chain trade listener
    console.log('[2.5/5] Starting on-chain trade listener...');
    await loadTokenRegistry();
    await startChainListener();

    console.log('[3/5] Accuracy (resolving markets + scoring wallets)...');
    const accuracy = await computeAccuracy();
    console.log(`  -> Resolved: ${accuracy.resolved}, wallets scored: ${accuracy.walletsUpdated}`);

    console.log('[3.5/5] Wallet profiling (backfill + incremental)...');
    const wallets = await profileWallets();
    console.log(`  -> Wallets profiled: ${wallets.updated}`);

    console.log('[4/5] Smart money scanner (building market_cards)...');
    const smartMoney = await scanSmartMoney();
    const smt = smartMoney.telemetry;
    console.log(`  -> Cards: ${smartMoney.cards}, signals: ${smt.marketsWithSignal}, wallets: ${smt.smartWalletsUsed}`);
    if (smt.divergencesDetected > 0) console.log(`  -> Volume divergences: ${smt.divergencesDetected}`);
    if (smt.vacuumsDetected > 0) console.log(`  -> Liquidity vacuums: ${smt.vacuumsDetected}`);
    if (smartMoney.errors.length > 0) console.log(`  -> Errors: ${smartMoney.errors.slice(0, 3).join('; ')}`);

    // Edge computation skipped on startup — runs daily at 3:30am UTC to save costs

    console.log('\n[Worker] Initial pipeline complete. Scheduler is running.\n');
  } catch (err) {
    console.error('[Worker] Initial pipeline error:', err);
    console.log('[Worker] Scheduler will retry on next cycle.\n');
  }
}

setTimeout(runInitialPipeline, 2000);

// ─── Keep process alive ───
process.on('SIGINT', () => {
  console.log('\n[Worker] Shutting down...');
  stopChainListener();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Worker] Received SIGTERM, shutting down...');
  stopChainListener();
  process.exit(0);
});
