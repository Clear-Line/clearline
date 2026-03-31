/**
 * BTC Resolution Checker — checks if completed BTC up/down market cycles
 * have resolved and records whether Clearline's prediction was correct.
 */

import { bq } from '../core/bigquery.js';
import { fetchMarketByConditionId } from '../core/polymarket-client.js';

function parseJsonField(s: string | unknown): string[] {
  if (typeof s !== 'string') return [];
  try { return JSON.parse(s); } catch { return []; }
}

export async function checkBtcResolutions(): Promise<{
  resolved: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let resolved = 0;

  const cutoff = new Date().toISOString();
  const { data: pending, error: qErr } = await bq
    .from('btc_market_cycles')
    .select('id, condition_id, clearline_predicted_up, polymarket_predicted_up')
    .eq('is_resolved', false)
    .lt('window_end', cutoff)
    .limit(50);

  if (qErr || !pending || pending.length === 0) {
    return { resolved: 0, errors: qErr ? [qErr.message] : [] };
  }

  for (const cycle of pending) {
    try {
      const market = await fetchMarketByConditionId(cycle.condition_id);
      if (!market) continue;

      const outcomes = parseJsonField(market.outcomes);
      const prices = parseJsonField(market.outcomePrices);

      let winner: string | null = null;
      for (let i = 0; i < prices.length; i++) {
        if (parseFloat(prices[i]) >= 0.95) {
          winner = outcomes[i] ?? null;
          break;
        }
      }

      if (!winner) continue; // Not yet resolved

      const resolvedUp = winner === 'Yes';
      const clearlineCorrect = cycle.clearline_predicted_up === resolvedUp;
      const polymarketCorrect = cycle.polymarket_predicted_up === resolvedUp;

      const { error: uErr } = await bq
        .from('btc_market_cycles')
        .update({
          is_resolved: true,
          resolution_outcome: winner,
          resolved_at: new Date().toISOString(),
          clearline_correct: clearlineCorrect,
          polymarket_correct: polymarketCorrect,
          updated_at: new Date().toISOString(),
        })
        .eq('id', cycle.id);

      if (uErr) {
        errors.push(`Resolve ${cycle.id}: ${uErr.message}`);
      } else {
        resolved++;
      }

      // Rate limit Gamma API calls
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      errors.push(`Check ${cycle.condition_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { resolved, errors };
}
