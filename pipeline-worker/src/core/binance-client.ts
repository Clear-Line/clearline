/**
 * Exchange API Client — public REST endpoints for derivatives data via Bybit.
 * No authentication required. Rate limit: 120 req/min (we use ~4 per 10-min cycle).
 *
 * Bybit's public market data endpoints work from US IPs
 * (only trading is restricted for US users).
 */

const BASE = 'https://api.bybit.com';

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

/**
 * Fetch the latest funding rate for a perpetual futures contract.
 * GET /v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1
 */
export async function fetchFundingRate(symbol: string = 'BTCUSDT'): Promise<FundingRateData> {
  const res = await fetch(
    `${BASE}/v5/market/funding/history?category=linear&symbol=${symbol}&limit=1`,
  );
  if (!res.ok) throw new Error(`Bybit funding rate failed: ${res.status}`);

  const json = await res.json();
  if (json.retCode !== 0) throw new Error(`Bybit funding rate error: ${json.retMsg}`);

  const list = json.result?.list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('Bybit funding rate: empty response');
  }

  return {
    symbol: list[0].symbol,
    fundingRate: parseFloat(list[0].fundingRate),
    fundingTime: parseInt(list[0].fundingRateTimestamp, 10),
  };
}

/**
 * Fetch the current spot price for a trading pair.
 * GET /v5/market/tickers?category=spot&symbol=BTCUSDT
 */
export async function fetchSpotPrice(symbol: string = 'BTCUSDT'): Promise<number> {
  const res = await fetch(`${BASE}/v5/market/tickers?category=spot&symbol=${symbol}`);
  if (!res.ok) throw new Error(`Bybit spot price failed: ${res.status}`);

  const json = await res.json();
  if (json.retCode !== 0) throw new Error(`Bybit spot price error: ${json.retMsg}`);

  const list = json.result?.list;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error('Bybit spot price: empty response');
  }

  return parseFloat(list[0].lastPrice);
}

/**
 * Compute Cumulative Volume Delta from klines (1-minute candles).
 *
 * Bybit klines don't include taker buy/sell volume split, so we use
 * the standard OHLCV approximation:
 *   buyRatio = (close - low) / (high - low)
 *   buyVol  += volume * buyRatio * close
 *   sellVol += volume * (1 - buyRatio) * close
 *
 * GET /v5/market/kline?category=spot&symbol=BTCUSDT&interval=1&limit={minutes}
 *
 * Bybit kline list format: [timestamp, open, high, low, close, volume, turnover]
 * Note: Bybit returns newest-first, but order doesn't matter for CVD sum.
 */
export async function fetchKlinesForCVD(
  symbol: string = 'BTCUSDT',
  intervalMinutes: number = 60,
): Promise<CVDResult> {
  const limit = Math.min(intervalMinutes, 1000);
  const res = await fetch(
    `${BASE}/v5/market/kline?category=spot&symbol=${symbol}&interval=1&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`Bybit klines failed: ${res.status}`);

  const json = await res.json();
  if (json.retCode !== 0) throw new Error(`Bybit klines error: ${json.retMsg}`);

  const klines: string[][] = json.result?.list ?? [];

  let buyVol = 0;
  let sellVol = 0;

  for (const k of klines) {
    const open = parseFloat(k[1]);
    const high = parseFloat(k[2]);
    const low = parseFloat(k[3]);
    const close = parseFloat(k[4]);
    const volume = parseFloat(k[5]);

    const range = high - low;
    // Avoid division by zero on flat candles — split volume 50/50
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
