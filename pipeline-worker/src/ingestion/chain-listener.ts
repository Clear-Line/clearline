/**
 * Chain Listener — polls Polymarket trade events directly from Polygon.
 *
 * Replaces the old REST API-based trade-fetcher with on-chain data.
 * Only ingests trades for whitelisted categories (politics, geopolitics, economics, crypto).
 *
 * Flow:
 *   1. Every 5 min, fetch new OrderFilled events via getLogs
 *   2. Look up token ID in registry → get market info + category
 *   3. Skip non-whitelisted categories at the event level
 *   4. INSERT accepted trades to BigQuery
 *   5. Track last processed block for gap recovery on restart
 */

import { getPolygonClient, CTF_EXCHANGE, NEGRISK_CTF_EXCHANGE, orderFilledAbi } from '../core/polygon-client.js';
import { lookupToken, getRegistrySize, type TokenMapping } from '../core/token-registry.js';
import { bq } from '../core/bigquery.js';
import { dirtyTracker } from '../core/dirty-tracker.js';

// ─── Config ───

const ALLOWED_CATEGORIES = new Set(['politics', 'geopolitics', 'economics', 'crypto']);
const POLL_INTERVAL_MS = 300_000; // 5 minutes
const BACKFILL_BATCH_SIZE = 9n; // blocks per getLogs call (Alchemy free tier: max 10 blocks)
const USDC_DECIMALS = 1e6;

// ─── State ───

interface BufferedTrade {
  market_id: string;
  wallet_address: string;
  side: 'BUY' | 'SELL';
  size_tokens: number;
  price: number;
  size_usdc: number;
  outcome: string;
  outcome_index: number;
  transaction_hash: string;
  timestamp: string;
}

