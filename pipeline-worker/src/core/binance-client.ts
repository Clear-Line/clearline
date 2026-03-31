/**
 * Binance API Client — public REST endpoints for derivatives data.
 * No authentication required. Rate limit: 1200 req/min (we use ~4 per 10-min cycle).
 */

const SPOT_BASE = 'https://api.binance.com';
const FUTURES_BASE = 'https://fapi.binance.com';

export interface FundingRateData {
  symbol: string;
  fundingRate: number;
  fundingTime: number;
}

export interface CVDResult {
  cvd: number;      // net buy - sell volume in USD
  buyVol: number;   // total taker buy volume in USD
  sellVol: number;  // total taker sell volume in USD
}

/**
 * Fetch the latest funding rate for a perpetual futures contract.
 * GET /fapi/v1/fundingRate?symbol=BTCUSDT&limit=1
 */
export async function fetchFundingRate(symbol: string = 'BTCUSDT'): Promise<FundingRateData> {
  const res = await fetch(`${FUTURES_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
  if (!res.ok) throw new Error(`Binance funding rate failed: ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Binance funding rate: empty response');
  }

  return {
    symbol: data[0].symbol,
    fundingRate: parseFloat(data[0].fundingRate),
    fundingTime: data[0].fundingTime,
  };
}

/**
 * Fetch the current spot price for a trading pair.
 * GET /api/v3/ticker/price?symbol=BTCUSDT
 */
export async function fetchSpotPrice(symbol: string = 'BTCUSDT'): Promise<number> {
  const res = await fetch(`${SPOT_BASE}/api/v3/ticker/price?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Binance spot price failed: ${res.status}`);

  const data = await res.json();
  return parseFloat(data.price);
}

/**
 * Compute Cumulative Volume Delta from klines (1-minute candles).
 *
 * Each kline includes takerBuyBaseAssetVolume — the portion of volume
 * initiated by buyers. CVD = buyVolume - sellVolume in USD terms.
 *
 * Uses /api/v3/klines which returns up to 1000 candles per call.
 * For 4h (240 candles), this is a single API call.
 *
 * Kline array format: [openTime, open, high, low, close, volume,
 *   closeTime, quoteAssetVolume, numberOfTrades, takerBuyBaseAssetVolume,
 *   takerBuyQuoteAssetVolume, ignore]
 */
export async function fetchKlinesForCVD(
  symbol: string = 'BTCUSDT',
  intervalMinutes: number = 60,
): Promise<CVDResult> {
  const limit = Math.min(intervalMinutes, 1000);
  const res = await fetch(
    `${SPOT_BASE}/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`Binance klines failed: ${res.status}`);

  const klines: unknown[][] = await res.json();

  let buyVol = 0;
  let sellVol = 0;

  for (const k of klines) {
    const close = parseFloat(k[4] as string);
    const totalBaseVol = parseFloat(k[5] as string);
    const takerBuyBaseVol = parseFloat(k[9] as string);
    const takerSellBaseVol = totalBaseVol - takerBuyBaseVol;

    buyVol += takerBuyBaseVol * close;
    sellVol += takerSellBaseVol * close;
  }

  return {
    cvd: buyVol - sellVol,
    buyVol: Math.round(buyVol),
    sellVol: Math.round(sellVol),
  };
}
