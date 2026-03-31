/**
 * Exchange API Client — public REST endpoints for derivatives data.
 * Hyperliquid: funding rate, spot price, open interest, CVD
 * Deribit: BTC options skew (put/call OI ratio)
 *
 * No authentication required. No geo-blocking.
 */

const HL_BASE = 'https://api.hyperliquid.xyz/info';

export interface FundingRateData {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
  openInterest: number; // total OI in coins
}

export interface CVDResult {
  cvd: number;      // net buy - sell volume in USD
  buyVol: number;   // estimated taker buy volume in USD
  sellVol: number;  // estimated taker sell volume in USD
}

export interface OptionsSkewData {
  skew: number;    // putOI/callOI - 1.0 (positive = bearish, negative = bullish)
  putOI: number;
  callOI: number;
}

async function hlPost(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(HL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid API failed: ${res.status}`);
  return res.json();
}

/**
 * Fetch the latest funding rate, mark price, and open interest.
 * Uses metaAndAssetCtxs which returns all three in one call.
 */
export async function fetchFundingRate(symbol: string = 'BTCUSDT'): Promise<FundingRateData> {
  const coin = symbol.replace('USDT', '');
  const data = await hlPost({ type: 'metaAndAssetCtxs' }) as [
    { universe: { name: string }[] },
    { funding: string; markPx: string; openInterest: string }[],
  ];

  const [meta, assetCtxs] = data;
  const idx = meta.universe.findIndex((u) => u.name === coin);
  if (idx === -1) throw new Error(`Hyperliquid: ${coin} not found`);

  return {
    symbol,
    fundingRate: parseFloat(assetCtxs[idx].funding),
    fundingTime: Date.now(),
    openInterest: parseFloat(assetCtxs[idx].openInterest),
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

/**
 * Fetch BTC options skew from Deribit (put/call OI ratio).
 * Filters to options expiring within 7 days for short-term sentiment.
 * Positive skew = more put demand (bearish), negative = more call demand (bullish).
 */
export async function fetchOptionsSkew(): Promise<OptionsSkewData> {
  const res = await fetch(
    'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
  );
  if (!res.ok) throw new Error(`Deribit options failed: ${res.status}`);

  const json = await res.json();
  const instruments: { instrument_name: string; open_interest: number }[] = json.result ?? [];

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;

  let putOI = 0;
  let callOI = 0;

  for (const inst of instruments) {
    // Instrument name format: BTC-30MAR26-90000-P or BTC-30MAR26-90000-C
    const parts = inst.instrument_name.split('-');
    if (parts.length < 4) continue;

    const expiryStr = parts[1]; // e.g. "30MAR26"
    const optionType = parts[parts.length - 1]; // "P" or "C"
    const oi = inst.open_interest ?? 0;
    if (oi <= 0) continue;

    // Parse expiry date
    const expiry = parseDeribitExpiry(expiryStr);
    if (!expiry) continue;

    // Only include near-term options (within 7 days)
    if (expiry.getTime() - now > sevenDays || expiry.getTime() < now) continue;

    if (optionType === 'P') putOI += oi;
    else if (optionType === 'C') callOI += oi;
  }

  if (callOI === 0 && putOI === 0) {
    throw new Error('Deribit: no near-term BTC options found');
  }

  const skew = callOI > 0 ? (putOI / callOI) - 1.0 : 0;

  return { skew, putOI, callOI };
}

function parseDeribitExpiry(s: string): Date | null {
  // Format: "30MAR26" → 30 March 2026
  const match = s.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const monthMap: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const month = monthMap[match[2]];
  if (month === undefined) return null;
  const year = 2000 + parseInt(match[3], 10);

  return new Date(Date.UTC(year, month, day, 8, 0, 0)); // Deribit expires at 08:00 UTC
}