let tradeBuffer: BufferedTrade[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastProcessedBlock: bigint = 0n;
let isRunning = false;

// ─── Public API ───

export async function startChainListener(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  const registrySize = getRegistrySize();
  if (registrySize === 0) {
    console.warn('[ChainListener] Token registry is empty — no markets to track. Will retry when registry is refreshed.');
    isRunning = false;
    return;
  }

  // Load last processed block from BigQuery
  const savedBlock = await loadLastBlock();
  const client = getPolygonClient();
  const currentBlock = await client.getBlockNumber();

  if (savedBlock > 0n && savedBlock < currentBlock) {
    console.log(`[ChainListener] Backfilling blocks ${savedBlock + 1n} → ${currentBlock}...`);
    await backfillFromBlock(savedBlock + 1n, currentBlock);
  }

  lastProcessedBlock = currentBlock;

  // Start polling interval
  pollTimer = setInterval(async () => {
    try {
      await pollNewEvents();
    } catch (err) {
      console.error('[ChainListener] Poll error:', err instanceof Error ? err.message : err);
    }
  }, POLL_INTERVAL_MS);

  console.log(`[ChainListener] Polling every 5 min — registry: ${registrySize} tokens, categories: ${[...ALLOWED_CATEGORIES].join(', ')}, block: ${currentBlock}`);
}

export function stopChainListener(): void {
  isRunning = false;

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Final flush
  if (tradeBuffer.length > 0) {
    flushTradeBuffer().catch(() => {});
  }

  console.log('[ChainListener] Stopped');
}

// ─── Polling ───

async function pollNewEvents(): Promise<void> {
  const client = getPolygonClient();
  const currentBlock = await client.getBlockNumber();

  if (currentBlock <= lastProcessedBlock) return;

  const fromBlock = lastProcessedBlock + 1n;
  let eventsReceived = 0;
  let eventsSkippedUnknown = 0;
  let eventsSkippedCategory = 0;
  let eventsAccepted = 0;

  // Chunk into BACKFILL_BATCH_SIZE blocks per call (Alchemy free tier: max 10)
  let current = fromBlock;
  while (current <= currentBlock) {
    const end = current + BACKFILL_BATCH_SIZE > currentBlock ? currentBlock : current + BACKFILL_BATCH_SIZE;

    for (const address of [CTF_EXCHANGE, NEGRISK_CTF_EXCHANGE]) {
      try {
        const logs = await client.getContractEvents({
          address,
          abi: orderFilledAbi,
          eventName: 'OrderFilled',
          fromBlock: current,
          toBlock: end,
        });

        for (const log of logs) {
          eventsReceived++;
          const result = handleOrderFilled(log);
          if (result === 'accepted') eventsAccepted++;
          else if (result === 'unknown') eventsSkippedUnknown++;
          else if (result === 'category') eventsSkippedCategory++;
        }
      } catch (err) {
        console.warn(`[ChainListener] getLogs error (${address === CTF_EXCHANGE ? 'CTF' : 'NegRisk'}) blocks ${current}-${end}: ${err instanceof Error ? err.message : err}`);
      }
    }

    current = end + 1n;
  }

  lastProcessedBlock = currentBlock;

  // Flush and log
  if (tradeBuffer.length > 0) {
    await flushTradeBuffer();
  }

  console.log(
    `[ChainListener] Polled blocks ${fromBlock}→${currentBlock} | ` +
    `events=${eventsReceived} accepted=${eventsAccepted} ` +
    `skipped: unknown=${eventsSkippedUnknown} category=${eventsSkippedCategory}`
  );

  await saveLastBlock(lastProcessedBlock);
}

// ─── Event Handler ───

function handleOrderFilled(log: {
  args: {
    orderHash?: `0x${string}`;
    maker?: `0x${string}`;
    taker?: `0x${string}`;
    makerAssetId?: bigint;
    takerAssetId?: bigint;
    makerAmountFilled?: bigint;
    takerAmountFilled?: bigint;
    fee?: bigint;
  };
  transactionHash?: `0x${string}` | null;
  blockNumber?: bigint | null;
}): 'accepted' | 'unknown' | 'category' | 'invalid' {
  const { maker, taker, makerAssetId, takerAssetId, makerAmountFilled, takerAmountFilled } = log.args;
  if (makerAssetId == null || takerAssetId == null) return 'invalid';

  // Determine which side is the outcome token and which is collateral (0 = USDC)
  let tokenMapping: TokenMapping | undefined;
  let side: 'BUY' | 'SELL';
  let usdcAmount: bigint;
  let tokenAmount: bigint;
  let walletAddress: string;

  if (makerAssetId === 0n) {
    // Maker provides USDC → BUY
    tokenMapping = lookupToken(takerAssetId.toString());
    side = 'BUY';
    walletAddress = (taker ?? maker ?? '').toLowerCase();
    usdcAmount = makerAmountFilled ?? 0n;
    tokenAmount = takerAmountFilled ?? 0n;
  } else if (takerAssetId === 0n) {
    // Taker provides USDC → SELL
    tokenMapping = lookupToken(makerAssetId.toString());
    side = 'SELL';
    walletAddress = (taker ?? maker ?? '').toLowerCase();
    usdcAmount = takerAmountFilled ?? 0n;
    tokenAmount = makerAmountFilled ?? 0n;
  } else {
    // Token-for-token swap (rare)
    tokenMapping = lookupToken(makerAssetId.toString()) || lookupToken(takerAssetId.toString());
    if (!tokenMapping) return 'unknown';
    side = 'BUY';
    walletAddress = (taker ?? maker ?? '').toLowerCase();
    usdcAmount = makerAmountFilled ?? 0n;
    tokenAmount = takerAmountFilled ?? 0n;
  }

  if (!tokenMapping) return 'unknown';
  if (!ALLOWED_CATEGORIES.has(tokenMapping.category)) return 'category';

  // Compute price and amounts
  const usdcValue = Number(usdcAmount) / USDC_DECIMALS;
  const tokenValue = Number(tokenAmount) / USDC_DECIMALS;
  const price = tokenValue > 0 ? usdcValue / tokenValue : 0;

  tradeBuffer.push({
    market_id: tokenMapping.conditionId,
    wallet_address: walletAddress,
    side,
    size_tokens: tokenValue,
    price: Math.round(price * 1e6) / 1e6,
    size_usdc: Math.round(usdcValue * 100) / 100,
    outcome: tokenMapping.outcomeName,
    outcome_index: tokenMapping.outcomeIndex,
    transaction_hash: log.transactionHash ?? '',
    timestamp: new Date().toISOString(),
  });

  return 'accepted';
}

// ─── Buffer Flush ───

async function flushTradeBuffer(): Promise<void> {
  if (tradeBuffer.length === 0) return;

  const batch = tradeBuffer.splice(0);

  // Deduplicate by transaction_hash
  const seen = new Set<string>();
  const unique = batch.filter(t => {
    if (!t.transaction_hash || seen.has(t.transaction_hash)) return false;
    seen.add(t.transaction_hash);
    return true;
  });

  if (unique.length === 0) return;

  // INSERT — on-chain tx hashes are guaranteed unique, saves DML quota
  const { error: tradeErr } = await bq.from('trades').insert(unique);

  if (tradeErr) {
    console.error(`[ChainListener] Trade insert error: ${tradeErr.message}`);
    return;
  }

  // Upsert wallet addresses (enrichment adds usernames later)
  const walletAddresses = [...new Set(unique.map(t => t.wallet_address))];
  const walletRows = walletAddresses.map(addr => ({
    address: addr,
    last_updated: new Date().toISOString(),
  }));

  if (walletRows.length > 0) {
    const { error: walletErr } = await bq.from('wallets').upsert(walletRows, {
      onConflict: 'address',
      ignoreDuplicates: true,
    });
    if (walletErr) {
      console.error(`[ChainListener] Wallet upsert error: ${walletErr.message}`);
    }
  }

  // Mark markets as dirty for downstream enrichment
  dirtyTracker.markMany([...new Set(unique.map(t => t.market_id))]);

  // Accumulate wallet positions (for accuracy scoring without API dependency)
  await accumulatePositions(unique);

  console.log(`[ChainListener] Flushed ${unique.length} trades (${walletAddresses.length} wallets)`);
}

/**
 * Accumulate net wallet positions from trades using a single additive MERGE.
 * One row per (wallet_address, market_id) pair. Never purged by time —
 * cleaned up by accuracy-computer after market resolution.
 */
async function accumulatePositions(trades: typeof tradeBuffer): Promise<void> {
  // Group by (wallet_address, market_id)
  const deltas = new Map<string, {
    wallet_address: string;
    market_id: string;
    outcome: string;
    buy_volume: number;
    sell_volume: number;
    buy_price_sum: number;
    buy_count: number;
    sell_count: number;
    last_trade_at: string;
  }>();

  for (const t of trades) {
    const key = `${t.wallet_address}|${t.market_id}`;
    const d = deltas.get(key) ?? {
      wallet_address: t.wallet_address,
      market_id: t.market_id,
      outcome: t.outcome,
      buy_volume: 0, sell_volume: 0,
      buy_price_sum: 0, buy_count: 0, sell_count: 0,
      last_trade_at: t.timestamp,
    };

    if (t.side === 'BUY') {
      d.buy_volume += t.size_usdc;
      d.buy_price_sum += t.price;
      d.buy_count++;
    } else {
      d.sell_volume += t.size_usdc;
      d.sell_count++;
    }
    d.outcome = t.outcome;
    if (t.timestamp > d.last_trade_at) d.last_trade_at = t.timestamp;
    deltas.set(key, d);
  }

  if (deltas.size === 0) return;

  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;
  const now = new Date().toISOString();

  // Build source rows for MERGE
  const sourceRows = [...deltas.values()].map((d) => {
    const avgBuyPrice = d.buy_count > 0 ? Math.round((d.buy_price_sum / d.buy_count) * 1e6) / 1e6 : 0;
    return `SELECT '${d.wallet_address}' AS wallet_address, '${d.market_id}' AS market_id, '${d.outcome.replace(/'/g, "\\'")}' AS outcome, ${d.buy_volume} AS buy_volume, ${d.sell_volume} AS sell_volume, ${avgBuyPrice} AS avg_buy_price, ${d.buy_count} AS buy_count, ${d.sell_count} AS sell_count, TIMESTAMP('${d.last_trade_at}') AS last_trade_at, TIMESTAMP('${now}') AS updated_at`;
  });

  const mergeSQL = `
    MERGE \`${dataset}.wallet_trade_positions\` AS target
    USING (${sourceRows.join('\nUNION ALL\n')}) AS source
    ON target.wallet_address = source.wallet_address AND target.market_id = source.market_id
    WHEN MATCHED THEN UPDATE SET
      buy_volume = target.buy_volume + source.buy_volume,
      sell_volume = target.sell_volume + source.sell_volume,
      avg_buy_price = CASE
        WHEN target.buy_count + source.buy_count > 0
        THEN ROUND((target.avg_buy_price * target.buy_count + source.avg_buy_price * source.buy_count)
             / (target.buy_count + source.buy_count), 6)
        ELSE 0
      END,
      buy_count = target.buy_count + source.buy_count,
      sell_count = target.sell_count + source.sell_count,
      outcome = source.outcome,
      last_trade_at = GREATEST(target.last_trade_at, source.last_trade_at),
      updated_at = source.updated_at
    WHEN NOT MATCHED THEN
      INSERT (wallet_address, market_id, outcome, buy_volume, sell_volume, avg_buy_price, buy_count, sell_count, last_trade_at, updated_at)
      VALUES (source.wallet_address, source.market_id, source.outcome, source.buy_volume, source.sell_volume, source.avg_buy_price, source.buy_count, source.sell_count, source.last_trade_at, source.updated_at)
  `;

  try {
    await bq.rawQuery(mergeSQL);
  } catch (err) {
    // Don't block trade pipeline — positions are a bonus, not critical path
    console.warn(`[ChainListener] Position accumulation failed: ${err}`);
  }
}

// ─── Backfill ───

async function backfillFromBlock(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const client = getPolygonClient();
  let current = fromBlock;
  let totalEvents = 0;

  while (current <= toBlock) {
    const end = current + BACKFILL_BATCH_SIZE > toBlock ? toBlock : current + BACKFILL_BATCH_SIZE;

    for (const address of [CTF_EXCHANGE, NEGRISK_CTF_EXCHANGE]) {
      try {
        const logs = await client.getContractEvents({
          address,
          abi: orderFilledAbi,
          eventName: 'OrderFilled',
          fromBlock: current,
          toBlock: end,
        });

        for (const log of logs) {
          handleOrderFilled(log);
        }
        totalEvents += logs.length;
      } catch (err) {
        console.warn(`[ChainListener] Backfill error at blocks ${current}-${end}: ${err instanceof Error ? err.message : err}`);
      }
    }

    current = end + 1n;
  }

  if (tradeBuffer.length > 0) {
    await flushTradeBuffer();
  }

  console.log(`[ChainListener] Backfill complete: ${totalEvents} events processed`);
}

// ─── Block Persistence ───

async function loadLastBlock(): Promise<bigint> {
  try {
    const { data } = await bq
      .from('pipeline_metadata')
      .select('value')
      .eq('key', 'chain_listener_last_block')
      .limit(1);

    if (data && data.length > 0 && data[0].value) {
      return BigInt(data[0].value);
    }
  } catch {
    // Table may not exist yet on first run
  }
  return 0n;
}

async function saveLastBlock(block: bigint): Promise<void> {
  try {
    await bq.from('pipeline_metadata').upsert(
      [{
        key: 'chain_listener_last_block',
        value: block.toString(),
        updated_at: new Date().toISOString(),
      }],
      { onConflict: 'key' },
    );
  } catch (err) {
    console.warn(`[ChainListener] Failed to save block number: ${err instanceof Error ? err.message : err}`);
  }
}
