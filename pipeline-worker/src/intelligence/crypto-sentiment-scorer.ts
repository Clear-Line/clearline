/**
 * Crypto Sentiment Scorer — compares derivatives market consensus
 * against Polymarket crypto up/down market odds.
 *
 * Phase 1: 2 signals (funding rate + spot CVD)
 * Phase 2: 5 signals (+ options skew, OI, liquidations)
 *
 * Produces a Sentiment Divergence Score (SDS) for each active BTC market.
 */

import { bq } from '../core/bigquery.js';

// ─── Signal weights (full 5-signal model) ───
const WEIGHTS = {
  funding: 0.25,
  cvd: 0.20,
  optionsSkew: 0.20,
  oi: 0.20,
  liquidation: 0.15,
};

// Phase 1: only funding + CVD are active
const ACTIVE_WEIGHTS = {
  funding: WEIGHTS.funding,
  cvd: WEIGHTS.cvd,
};
const TOTAL_ACTIVE_WEIGHT = Object.values(ACTIVE_WEIGHTS).reduce((a, b) => a + b, 0);

// CVD normalization thresholds (USD)
const CVD_THRESHOLD_1H = 50_000_000;   // $50M
const CVD_THRESHOLD_4H = 200_000_000;  // $200M

// Funding rate normalization (0.001 = 0.1% is extreme)
const FUNDING_SCALE = 0.001;

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

interface DerivativesRow {
  funding_rate: number;
  spot_price: number;
  cvd_1h: number;
  cvd_4h: number;
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
    .select('funding_rate, spot_price, cvd_1h, cvd_4h, fetched_at')
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

      // Market must end in the future and within reasonable range
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
    // No markets with suitable end times — try any active BTC market
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

    // Normalize signals to [-1, +1]
    const fundingSignal = clamp(deriv.funding_rate / FUNDING_SCALE, -1, 1);
    const cvdRaw = timeframe === '1h' ? deriv.cvd_1h : deriv.cvd_4h;
    const cvdSignal = clamp(cvdRaw / cvdThreshold, -1, 1);

    // Rescale weights for active signals only
    const wFunding = ACTIVE_WEIGHTS.funding / TOTAL_ACTIVE_WEIGHT;
    const wCvd = ACTIVE_WEIGHTS.cvd / TOTAL_ACTIVE_WEIGHT;

    // Composite signal: [-1, +1]
    const composite = fundingSignal * wFunding + cvdSignal * wCvd;

    // Map to probability: 0.2–0.8 range (conservative, avoids extreme predictions)
    const derivativesProb = 0.5 + composite * 0.3;

    // Sentiment Divergence Score
    const sds = (derivativesProb - polymarketProb) * 100;

    // Agreement: how many signals point same direction
    const signalsActive = 2;
    const fundingBullish = fundingSignal > 0;
    const cvdBullish = cvdSignal > 0;
    const signalsAgreeing = fundingBullish === cvdBullish ? 2 : 1;
    const agreementScore = signalsAgreeing / signalsActive;

    // Direction
    let sdsDirection = 'ALIGNED';
    if (sds > 5) sdsDirection = 'DERIVATIVES_BULLISH';
    else if (sds < -5) sdsDirection = 'DERIVATIVES_BEARISH';

    // Confidence
    let confidence = 'low';
    if (Math.abs(sds) > 15 && agreementScore >= 1.0) confidence = 'high';
    else if (Math.abs(sds) > 8 || agreementScore >= 1.0) confidence = 'medium';

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
      signal_options_skew: null,
      signal_oi: null,
      signal_liquidation: null,
      signals_active: signalsActive,
      signals_agreeing: signalsAgreeing,
      agreement_score: agreementScore,
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
    console.log(`[CryptoSentiment] BTC ${first.timeframe}: Polymarket=${(first.polymarket_prob * 100).toFixed(1)}% Derivatives=${(first.derivatives_prob * 100).toFixed(1)}% SDS=${first.sds > 0 ? '+' : ''}${first.sds.toFixed(1)} (${first.confidence})`);
  }

  return { signals: signalsWritten, errors };
}
