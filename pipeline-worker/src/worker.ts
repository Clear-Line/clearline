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
import { checkBtcResolutions } from './enrichment/btc-resolution-checker.js';
// ─── Intelligence Layer ───
import { scanSmartMoney } from './intelligence/smart-money-scanner.js';
import { scoreCryptoSentiment } from './intelligence/crypto-sentiment-scorer.js';

// ─── Crypto Layer ───
import { fetchDerivatives } from './ingestion/derivatives-fetcher.js';

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
console.log('  CLEARLINE PIPELINE WORKER v4.0 (on-chain trade ingestion)');
console.log('  Trades: real-time Polygon chain listener (politics/geopolitics/economics/crypto)');
console.log('  Ingestion: 30min | Scanner: 2h | Enrichment: 6h');
console.log('  Crypto: 10min derivatives + sentiment scoring');
console.log('');

// ─── Register Jobs ───

// Ingestion: every 30 minutes (reduced to cut BigQuery costs)
registerJob('market-discovery', '*/30 * * * *', async () => {
  const result = await pollMarkets();
  console.log(`  -> Markets upserted: ${result.upserted}, errors: ${result.errors.length}`);
  // Refresh token registry so chain listener picks up new markets
  const size = await loadTokenRegistry();
  console.log(`  -> Token registry refreshed: ${size} tokens`);
});

registerJob('book-fetcher', '*/30 * * * *', async () => {
  const result = await snapshotBooks();
  console.log(`  -> Books updated: ${result.updated}, errors: ${result.errors.length}`);
});

// trade-fetcher replaced by chain-listener (started on boot, not cron)

// Enrichment: every 6 hours (heavy queries — run infrequently to save costs)
registerJob('accuracy', '0 */6 * * *', async () => {
  const result = await computeAccuracy();
  console.log(`  -> Resolved: ${result.resolved}, wallets updated: ${result.walletsUpdated}`);
});

registerJob('wallet-profiler', '30 */6 * * *', async () => {
  const result = await profileWallets();
  console.log(`  -> Wallets profiled: ${result.updated}, errors: ${result.errors.length}`);
});

// Intelligence: every 2 hours — builds market_cards table
registerJob('smart-money-scanner', '0 */2 * * *', async () => {
  const result = await scanSmartMoney();
  const t = result.telemetry;
  console.log(`  -> Cards: ${result.cards}, signals: ${t.marketsWithSignal}, wallets: ${t.smartWalletsUsed}`);
  if (t.divergencesDetected > 0) console.log(`  -> Volume divergences: ${t.divergencesDetected}`);
  if (t.vacuumsDetected > 0) console.log(`  -> Liquidity vacuums: ${t.vacuumsDetected}`);
  if (result.errors.length > 0) console.log(`  -> Errors: ${result.errors.slice(0, 3).join('; ')}`);
});

// Crypto: every 10 minutes — derivatives data + sentiment scoring
registerJob('derivatives-fetcher', '*/10 * * * *', async () => {
  const result = await fetchDerivatives();
  console.log(`  -> Derivatives: ${result.asset} FR=${result.fundingRate.toFixed(6)} CVD1h=$${(result.cvd1h / 1e6).toFixed(1)}M CVD4h=$${(result.cvd4h / 1e6).toFixed(1)}M`);
  if (result.errors.length > 0) console.log(`  -> Errors: ${result.errors.slice(0, 3).join('; ')}`);
});

registerJob('crypto-sentiment-scorer', '2-59/10 * * * *', async () => {
  const result = await scoreCryptoSentiment();
  console.log(`  -> Crypto signals: ${result.signals} computed`);
  if (result.errors.length > 0) console.log(`  -> Errors: ${result.errors.slice(0, 3).join('; ')}`);

  const res = await checkBtcResolutions();
  if (res.resolved > 0) console.log(`  -> BTC cycles resolved: ${res.resolved}`);
  if (res.errors.length > 0) console.log(`  -> Resolution errors: ${res.errors.slice(0, 3).join('; ')}`);
});

// Maintenance: purge old data every 6 hours to keep table sizes small
registerJob('data-purge', '0 */6 * * *', async () => {
  const result = await purgeOldData();
  console.log(`  -> Purged: ${result.snapshotsDeleted} snapshots, ${result.tradesDeleted} trades`);
  if (result.errors.length > 0) console.log(`  -> Purge errors: ${result.errors.join('; ')}`);
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

    console.log('[3/5] Accuracy + Wallet profiling...');
    const [accuracy, wallets] = await Promise.all([
      computeAccuracy(),
      profileWallets(),
    ]);
    console.log(`  -> Resolved: ${accuracy.resolved}, wallets: ${wallets.updated}`);

    console.log('[4/5] Smart money scanner (building market_cards)...');
    const smartMoney = await scanSmartMoney();
    const smt = smartMoney.telemetry;
    console.log(`  -> Cards: ${smartMoney.cards}, signals: ${smt.marketsWithSignal}, wallets: ${smt.smartWalletsUsed}`);
    if (smt.divergencesDetected > 0) console.log(`  -> Volume divergences: ${smt.divergencesDetected}`);
    if (smt.vacuumsDetected > 0) console.log(`  -> Liquidity vacuums: ${smt.vacuumsDetected}`);
    if (smartMoney.errors.length > 0) console.log(`  -> Errors: ${smartMoney.errors.slice(0, 3).join('; ')}`);

    console.log('[5/5] Crypto derivatives + sentiment scoring...');
    const derivResult = await fetchDerivatives();
    console.log(`  -> Derivatives: BTC FR=${derivResult.fundingRate.toFixed(6)} CVD1h=$${(derivResult.cvd1h / 1e6).toFixed(1)}M`);
    const cryptoSignals = await scoreCryptoSentiment();
    console.log(`  -> Crypto signals: ${cryptoSignals.signals} computed`);
    const btcRes = await checkBtcResolutions();
    if (btcRes.resolved > 0) console.log(`  -> BTC cycles resolved: ${btcRes.resolved}`);

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
