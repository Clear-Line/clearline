/**
 * Exchange API Client — public REST endpoints for derivatives data via Hyperliquid.
 * No authentication required. No geo-blocking (decentralized exchange).
 *
 * All endpoints: POST https://api.hyperliquid.xyz/info
 */

const BASE = 'https://api.hyperliquid.xyz/info';

export interface FundingRateData {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
}

export interface CVDResult {
  cvd: number;      // net buy - sell volume in USD
  buyVol: number;   // estimated taker buy volume in USD
  sellVol: number;  // estimated taker sell volume in USD
}

async function hlPost(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid API failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch the latest funding rate and mark price for a perpetual contract.
 * Uses metaAndAssetCtxs which returns both in one call.
 */
export async function fetchFundingRate(symbol: string = 'BTCUSDT'): Promise<FundingRateData> {
  const coin = symbol.replace('USDT', '');
  const data = await hlPost({ type: 'metaAndAssetCtxs' }) as [
    { universe: { name: string }[] },
    { funding: string; markPx: string }[],
  ];

  const [meta, assetCtxs] = data;
  const idx = meta.universe.findIndex((u) => u.name === coin);
  if (idx === -1) throw new Error(`Hyperliquid: ${coin} not found`);

  return {
    symbol,
    fundingRate: parseFloat(assetCtxs[idx].funding),
    fundingTime: Date.now(),
  };
}

/**
 * Fetch the current mark price (used as spot proxy for perpetual markets).
 */
export async function fetchSpotPrice(symbol: string = 'BTCUSDT'): Promise<number> {
  const coin = symbol.replace('USDT', '');
  const data = await hlPost({ type: 'metaAndAssetCtxs' }) as [
    { universe: { name: string }[] },
    { markPx: string }[],
  ];

  const [meta, assetCtxs] = data;
  const idx = meta.universe.findIndex((u) => u.name === coin);
  if (idx === -1) throw new Error(`Hyperliquid: ${coin} not found`);

  return parseFloat(assetCtxs[idx].markPx);
}

/**
 * Compute Cumulative Volume Delta from 1-minute candles.
 *
 * Hyperliquid candle format: { t, T, s, i, o, c, h, l, v, n }
 * Uses OHLCV approximation:
 *   buyRatio = (close - low) / (high - low)
 *   buyVol  += volume * buyRatio * close
 *   sellVol += volume * (1 - buyRatio) * close
 */
export async function fetchKlinesForCVD(
  symbol: string = 'BTCUSDT',
  intervalMinutes: number = 60,
): Promise<CVDResult> {
  const coin = symbol.replace('USDT', '');
  const now = Date.now();
  const startTime = now - intervalMinutes * 60 * 1000;

  const candles = await hlPost({
    type: 'candleSnapshot',
    req: { coin, interval: '1m', startTime, endTime: now },
  }) as { o: string; h: string; l: string; c: string; v: string }[];

  let buyVol = 0;
  let sellVol = 0;

  for (const k of candles) {
    const open = parseFloat(k.o);
    const high = parseFloat(k.h);
    const low = parseFloat(k.l);
    const close = parseFloat(k.c);
    const volume = parseFloat(k.v);

    const range = high - low;
    const buyRatio = range > 0 ? (close - low) / range : 0.5;

    buyVol += volume * buyRatio * close;
    sellVol += volume * (1 - buyRatio) * close;
  }

  return {
    cvd: buyVol - sellVol,
    buyVol: Math.round(buyVol),
    sellVol: Math.round(sellVol),
  };
}
