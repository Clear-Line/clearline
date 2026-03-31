/**
 * Derivatives Fetcher — pulls BTC funding rate, spot price, and CVD from Binance.
 * Writes to crypto_derivatives table every 10 minutes.
 */

import { bq } from '../core/bigquery.js';
import { fetchFundingRate, fetchSpotPrice, fetchKlinesForCVD } from '../core/binance-client.js';

export interface DerivativesResult {
  asset: string;
  fundingRate: number;
  cvd1h: number;
  cvd4h: number;
  spotPrice: number;
  errors: string[];
}

export async function fetchDerivatives(): Promise<DerivativesResult> {
  const errors: string[] = [];
  const asset = 'BTC';
  let fundingRate = 0;
  let fundingTime = 0;
  let spotPrice = 0;
  let cvd1h = 0;
  let cvd4h = 0;
  let buyVol = 0;
  let sellVol = 0;

  // Fetch all data in parallel
  const [fundingResult, priceResult, cvd1hResult, cvd4hResult] = await Promise.allSettled([
    fetchFundingRate('BTCUSDT'),
    fetchSpotPrice('BTCUSDT'),
    fetchKlinesForCVD('BTCUSDT', 60),
    fetchKlinesForCVD('BTCUSDT', 240),
  ]);

  if (fundingResult.status === 'fulfilled') {
    fundingRate = fundingResult.value.fundingRate;
    fundingTime = fundingResult.value.fundingTime;
  } else {
    errors.push(`Funding rate: ${fundingResult.reason}`);
  }

  if (priceResult.status === 'fulfilled') {
    spotPrice = priceResult.value;
  } else {
    errors.push(`Spot price: ${priceResult.reason}`);
  }

  if (cvd1hResult.status === 'fulfilled') {
    cvd1h = cvd1hResult.value.cvd;
    buyVol = cvd1hResult.value.buyVol;
    sellVol = cvd1hResult.value.sellVol;
  } else {
    errors.push(`CVD 1h: ${cvd1hResult.reason}`);
  }

  if (cvd4hResult.status === 'fulfilled') {
    cvd4h = cvd4hResult.value.cvd;
  } else {
    errors.push(`CVD 4h: ${cvd4hResult.reason}`);
  }

  // Write to BigQuery
  const now = new Date();
  const id = `${asset}_${now.getTime()}`;

  const row = {
    id,
    asset,
    funding_rate: fundingRate,
    funding_rate_timestamp: fundingTime ? new Date(fundingTime).toISOString() : now.toISOString(),
    spot_price: spotPrice,
    cvd_1h: Math.round(cvd1h),
    cvd_4h: Math.round(cvd4h),
    cvd_raw_buy_vol: buyVol,
    cvd_raw_sell_vol: sellVol,
    options_skew: null,
    oi_change_pct: null,
    liquidation_ratio: null,
    fetched_at: now.toISOString(),
  };

  const { error: insertErr } = await bq.from('crypto_derivatives').upsert([row], { onConflict: 'id' });
  if (insertErr) {
    errors.push(`BQ insert: ${insertErr.message}`);
  }

  return { asset, fundingRate, cvd1h: Math.round(cvd1h), cvd4h: Math.round(cvd4h), spotPrice, errors };
}
