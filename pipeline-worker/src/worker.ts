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
import { pollTrades } from './ingestion/trade-fetcher.js';

// ─── Enrichment Layer ───
import { computeAccuracy } from './enrichment/accuracy-computer.js';
import { profileWallets } from './enrichment/wallet-profiler.js';

// ─── Intelligence Layer ───
import { scanSmartMoney } from './intelligence/smart-money-scanner.js';

// ─── Health endpoint for Railway ───
const PORT = parseInt(process.env.PORT || '3000', 10);
http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(PORT, () => console.log(`[Worker] Health server on port ${PORT}`));

// ─── Startup ───

console.log('');
console.log('  CLEARLINE PIPELINE WORKER v2.0');
console.log('  Simplified: 6 jobs, 1 signal');
console.log('  Signal: Smart money buy/sell');
console.log('');

// ─── Register Jobs ───

// Ingestion: every 5 minutes
registerJob('market-discovery', '*/5 * * * *', async () => {
  const result = await pollMarkets();
  console.log(`  -> Markets upserted: ${result.upserted}, errors: ${result.errors.length}`);
});

registerJob('book-fetcher', '*/5 * * * *', async () => {
  const result = await snapshotBooks();
  console.log(`  -> Books updated: ${result.updated}, errors: ${result.errors.length}`);
});

registerJob('trade-fetcher', '*/5 * * * *', async () => {
  const result = await pollTrades();
  console.log(`  -> Trades inserted: ${result.inserted}, markets: ${result.telemetry.marketsSelected}`);
});

// Enrichment: every 30 minutes
registerJob('accuracy', '*/30 * * * *', async () => {
  const result = await computeAccuracy();
  console.log(`  -> Resolved: ${result.resolved}, wallets updated: ${result.walletsUpdated}`);
});

registerJob('wallet-profiler', '*/30 * * * *', async () => {
  const result = await profileWallets();
  console.log(`  -> Wallets profiled: ${result.updated}, errors: ${result.errors.length}`);
});

// Intelligence: every 10 minutes — builds market_cards table
registerJob('smart-money-scanner', '*/10 * * * *', async () => {
  const result = await scanSmartMoney();
  console.log(`  -> Cards built: ${result.cards}, with signal: ${result.telemetry.marketsWithSignal}, smart wallets: ${result.telemetry.smartWalletsUsed}`);
  if (result.errors.length > 0) console.log(`  -> Errors: ${result.errors.slice(0, 3).join('; ')}`);
});

// ─── Start Scheduler ───

startScheduler();

// ─── Run initial pipeline on startup ───

async function runInitialPipeline(): Promise<void> {
  console.log('\n[Worker] Running initial pipeline cycle...\n');

  try {
    console.log('[1/4] Market discovery...');
    const markets = await pollMarkets();
    console.log(`  -> ${markets.upserted} markets upserted`);

    console.log('[2/4] Book snapshots + Trade fetching...');
    const [books, trades] = await Promise.all([
      snapshotBooks(),
      pollTrades(),
    ]);
    console.log(`  -> ${books.updated} books, ${trades.inserted} trades`);

    console.log('[3/4] Accuracy + Wallet profiling...');
    const [accuracy, wallets] = await Promise.all([
      computeAccuracy(),
      profileWallets(),
    ]);
    console.log(`  -> Resolved: ${accuracy.resolved}, wallets: ${wallets.updated}`);

    console.log('[4/4] Smart money scanner (building market_cards)...');
    const smartMoney = await scanSmartMoney();
    console.log(`  -> Cards: ${smartMoney.cards}, with signal: ${smartMoney.telemetry.marketsWithSignal}`);
    if (smartMoney.errors.length > 0) console.log(`  -> Errors: ${smartMoney.errors.slice(0, 3).join('; ')}`);

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
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Worker] Received SIGTERM, shutting down...');
  process.exit(0);
});
