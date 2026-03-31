/**
 * Crypto Sentiment Scorer — compares derivatives market consensus
 * against Polymarket crypto up/down market odds.
 *
 * Phase 2: 4 signals (funding rate, CVD, options skew, open interest)
 * Phase 3: 5 signals (+ liquidations via Coinalyze)
 *
 * Produces a Sentiment Divergence Score (SDS) for each active BTC market.
 */

import { bq } from '../core/bigquery.js';

// ─── Signal weights (full 5-signal model) ───
const WEIGHTS: Record<string, number> = {
  funding: 0.25,
  cvd: 0.20,
  optionsSkew: 0.20,
  oi: 0.20,
  liquidation: 0.15,
};

// CVD normalization thresholds (USD)
const CVD_THRESHOLD_1H = 50_000_000;   // $50M
const CVD_THRESHOLD_4H = 200_000_000;  // $200M

// Funding rate normalization (0.001 = 0.1% is extreme)
const FUNDING_SCALE = 0.001;

// Options skew normalization (put/call ratio - 1.0; 0.5 means 50% more puts than calls)
const SKEW_SCALE = 0.5;

// OI change normalization (10% change in 10 min is extreme)
const OI_SCALE = 10;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

interface DerivativesRow {
  funding_rate: number;
  spot_price: number;
  cvd_1h: number;
  cvd_4h: number;
  options_skew: number | null;
  oi_change_pct: number | null;
  fetched_at: string;
}

interface MarketRow {
  condition_id: string;
  question: string;
  end_date: string;
}

interface SnapshotRow {
  market_id: string;
  yes_price: number;
}

