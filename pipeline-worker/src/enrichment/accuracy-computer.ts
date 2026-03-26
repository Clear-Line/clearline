/**
 * Accuracy Computer — detects resolved markets and computes wallet accuracy scores.
 *
 * 1. Checks Gamma API for markets that have closed/resolved.
 * 2. Updates markets table with resolution_outcome, is_resolved = true.
 * 3. Computes accuracy_score for each wallet across all resolved markets.
 *
 * Run every 30 minutes.
 */

import { supabaseAdmin } from '../core/supabase.js';
import { bq } from '../core/bigquery.js';
import { GammaMarket } from '../core/polymarket-client.js';

const GAMMA_API = 'https://gamma-api.polymarket.com';

/**
 * Fetch closed/resolved markets from Gamma to discover resolutions.
 */
async function fetchClosedMarkets(limit = 100, offset = 0): Promise<GammaMarket[]> {
  const params = new URLSearchParams({
    closed: 'true',
    limit: String(limit),
    offset: String(offset),
    order: 'endDate',
    ascending: 'false',
  });

  const res = await fetch(`${GAMMA_API}/markets?${params}`);
  if (!res.ok) throw new Error(`Gamma /markets (closed) failed: ${res.status}`);
  return res.json();
}

/**
 * Determine winning outcome from outcomePrices.
 * When a market resolves, the winning outcome price goes to ~1.0 and losing to ~0.0.
 */
function determineResolution(
  outcomes: string[],
  outcomePrices: string[],
): string | null {
  if (!outcomes || !outcomePrices || outcomes.length !== outcomePrices.length) return null;

  for (let i = 0; i < outcomePrices.length; i++) {
    const price = parseFloat(outcomePrices[i]);
    if (price >= 0.95) return outcomes[i]; // This outcome won
  }
  return null; // Not clearly resolved
}

