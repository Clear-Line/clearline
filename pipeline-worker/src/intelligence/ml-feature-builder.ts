/**
 * ML Feature Builder — computes the 42 features required by the XGBoost
 * BTC prediction model from Hyperliquid 1-minute candle data.
 *
 * Feature list matches scripts/btc_model_config.json exactly.
 */

const HL_BASE = 'https://api.hyperliquid.xyz/info';

interface Candle {
  o: number; h: number; l: number; c: number; v: number;
}

// ─── Data fetching ───

async function fetchCandles(minutes: number): Promise<Candle[]> {
  const now = Date.now();
  const startTime = now - minutes * 60_000;
  const res = await fetch(HL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: { coin: 'BTC', interval: '1m', startTime, endTime: now },
    }),
  });
  if (!res.ok) throw new Error(`Hyperliquid candles: ${res.status}`);
  const raw = await res.json() as { o: string; h: string; l: string; c: string; v: string }[];
  return raw.map(k => ({
    o: parseFloat(k.o),
    h: parseFloat(k.h),
    l: parseFloat(k.l),
    c: parseFloat(k.c),
    v: parseFloat(k.v),
  }));
}

// ─── Helper math ───

function mean(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((s, v) => s + v, 0) / arr.length;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function emaLast(data: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

function emaSeries(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function linearSlope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (y[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function corrcoef(a: number[], b: number[]): number {
  const n = a.length;
  if (n < 2) return 0;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] - ma, bi = b[i] - mb;
    num += ai * bi;
    da += ai * ai;
    db += bi * bi;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? 0 : num / denom;
}

// ─── Feature computation ───

function computeFeatures(candles: Candle[], windowDurationMin: number): number[] {
  const n = candles.length;
  const opens = candles.map(c => c.o);
  const highs = candles.map(c => c.h);
  const lows = candles.map(c => c.l);
  const closes = candles.map(c => c.c);
  const volumes = candles.map(c => c.v);

  const last = closes[n - 1];

  // Quote volumes approximation (volume * close price)
  const quoteVols = candles.map(c => c.v * c.c);

  // CVD approximation: buyRatio = (close - low) / (high - low)
  const cvdPerCandle = candles.map(c => {
    const range = c.h - c.l;
    const buyRatio = range > 0 ? (c.c - c.l) / range : 0.5;
    const quoteVol = c.v * c.c;
    return quoteVol * (2 * buyRatio - 1); // buyVol - sellVol
  });

  // Taker buy approximation
  const takerBuyQuote = candles.map(c => {
    const range = c.h - c.l;
    const buyRatio = range > 0 ? (c.c - c.l) / range : 0.5;
    return c.v * c.c * buyRatio;
  });

  const window1h = Math.min(60, n);
  const returns1m: number[] = [];
  for (let i = 1; i < n; i++) {
    returns1m.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }

  const f: Record<string, number> = {};

  // ─── Group 1: Momentum ───
  f.ret_5m = n >= 6 ? (last - closes[n - 6]) / closes[n - 6] : 0;
  f.ret_15m = n >= 16 ? (last - closes[n - 16]) / closes[n - 16] : 0;
  f.ret_1h = n >= 61 ? (last - closes[n - 61]) / closes[n - 61] : 0;
  f.ret_4h = (last - closes[0]) / closes[0];

  if (n >= 11) {
    const prevRet5m = (closes[n - 6] - closes[n - 11]) / closes[n - 11];
    f.ret_5m_accel = f.ret_5m - prevRet5m;
  } else {
    f.ret_5m_accel = 0;
  }

  // VWAP 1h
  const vols1h = volumes.slice(-window1h);
  const closes1h = closes.slice(-window1h);
  const sumVol1h = vols1h.reduce((s, v) => s + v, 0);
  const vwap1h = sumVol1h > 0
    ? closes1h.reduce((s, c, i) => s + c * vols1h[i], 0) / sumVol1h
    : last;
  f.close_vs_vwap_1h = (last - vwap1h) / vwap1h;

  // High/low position 1h
  const h1High = Math.max(...highs.slice(-window1h));
  const h1Low = Math.min(...lows.slice(-window1h));
  const h1Range = h1High - h1Low;
  f.high_low_position_1h = h1Range > 0 ? (last - h1Low) / h1Range : 0.5;

  // ─── Group 2: Volatility ───
  const trueRange = (start: number, len: number) => {
    const result: number[] = [];
    for (let i = start; i < start + len; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      );
      result.push(tr);
    }
    return result;
  };

  const atr15Len = Math.min(15, n - 1);
  f.atr_15m = mean(trueRange(n - atr15Len, atr15Len)) / last;

  const atr1hLen = Math.min(60, n - 1);
  f.atr_1h = mean(trueRange(n - atr1hLen, atr1hLen)) / last;

  f.vol_expansion = f.atr_1h > 0 ? f.atr_15m / f.atr_1h : 1.0;
  f.return_std_1h = std(returns1m.slice(-window1h));

  // ─── Group 3: Volume ───
  const meanVol1h = mean(volumes.slice(-window1h));
  const meanVol5m = mean(volumes.slice(-5));
  const meanVol15m = mean(volumes.slice(n >= 15 ? -15 : 0));

  f.vol_ratio_5m_1h = meanVol5m / Math.max(meanVol1h, 1e-10);
  f.vol_ratio_15m_1h = meanVol15m / Math.max(meanVol1h, 1e-10);

  f.vol_trend_15m = n >= 15
    ? linearSlope(volumes.slice(-15)) / Math.max(meanVol1h, 1e-10)
    : 0;

  // Trade count approximation (use volume as proxy since Hyperliquid doesn't provide trade count)
  f.trade_count_ratio = meanVol5m / Math.max(meanVol1h, 1e-10);

  const volThreshold = 2 * meanVol1h;
  f.large_candle_count = n >= 15
    ? volumes.slice(-15).filter(v => v > volThreshold).length
    : 0;

  // ─── Group 4: CVD ───
  f.cvd_5m = cvdPerCandle.slice(-5).reduce((s, v) => s + v, 0);
  f.cvd_15m = cvdPerCandle.slice(n >= 15 ? -15 : 0).reduce((s, v) => s + v, 0);
  f.cvd_1h = cvdPerCandle.slice(-window1h).reduce((s, v) => s + v, 0);
  f.cvd_4h = cvdPerCandle.reduce((s, v) => s + v, 0);

  const meanQuoteVol1h = mean(quoteVols.slice(-window1h));
  f.cvd_5m_norm = f.cvd_5m / Math.max(meanQuoteVol1h, 1e-10);

  if (n >= 15) {
    const cumCvd: number[] = [];
    let sum = 0;
    for (const v of cvdPerCandle.slice(-15)) {
      sum += v;
      cumCvd.push(sum);
    }
    f.cvd_slope_15m = linearSlope(cumCvd);
  } else {
    f.cvd_slope_15m = 0;
  }

  // ─── Group 5: Technical indicators ───

  // RSI-14
  if (returns1m.length >= 14) {
    const r14 = returns1m.slice(-14);
    const avgGain = mean(r14.filter(r => r > 0));
    const avgLoss = mean(r14.filter(r => r < 0).map(r => -r));
    const rs = avgGain / Math.max(avgLoss, 1e-10);
    f.rsi_14 = 100 - 100 / (1 + rs);
  } else {
    f.rsi_14 = 50;
  }

  // Bollinger Band %B (20-period)
  if (n >= 20) {
    const sma20 = mean(closes.slice(-20));
    const std20 = std(closes.slice(-20));
    const upper = sma20 + 2 * std20;
    const lower = sma20 - 2 * std20;
    const bw = upper - lower;
    f.bb_pctb_20 = bw > 0 ? (last - lower) / bw : 0.5;
  } else {
    f.bb_pctb_20 = 0.5;
  }

  // MACD histogram (12, 26, 9)
  if (n >= 26) {
    const ema12 = emaSeries(closes, 12);
    const ema26 = emaSeries(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    if (macdLine.length >= 9) {
      const signalLine = emaSeries(macdLine.slice(-18), 9);
      f.macd_hist = (macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1]) / last;
    } else {
      f.macd_hist = macdLine[macdLine.length - 1] / last;
    }
  } else {
    f.macd_hist = 0;
  }

  // EMA cross (9 vs 21)
  if (n >= 21) {
    const ema9 = emaLast(closes, 9);
    const ema21 = emaLast(closes, 21);
    f.ema_cross = (ema9 - ema21) / last;
  } else {
    f.ema_cross = 0;
  }

  // Price vs EMA50
  if (n >= 50) {
    const ema50 = emaLast(closes, 50);
    f.price_vs_ema50 = (last - ema50) / last;
  } else {
    f.price_vs_ema50 = 0;
  }

  // ─── Group 6: Time features ───
  const now = new Date();
  f.hour_utc = now.getUTCHours();
  f.minute_utc = now.getUTCMinutes();
  f.day_of_week = now.getUTCDay();
  f.is_us_hours = (now.getUTCHours() >= 13 && now.getUTCHours() < 20) ? 1 : 0;

  // ─── Group 7: Streak features ───
  let consecUp = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (closes[i] > opens[i]) consecUp++;
    else break;
  }
  f.consecutive_up = consecUp;

  let consecDown = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (closes[i] < opens[i]) consecDown++;
    else break;
  }
  f.consecutive_down = consecDown;

  const recent = Math.min(15, n);
  const upCandles = closes.slice(-recent).filter((c, i) => c > opens.slice(-recent)[i]).length;
  f.up_ratio_15m = upCandles / recent;

  const recent5 = Math.min(5, n);
  const bodies = [];
  for (let i = n - recent5; i < n; i++) {
    const range = highs[i] - lows[i];
    const body = Math.abs(closes[i] - opens[i]);
    bodies.push(range > 0 ? body / range : 0);
  }
  f.body_ratio_5m = mean(bodies);

  // ─── Group 8: Context ───
  f.window_duration = windowDurationMin;

  // ─── Group 9: Additional signals ───
  const lookback = Math.min(windowDurationMin, n - 1);
  f.ret_window_lookback = lookback > 0
    ? (last - closes[n - 1 - lookback]) / closes[n - 1 - lookback]
    : 0;

  f.momentum_sharpe = f.return_std_1h > 0 ? f.ret_5m / f.return_std_1h : 0;

  const totalQuote5 = quoteVols.slice(-5).reduce((s, v) => s + v, 0);
  const takerBuy5 = takerBuyQuote.slice(-5).reduce((s, v) => s + v, 0);
  f.taker_buy_ratio_5m = takerBuy5 / Math.max(totalQuote5, 1e-10);

  const recent15 = Math.min(15, n);
  const totalQuote15 = quoteVols.slice(-recent15).reduce((s, v) => s + v, 0);
  const takerBuy15 = takerBuyQuote.slice(-recent15).reduce((s, v) => s + v, 0);
  f.taker_buy_ratio_15m = takerBuy15 / Math.max(totalQuote15, 1e-10);

  if (n >= 10) {
    const mid = Math.floor(n / 2);
    const retFirst = (closes[mid] - closes[0]) / closes[0];
    const retSecond = (last - closes[mid]) / closes[mid];
    f.price_acceleration = retSecond - retFirst;
  } else {
    f.price_acceleration = 0;
  }

  if (n >= 15) {
    const recentRet = [];
    for (let i = n - 15; i < n; i++) {
      recentRet.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const recentVol = volumes.slice(-15);
    f.vol_price_corr_15m = corrcoef(recentRet, recentVol);
  } else {
    f.vol_price_corr_15m = 0;
  }

  // ─── Assemble in model feature order ───
  const FEATURE_ORDER = [
    'ret_5m', 'ret_15m', 'ret_1h', 'ret_4h', 'ret_5m_accel',
    'close_vs_vwap_1h', 'high_low_position_1h',
    'atr_15m', 'atr_1h', 'vol_expansion', 'return_std_1h',
    'vol_ratio_5m_1h', 'vol_ratio_15m_1h', 'vol_trend_15m',
    'trade_count_ratio', 'large_candle_count',
    'cvd_5m', 'cvd_15m', 'cvd_1h', 'cvd_4h', 'cvd_5m_norm', 'cvd_slope_15m',
    'rsi_14', 'bb_pctb_20', 'macd_hist', 'ema_cross', 'price_vs_ema50',
    'hour_utc', 'minute_utc', 'day_of_week', 'is_us_hours',
    'consecutive_up', 'consecutive_down', 'up_ratio_15m', 'body_ratio_5m',
    'window_duration',
    'ret_window_lookback', 'momentum_sharpe',
    'taker_buy_ratio_5m', 'taker_buy_ratio_15m',
    'price_acceleration', 'vol_price_corr_15m',
  ];

  return FEATURE_ORDER.map(name => f[name] ?? 0);
}

// ─── Public API ───

export interface MLFeatureResult {
  features: number[];
  featureMap: Record<string, number>;
  candleCount: number;
}

/**
 * Build the 42-feature vector for the XGBoost model.
 * Fetches 240 1-minute candles (4h) from Hyperliquid.
 *
 * @param windowDurationMin - The prediction window duration in minutes (e.g., 60 for 1H)
 */
export async function buildFeatures(windowDurationMin: number = 60): Promise<MLFeatureResult> {
  const candles = await fetchCandles(240);
  if (candles.length < 60) {
    throw new Error(`Insufficient candles for ML features: ${candles.length} (need >= 60)`);
  }

  const features = computeFeatures(candles, windowDurationMin);

  const FEATURE_NAMES = [
    'ret_5m', 'ret_15m', 'ret_1h', 'ret_4h', 'ret_5m_accel',
    'close_vs_vwap_1h', 'high_low_position_1h',
    'atr_15m', 'atr_1h', 'vol_expansion', 'return_std_1h',
    'vol_ratio_5m_1h', 'vol_ratio_15m_1h', 'vol_trend_15m',
    'trade_count_ratio', 'large_candle_count',
    'cvd_5m', 'cvd_15m', 'cvd_1h', 'cvd_4h', 'cvd_5m_norm', 'cvd_slope_15m',
    'rsi_14', 'bb_pctb_20', 'macd_hist', 'ema_cross', 'price_vs_ema50',
    'hour_utc', 'minute_utc', 'day_of_week', 'is_us_hours',
    'consecutive_up', 'consecutive_down', 'up_ratio_15m', 'body_ratio_5m',
    'window_duration',
    'ret_window_lookback', 'momentum_sharpe',
    'taker_buy_ratio_5m', 'taker_buy_ratio_15m',
    'price_acceleration', 'vol_price_corr_15m',
  ];

  const featureMap: Record<string, number> = {};
  FEATURE_NAMES.forEach((name, i) => { featureMap[name] = features[i]; });

  return { features, featureMap, candleCount: candles.length };
}