export async function scoreCryptoSentiment(): Promise<{ signals: number; errors: string[] }> {
  const errors: string[] = [];
  let signalsWritten = 0;

  // Step 1: Get latest derivatives data
  const { data: derivRows, error: dErr } = await bq
    .from('crypto_derivatives')
    .select('funding_rate, spot_price, cvd_1h, cvd_4h, options_skew, oi_change_pct, fetched_at')
    .eq('asset', 'BTC')
    .order('fetched_at', { ascending: false })
    .limit(1);

  if (dErr || !derivRows || derivRows.length === 0) {
    return { signals: 0, errors: [dErr?.message || 'No derivatives data found'] };
  }

  const deriv: DerivativesRow = derivRows[0];

  // Step 2: Find active BTC Polymarket markets
  const { data: btcMarkets, error: mErr } = await bq.rawQuery<MarketRow>(`
    SELECT condition_id, question, end_date
    FROM \`${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}.markets\`
    WHERE category = 'crypto'
      AND is_active = true
      AND is_resolved = false
      AND LOWER(question) LIKE '%bitcoin%'
      AND (LOWER(question) LIKE '%above%' OR LOWER(question) LIKE '%higher%' OR LOWER(question) LIKE '%up%')
    ORDER BY end_date ASC
  `);

  if (mErr) {
    errors.push(`Market query: ${mErr.message}`);
  }

  if (!btcMarkets || btcMarkets.length === 0) {
    return { signals: 0, errors: [...errors, 'No active BTC Polymarket markets found'] };
  }

  // Match markets to timeframes based on end_date proximity
  const now = Date.now();
  const timeframeTargets = [
    { label: '1h', targetMs: 1 * 60 * 60 * 1000, maxMs: 2 * 60 * 60 * 1000, cvdThreshold: CVD_THRESHOLD_1H },
    { label: '4h', targetMs: 4 * 60 * 60 * 1000, maxMs: 6 * 60 * 60 * 1000, cvdThreshold: CVD_THRESHOLD_4H },
  ];

  const matchedMarkets: { market: MarketRow; timeframe: string; cvdThreshold: number }[] = [];

  for (const tf of timeframeTargets) {
    let bestMatch: MarketRow | null = null;
    let bestDelta = Infinity;

    for (const m of btcMarkets) {
      const endMs = new Date(m.end_date).getTime();
      const timeToEnd = endMs - now;

      if (timeToEnd > 0 && timeToEnd <= tf.maxMs) {
        const delta = Math.abs(timeToEnd - tf.targetMs);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestMatch = m;
        }
      }
    }

    if (bestMatch) {
      matchedMarkets.push({ market: bestMatch, timeframe: tf.label, cvdThreshold: tf.cvdThreshold });
    }
  }

  if (matchedMarkets.length === 0) {
    const fallback = btcMarkets[0];
    const endMs = new Date(fallback.end_date).getTime();
    const hoursToEnd = (endMs - now) / (60 * 60 * 1000);
    const tf = hoursToEnd <= 2 ? '1h' : '4h';
    const threshold = tf === '1h' ? CVD_THRESHOLD_1H : CVD_THRESHOLD_4H;
    matchedMarkets.push({ market: fallback, timeframe: tf, cvdThreshold: threshold });
  }

  // Step 3: Get Polymarket odds from latest snapshots
  const marketIds = matchedMarkets.map(m => m.market.condition_id);

  const { data: snapshots, error: sErr } = await bq.rawQuery<SnapshotRow>(`
    SELECT market_id, yes_price
    FROM (
      SELECT market_id, yes_price, ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY timestamp DESC) AS rn
      FROM \`${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}.market_snapshots\`
      WHERE market_id IN UNNEST(@ids)
        AND timestamp >= @cutoff
    )
    WHERE rn = 1
  `, {
    ids: marketIds,
    cutoff: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
  });

  if (sErr) {
    errors.push(`Snapshot query: ${sErr.message}`);
  }

  const priceByMarket = new Map<string, number>();
  for (const s of snapshots ?? []) {
    priceByMarket.set(s.market_id, Number(s.yes_price));
  }

  // Step 4: Compute signals and write rows
  const upsertRows = [];
  const computedAt = new Date().toISOString();

  for (const { market, timeframe, cvdThreshold } of matchedMarkets) {
    const polymarketProb = priceByMarket.get(market.condition_id);
    if (polymarketProb === undefined) {
      errors.push(`No snapshot for market ${market.condition_id}`);
      continue;
    }

    // Normalize each signal to [-1, +1], track which are available
    const signals: { key: string; value: number }[] = [];

    // Funding rate: positive = longs paying shorts = bullish sentiment
    const fundingSignal = clamp(deriv.funding_rate / FUNDING_SCALE, -1, 1);
    signals.push({ key: 'funding', value: fundingSignal });

    // CVD: positive = net buying pressure = bullish
    const cvdRaw = timeframe === '1h' ? deriv.cvd_1h : deriv.cvd_4h;
    const cvdSignal = clamp(cvdRaw / cvdThreshold, -1, 1);
    signals.push({ key: 'cvd', value: cvdSignal });

    // Options skew: positive skew = more puts = bearish, so negate
    let skewSignal: number | null = null;
    if (deriv.options_skew != null) {
      skewSignal = clamp(-deriv.options_skew / SKEW_SCALE, -1, 1);
      signals.push({ key: 'optionsSkew', value: skewSignal });
    }

    // OI change: rising OI = new money entering = mildly bullish
    let oiSignal: number | null = null;
    if (deriv.oi_change_pct != null) {
      oiSignal = clamp(deriv.oi_change_pct / OI_SCALE, -1, 1);
      signals.push({ key: 'oi', value: oiSignal });
    }

    // Dynamic weight rescaling based on available signals
    const activeWeight = signals.reduce((sum, s) => sum + (WEIGHTS[s.key] ?? 0), 0);
    if (activeWeight === 0) continue;

    const composite = signals.reduce(
      (sum, s) => sum + s.value * ((WEIGHTS[s.key] ?? 0) / activeWeight),
      0,
    );

    // Map to probability: 0.2–0.8 range
    const derivativesProb = 0.5 + composite * 0.3;

    // Sentiment Divergence Score
    const sds = (derivativesProb - polymarketProb) * 100;

    // Agreement: how many signals point same direction
    const signalsActive = signals.length;
    const bullishCount = signals.filter(s => s.value > 0).length;
    const bearishCount = signalsActive - bullishCount;
    const signalsAgreeing = Math.max(bullishCount, bearishCount);
    const agreementScore = signalsAgreeing / signalsActive;

    // Direction
    let sdsDirection = 'ALIGNED';
    if (sds > 5) sdsDirection = 'DERIVATIVES_BULLISH';
    else if (sds < -5) sdsDirection = 'DERIVATIVES_BEARISH';

    // Confidence
    let confidence = 'low';
    if (Math.abs(sds) > 15 && agreementScore >= 0.75) confidence = 'high';
    else if (Math.abs(sds) > 8 || agreementScore >= 0.75) confidence = 'medium';

    const id = `BTC_${timeframe}_${Date.now()}`;

    upsertRows.push({
      id,
      asset: 'BTC',
      timeframe,
      polymarket_prob: Math.round(polymarketProb * 10000) / 10000,
      polymarket_market_id: market.condition_id,
      polymarket_question: market.question,
      derivatives_prob: Math.round(derivativesProb * 10000) / 10000,
      sds: Math.round(sds * 100) / 100,
      sds_direction: sdsDirection,
      signal_funding_rate: Math.round(fundingSignal * 10000) / 10000,
      signal_cvd: Math.round(cvdSignal * 10000) / 10000,
      signal_options_skew: skewSignal != null ? Math.round(skewSignal * 10000) / 10000 : null,
      signal_oi: oiSignal != null ? Math.round(oiSignal * 10000) / 10000 : null,
      signal_liquidation: null,
      signals_active: signalsActive,
      signals_agreeing: signalsAgreeing,
      agreement_score: Math.round(agreementScore * 10000) / 10000,
      confidence,
      spot_price: deriv.spot_price,
      window_end: market.end_date,
      computed_at: computedAt,
    });
  }

  if (upsertRows.length > 0) {
    const { error: insertErr } = await bq
      .from('crypto_signals')
      .upsert(upsertRows, { onConflict: 'id' });

    if (insertErr) {
      errors.push(`BQ insert signals: ${insertErr.message}`);
    } else {
      signalsWritten = upsertRows.length;
    }
  }

  if (signalsWritten > 0) {
    const first = upsertRows[0];
    console.log(`[CryptoSentiment] BTC ${first.timeframe}: Polymarket=${(first.polymarket_prob * 100).toFixed(1)}% Derivatives=${(first.derivatives_prob * 100).toFixed(1)}% SDS=${first.sds > 0 ? '+' : ''}${first.sds.toFixed(1)} (${first.confidence}) [${first.signals_active} signals]`);
  }

  return { signals: signalsWritten, errors };
}