function parseJsonField(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function computeAccuracy(): Promise<{
  resolved: number;
  walletsUpdated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let resolved = 0;
  let walletsUpdated = 0;

  // ─── Step 1: Find markets in our DB that are not yet marked resolved ───
  // Paginate to avoid pulling all 29K at once
  const unresolvedIds = new Set<string>();
  let unresolvedOffset = 0;
  const UNRESOLVED_PAGE = 1000;

  while (true) {
    const { data: page, error: dbErr } = await supabaseAdmin
      .from('markets')
      .select('condition_id')
      .eq('is_resolved', false)
      .range(unresolvedOffset, unresolvedOffset + UNRESOLVED_PAGE - 1);

    if (dbErr) {
      return { resolved: 0, walletsUpdated: 0, errors: [`DB query failed: ${dbErr.message}`] };
    }
    if (!page || page.length === 0) break;
    for (const m of page) unresolvedIds.add(m.condition_id);
    if (page.length < UNRESOLVED_PAGE) break;
    unresolvedOffset += UNRESOLVED_PAGE;
  }

  // ─── Step 2: Paginate through closed markets from Gamma ───

  const newlyResolved: { conditionId: string; outcome: string }[] = [];
  let offset = 0;
  const limit = 100;
  let keepGoing = true;

  while (keepGoing) {
    try {
      const batch = await fetchClosedMarkets(limit, offset);
      for (const m of batch) {
        if (!m.conditionId || !unresolvedIds.has(m.conditionId)) continue;

        const outcomes = parseJsonField(m.outcomes);
        const prices = parseJsonField(m.outcomePrices);
        const winner = determineResolution(outcomes, prices);

        if (winner) {
          newlyResolved.push({ conditionId: m.conditionId, outcome: winner });
        }
      }
      if (batch.length < limit) keepGoing = false;
      else offset += limit;

      // Safety: don't paginate forever
      if (offset > 1000) keepGoing = false;
    } catch (err) {
      errors.push(`Fetch closed markets offset=${offset}: ${err}`);
      keepGoing = false;
    }
  }

  // ─── Step 3: Mark resolved markets in DB ───

  const BATCH = 50;
  for (let i = 0; i < newlyResolved.length; i += BATCH) {
    const chunk = newlyResolved.slice(i, i + BATCH);
    for (const m of chunk) {
      const { error } = await supabaseAdmin
        .from('markets')
        .update({
          is_resolved: true,
          resolution_outcome: m.outcome,
          resolved_at: new Date().toISOString(),
        })
        .eq('condition_id', m.conditionId);

      if (error) {
        errors.push(`Resolve ${m.conditionId}: ${error.message}`);
      } else {
        resolved++;
      }
    }
  }

  // ─── Step 4: Compute accuracy scores across ALL resolved markets ───

  // Get resolved markets with outcomes (paginated)
  const resolvedMarkets: { condition_id: string; resolution_outcome: string }[] = [];
  let resOffset = 0;
  const RES_PAGE = 1000;

  while (true) {
    const { data: page, error: resErr } = await supabaseAdmin
      .from('markets')
      .select('condition_id, resolution_outcome')
      .eq('is_resolved', true)
      .not('resolution_outcome', 'is', null)
      .range(resOffset, resOffset + RES_PAGE - 1);

    if (resErr || !page || page.length === 0) break;
    resolvedMarkets.push(...page);
    if (page.length < RES_PAGE) break;
    resOffset += RES_PAGE;
  }

  if (resolvedMarkets.length === 0) {
    return { resolved, walletsUpdated: 0, errors };
  }

  const resolutionMap = new Map<string, string>();
  for (const m of resolvedMarkets) {
    resolutionMap.set(m.condition_id, m.resolution_outcome);
  }

  // Fetch all trades for resolved markets
  const resolvedIds = [...resolutionMap.keys()];
  const ID_BATCH = 100;
  const allTrades: {
    wallet_address: string;
    market_id: string;
    side: string;
    outcome: string;
    size_usdc: number;
  }[] = [];

  for (let i = 0; i < resolvedIds.length; i += ID_BATCH) {
    const batch = resolvedIds.slice(i, i + ID_BATCH);
    const { data, error } = await bq
      .from('trades')
      .select('wallet_address, market_id, side, outcome, size_usdc')
      .in('market_id', batch);

    if (error) {
      errors.push(`Fetch trades batch ${i}: ${error.message}`);
    } else if (data) {
      allTrades.push(...data);
    }
  }

  if (allTrades.length === 0) {
    return { resolved, walletsUpdated: 0, errors };
  }

  // Group by wallet and compute accuracy
  const walletStats = new Map<string, { correct: number; total: number }>();

  for (const t of allTrades) {
    const resolution = resolutionMap.get(t.market_id);
    if (!resolution) continue;

    if (!walletStats.has(t.wallet_address)) {
      walletStats.set(t.wallet_address, { correct: 0, total: 0 });
    }
    const stats = walletStats.get(t.wallet_address)!;
    stats.total++;

    // A trade is "correct" if:
    // - BUY the winning outcome
    // - SELL the losing outcome
    const isWinningOutcome = t.outcome === resolution;
    if ((t.side === 'BUY' && isWinningOutcome) || (t.side === 'SELL' && !isWinningOutcome)) {
      stats.correct++;
    }
  }

  // ─── Step 5: Batch-upsert accuracy scores ───

  const walletRows = [];
  for (const [address, stats] of walletStats) {
    walletRows.push({
      address,
      accuracy_score: stats.total > 0 ? stats.correct / stats.total : null,
      accuracy_sample_size: stats.total,
    });
  }

  const UPSERT_BATCH = 500;
  for (let i = 0; i < walletRows.length; i += UPSERT_BATCH) {
    const chunk = walletRows.slice(i, i + UPSERT_BATCH);
    const { error } = await bq
      .from('wallets')
      .upsert(chunk, { onConflict: 'address' });

    if (error) {
      errors.push(`Wallet accuracy batch ${i}: ${error.message}`);
    } else {
      walletsUpdated += chunk.length;
    }
  }

  return { resolved, walletsUpdated, errors };
}
