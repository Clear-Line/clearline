/**
 * Crypto Sentiment Scorer — compares derivatives market consensus
 * against Polymarket crypto up/down market odds.
 *
 * Phase 2: 4 signals (funding rate, CVD, options skew, open interest)
 *
 * Fetches LIVE prices from Polymarket Gamma API (not stale snapshots).
 * Produces a Sentiment Divergence Score (SDS) for each active BTC market.
 */

import { bq } from '../core/bigquery.js';
import { fetchBtcUpDownEvents, type GammaMarket } from '../core/polymarket-client.js';

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

function parseJsonField(s: string | unknown): unknown[] {
  if (typeof s !== 'string') return [];
  try { return JSON.parse(s); } catch { return []; }
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

interface BtcMarket {
  conditionId: string;
  question: string;
  startDate: string;
  endDate: string;
  upPrice: number;
  timeframe: string;
  cvdThreshold: number;
}

/**
 * Find active BTC up/down markets from the Gamma API with live prices.
 */
async function findBtcMarkets(): Promise<BtcMarket[]> {
  // Fetch BTC up/down events directly (these are events, not standalone markets)
  const allMarkets = await fetchBtcUpDownEvents(10);

  // All returned markets are already BTC up/down, just filter for active
  const btcMarkets = allMarkets.filter((m: GammaMarket) => m.active && !m.closed);

  if (btcMarkets.length === 0) return [];

  const now = Date.now();
  const results: BtcMarket[] = [];

  for (const m of btcMarkets) {
    const outcomes = parseJsonField(m.outcomes) as string[];
    const prices = parseJsonField(m.outcomePrices) as string[];
    // Find "Up" outcome price (could be index 0 or 1)
    const upIdx = outcomes.findIndex(o => String(o).toLowerCase() === 'up');
    const upPrice = upIdx >= 0 && prices[upIdx] ? parseFloat(prices[upIdx]) : NaN;
    if (isNaN(upPrice) || upPrice <= 0 || upPrice >= 1) continue;

    // Skip markets that haven't started yet
    const startMs = new Date(m.startDate).getTime();
    if (startMs > now) continue;

    // Skip untouched markets (exactly 50/50 means no real trading yet)
    if (upPrice === 0.5) continue;

    const endMs = new Date(m.endDate).getTime();
    const hoursToEnd = (endMs - now) / (3_600_000);

    // Skip expired or very far-out markets
    if (hoursToEnd <= 0 || hoursToEnd > 48) continue;

    // Assign timeframe label based on actual end date
    let timeframe: string;
    let cvdThreshold: number;
    if (hoursToEnd <= 2) {
      timeframe = '1h';
      cvdThreshold = CVD_THRESHOLD_1H;
    } else if (hoursToEnd <= 6) {
      timeframe = '4h';
      cvdThreshold = CVD_THRESHOLD_4H;
    } else if (hoursToEnd <= 12) {
      timeframe = '12h';
      cvdThreshold = CVD_THRESHOLD_4H;
    } else {
      timeframe = '24h';
      cvdThreshold = CVD_THRESHOLD_4H;
    }

    results.push({
      conditionId: m.conditionId,
      question: m.question,
      startDate: m.startDate,
      endDate: m.endDate,
      upPrice,
      timeframe,
      cvdThreshold,
    });
  }

  // Sort by end date (nearest first), keep at most 3
  results.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  return results.slice(0, 3);
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

  // Step 2: Find active BTC markets with LIVE prices from Polymarket
  let btcMarkets: BtcMarket[];
  try {
    btcMarkets = await findBtcMarkets();
  } catch (err) {
    return { signals: 0, errors: [`Gamma API: ${err instanceof Error ? err.message : String(err)}`] };
  }

  if (btcMarkets.length === 0) {
    return { signals: 0, errors: ['No active BTC Polymarket markets found'] };
  }

  // Step 3: Compute signals and write rows
  const upsertRows = [];
  const computedAt = new Date().toISOString();

  for (const market of btcMarkets) {
    const polymarketProb = market.upPrice;

    // Normalize each signal to [-1, +1], track which are available
    const signals: { key: string; value: number }[] = [];

    // Funding rate: positive = longs paying shorts = bullish sentiment
    const fundingSignal = clamp(deriv.funding_rate / FUNDING_SCALE, -1, 1);
    signals.push({ key: 'funding', value: fundingSignal });

    // CVD: positive = net buying pressure = bullish
    const cvdRaw = market.timeframe === '1h' ? deriv.cvd_1h : deriv.cvd_4h;
    const cvdSignal = clamp(cvdRaw / market.cvdThreshold, -1, 1);
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

    const id = `BTC_${market.timeframe}_${Date.now()}`;

    upsertRows.push({
      id,
      asset: 'BTC',
      timeframe: market.timeframe,
      polymarket_prob: Math.round(polymarketProb * 10000) / 10000,
      polymarket_market_id: market.conditionId,
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
      window_end: market.endDate,
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

  // Record new market cycles in btc_market_cycles (one row per cycle, first-seen only)
  for (let i = 0; i < upsertRows.length; i++) {
    const row = upsertRows[i];
    const market = btcMarkets[i];
    try {
      const { data: existing } = await bq
        .from('btc_market_cycles')
        .select('id')
        .eq('condition_id', row.polymarket_market_id)
        .limit(1);

      if (!existing || existing.length === 0) {
        const clearlinePredictedUp = row.derivatives_prob > 0.5;
        const polymarketPredictedUp = row.polymarket_prob > 0.5;

        await bq.from('btc_market_cycles').insert([{
          id: `BTC_${row.timeframe}_${row.window_end}`,
          condition_id: row.polymarket_market_id,
          timeframe: row.timeframe,
          question: row.polymarket_question,
          window_start: market.startDate,
          window_end: row.window_end,
          initial_polymarket_prob: row.polymarket_prob,
          initial_derivatives_prob: row.derivatives_prob,
          initial_sds: row.sds,
          initial_sds_direction: row.sds_direction,
          initial_confidence: row.confidence,
          initial_spot_price: row.spot_price,
          signal_captured_at: row.computed_at,
          is_resolved: false,
          clearline_predicted_up: clearlinePredictedUp,
          polymarket_predicted_up: polymarketPredictedUp,
          created_at: row.computed_at,
          updated_at: row.computed_at,
        }]);
        console.log(`[CryptoSentiment] New cycle recorded: ${row.timeframe} ${row.window_end}`);
      }
    } catch (err) {
      errors.push(`Cycle record: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { signals: signalsWritten, errors };
}
