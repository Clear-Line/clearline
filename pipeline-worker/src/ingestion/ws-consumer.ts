/**
 * WebSocket Consumer — connects to Polymarket's public market WebSocket
 * for real-time price changes, trades, and book updates.
 *
 * Buffers events in memory and flushes to BigQuery every 2 minutes.
 * Marks modified markets as dirty via the DirtyTracker.
 *
 * Endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/market
 * Auth: None required (public channel)
 */

import WebSocket from 'ws';
import { bq } from '../core/bigquery.js';
import { dirtyTracker } from '../core/dirty-tracker.js';

// ─── Types ───

interface WsEvent {
  market: string;          // asset_id / token_id
  type: string;            // 'price_change', 'trade', 'book'
  price?: number;
  size?: number;
  side?: string;
  timestamp: number;
  raw?: unknown;
}

interface BufferedSnapshot {
  market_id: string;
  timestamp: string;
  yes_price: number;
}

interface BufferedTrade {
  market_id: string;
  timestamp: string;
  price: number;
  size_usdc: number;
  side: string;
}

// ─── Config ───

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const FLUSH_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const MAX_BUFFER_SIZE = 10_000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const SUBSCRIPTION_REFRESH_MS = 30 * 60 * 1000; // 30 minutes

// ─── State ───

let ws: WebSocket | null = null;
let reconnectAttempt = 0;
let isRunning = false;
let subscribedMarkets: string[] = [];

// Market ID mapping: asset_id (token) -> condition_id (our market_id)
const assetToMarket = new Map<string, string>();

// Buffers
const snapshotBuffer: BufferedSnapshot[] = [];
const tradeBuffer: BufferedTrade[] = [];

// ─── Public API ───

/**
 * Start the WebSocket consumer.
 * @param marketSubscriptions Array of { assetId, marketId } to subscribe to
 */
export function startWsConsumer(
  marketSubscriptions: { assetId: string; marketId: string }[],
): void {
  if (isRunning) return;
  isRunning = true;

  // Build asset -> market mapping
  for (const sub of marketSubscriptions) {
    assetToMarket.set(sub.assetId, sub.marketId);
  }
  subscribedMarkets = marketSubscriptions.map((s) => s.assetId);

  connect();

  // Start flush timer
  setInterval(flushBuffers, FLUSH_INTERVAL_MS);
}

/**
 * Update subscriptions (e.g., after market discovery finds new high-volume markets).
 */
export function updateSubscriptions(
  marketSubscriptions: { assetId: string; marketId: string }[],
): void {
  for (const sub of marketSubscriptions) {
    assetToMarket.set(sub.assetId, sub.marketId);
  }
  subscribedMarkets = [...assetToMarket.keys()];

  // If connected, send updated subscription
  if (ws && ws.readyState === WebSocket.OPEN) {
    sendSubscriptions();
  }
}

export function stopWsConsumer(): void {
  isRunning = false;
  if (ws) {
    ws.close();
    ws = null;
  }
}

export function getBufferStats(): { snapshots: number; trades: number; subscriptions: number } {
  return {
    snapshots: snapshotBuffer.length,
    trades: tradeBuffer.length,
    subscriptions: subscribedMarkets.length,
  };
}

// ─── Connection ───

function connect(): void {
  if (!isRunning) return;

  console.log(`[WS] Connecting to ${WS_URL}...`);
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`[WS] Connected. Subscribing to ${subscribedMarkets.length} markets...`);
    reconnectAttempt = 0;
    sendSubscriptions();
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    } catch (err) {
      // Ignore parse errors for non-JSON messages (ping/pong, etc.)
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Disconnected: code=${code} reason=${reason?.toString()}`);
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error:`, err.message);
    // Connection will be cleaned up by the 'close' handler
  });
}

function sendSubscriptions(): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  // Polymarket WebSocket subscription format
  for (const assetId of subscribedMarkets) {
    ws.send(JSON.stringify({
      type: 'subscribe',
      channel: 'market',
      assets_ids: [assetId],
    }));
  }
}

function scheduleReconnect(): void {
  if (!isRunning) return;

  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt) + Math.random() * 500,
    RECONNECT_MAX_MS,
  );
  reconnectAttempt++;

  console.log(`[WS] Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempt})...`);
  setTimeout(connect, delay);
}

// ─── Message Handling ───

function handleMessage(msg: any): void {
  // Polymarket sends different event types — adapt based on actual message format
  // The exact format depends on the channel; this handles the common patterns
  const assetId = msg.asset_id || msg.market;
  if (!assetId) return;

  const marketId = assetToMarket.get(assetId);
  if (!marketId) return; // Not a market we're tracking

  const now = new Date().toISOString();

  // Price change event
  if (msg.price !== undefined) {
    snapshotBuffer.push({
      market_id: marketId,
      timestamp: now,
      yes_price: Number(msg.price),
    });
    dirtyTracker.mark(marketId);
  }

  // Trade event
  if (msg.size !== undefined && msg.side !== undefined) {
    tradeBuffer.push({
      market_id: marketId,
      timestamp: now,
      price: Number(msg.price) || 0,
      size_usdc: Number(msg.size) || 0,
      side: String(msg.side).toUpperCase(),
    });
    dirtyTracker.mark(marketId);
  }

  // Trim buffers if too large
  if (snapshotBuffer.length > MAX_BUFFER_SIZE) snapshotBuffer.splice(0, snapshotBuffer.length - MAX_BUFFER_SIZE);
  if (tradeBuffer.length > MAX_BUFFER_SIZE) tradeBuffer.splice(0, tradeBuffer.length - MAX_BUFFER_SIZE);
}

// ─── Buffer Flush ───

async function flushBuffers(): Promise<void> {
  // Drain buffers atomically
  const snapshots = snapshotBuffer.splice(0, snapshotBuffer.length);
  const trades = tradeBuffer.splice(0, tradeBuffer.length);

  if (snapshots.length === 0 && trades.length === 0) return;

  console.log(`[WS] Flushing ${snapshots.length} snapshots, ${trades.length} trades to BigQuery...`);

  // Flush snapshots
  if (snapshots.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < snapshots.length; i += BATCH) {
      const chunk = snapshots.slice(i, i + BATCH);
      const { error } = await bq.from('market_snapshots').insert(chunk);
      if (error) {
        console.error(`[WS] Snapshot flush error: ${error.message}`);
      }
    }
  }

  // Flush trades (upsert to avoid duplicates)
  if (trades.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < trades.length; i += BATCH) {
      const chunk = trades.slice(i, i + BATCH);
      const { error } = await bq.from('market_snapshots').insert(
        chunk.map((t) => ({
          market_id: t.market_id,
          timestamp: t.timestamp,
          yes_price: t.price,
          volume_24h: t.size_usdc,
        })),
      );
      if (error) {
        console.error(`[WS] Trade flush error: ${error.message}`);
      }
    }
  }

  console.log(`[WS] Flush complete.`);
}
