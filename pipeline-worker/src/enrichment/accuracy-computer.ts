/**
 * Accuracy Computer — detects resolved markets and incrementally accumulates
 * wallet win/loss stats.
 *
 * 1. Checks Gamma API for markets that have closed/resolved.
 * 2. Updates markets table with resolution_outcome, is_resolved = true.
 * 3. For NEWLY resolved markets only, fetches trades from Polymarket API
 *    (not the 3-day BQ window) and increments wallet wins/losses.
 *
 * Key change from v1: accuracy is ACCUMULATED over time, not recomputed from
 * a volatile 3-day trade window. Uses Polymarket API for trade data so we see
 * ALL trades in the market, not just ones in our retention window.
 */

import { bq } from '../core/bigquery.js';
import { GammaMarket, fetchMarketTradesPaginated } from '../core/polymarket-client.js';

const GAMMA_API = 'https://gamma-api.polymarket.com';

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

function determineResolution(
  outcomes: string[],
  outcomePrices: string[],
): string | null {
  if (!outcomes || !outcomePrices || outcomes.length !== outcomePrices.length) return null;
  for (let i = 0; i < outcomePrices.length; i++) {
    const price = parseFloat(outcomePrices[i]);
    if (price >= 0.95) return outcomes[i];
  }
  return null;
}

function parseJsonField(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

export async function computeAccuracy(): Promise<{
  resolved: number;
  walletsUpdated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let resolved = 0;
  let walletsUpdated = 0;

  // ─── Step 1: Find unresolved markets in our DB ───
  const unresolvedIds = new Set<string>();
  let unresolvedOffset = 0;
  const UNRESOLVED_PAGE = 1000;

  while (true) {
    const { data: page, error: dbErr } = await bq
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

  // ─── Step 2: Check Gamma for newly resolved markets ───
  const newlyResolved: { conditionId: string; outcome: string }[] = [];
  let offset = 0;
  const limit = 100;
  let keepGoing = true;
  let emptyPages = 0; // consecutive pages with no new resolutions

  while (keepGoing) {
    try {
      const batch = await fetchClosedMarkets(limit, offset);
      let pageHits = 0;

      for (const m of batch) {
        if (!m.conditionId || !unresolvedIds.has(m.conditionId)) continue;

        const outcomes = parseJsonField(m.outcomes);
        const prices = parseJsonField(m.outcomePrices);
        const winner = determineResolution(outcomes, prices);

        if (winner) {
          newlyResolved.push({ conditionId: m.conditionId, outcome: winner });
          pageHits++;
        }
      }

      if (pageHits > 0) emptyPages = 0;
      else emptyPages++;

      if (batch.length < limit) keepGoing = false;
      else offset += limit;

      // Stop after 20 consecutive pages with no new resolutions —
      // our unresolved markets are spread across Gamma's full history
      if (emptyPages >= 20) keepGoing = false;

      // Hard cap at 5,000 pages (500K markets) to avoid infinite scanning
      if (offset > 500000) keepGoing = false;

      // Rate limit between Gamma API pages
      if (keepGoing) await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      errors.push(`Fetch closed markets offset=${offset}: ${err}`);
      keepGoing = false;
    }
  }

  console.log(`[Accuracy] Scanned ${offset + limit} closed markets, found ${newlyResolved.length} newly resolved (from ${unresolvedIds.size} unresolved)`);

  // ─── Step 3: Mark resolved markets in DB (batched MERGE for speed) ───
  const now = new Date().toISOString();
  const MARK_BATCH = 100;
  for (let i = 0; i < newlyResolved.length; i += MARK_BATCH) {
    const chunk = newlyResolved.slice(i, i + MARK_BATCH);
    const rows = chunk.map((m) => ({
      condition_id: m.conditionId,
      is_resolved: true,
      resolution_outcome: m.outcome,
      resolved_at: now,
    }));

    const { error } = await bq
      .from('markets')
      .upsert(rows, { onConflict: 'condition_id' });

    if (error) {
      errors.push(`Resolve batch ${i}: ${error.message}`);
    } else {
      resolved += chunk.length;
    }
  }

  // ─── Step 4: Incrementally score wallets for NEWLY resolved markets only ───
  // Key difference: fetch trades from Polymarket API (has full market history),
  // NOT from our 3-day BQ trades table.

  if (newlyResolved.length === 0) {
    return { resolved, walletsUpdated: 0, errors };
  }

  // Collect per-wallet results across all newly resolved markets
  const walletDeltas = new Map<string, { winDelta: number; lossDelta: number; pnlDelta: number }>();
  let localHits = 0;
  let apiFallbacks = 0;

  for (const market of newlyResolved) {
    try {
      // Phase 1: Check our own blockchain-sourced position data first
      const { data: localPositions } = await bq
        .from('wallet_trade_positions')
        .select('wallet_address, outcome, buy_volume, sell_volume, avg_buy_price, buy_count, sell_count')
        .eq('market_id', market.conditionId);

      const walletPositions = new Map<string, {
        buyVolume: number;
        sellVolume: number;
        outcome: string;
        avgBuyPrice: number;
        buyCount: number;
      }>();

      if (localPositions && localPositions.length > 0) {
        // Use blockchain-sourced positions — complete, uncapped data
        for (const pos of localPositions) {
          walletPositions.set(pos.wallet_address, {
            buyVolume: pos.buy_volume || 0,
            sellVolume: pos.sell_volume || 0,
            outcome: pos.outcome || '',
            avgBuyPrice: pos.avg_buy_price || 0,
            buyCount: pos.buy_count || 0,
          });
        }
        localHits++;
      } else {
        // Phase 2: Fall back to Polymarket API (capped at 1,000 trades)
        const { trades } = await fetchMarketTradesPaginated(market.conditionId, {
          maxPages: 10,
          pageSize: 100,
        });

        if (trades.length === 0) continue;

        for (const t of trades) {
          const existing = walletPositions.get(t.proxyWallet) ?? {
            buyVolume: 0, sellVolume: 0, outcome: t.outcome,
            avgBuyPrice: 0, buyCount: 0,
          };

          if (t.side === 'BUY') {
            existing.buyVolume += t.usdcSize || 0;
            existing.avgBuyPrice = ((existing.avgBuyPrice * existing.buyCount) + (t.price || 0)) / (existing.buyCount + 1);
            existing.buyCount++;
          } else {
            existing.sellVolume += t.usdcSize || 0;
          }
          existing.outcome = t.outcome;
          walletPositions.set(t.proxyWallet, existing);
        }
        apiFallbacks++;

        // Rate limit: small delay between API calls
        await new Promise((r) => setTimeout(r, 200));
      }

      // Score each wallet (same logic regardless of data source)
      for (const [address, pos] of walletPositions) {
        const isNetBuyer = pos.buyVolume > pos.sellVolume;
        const bettedOnWinner = pos.outcome === market.outcome;
        const isCorrect = (isNetBuyer && bettedOnWinner) || (!isNetBuyer && !bettedOnWinner);

        // PnL calculation
        let pnl = 0;
        if (isNetBuyer && pos.avgBuyPrice > 0) {
          const netInvested = pos.buyVolume - pos.sellVolume;
          pnl = bettedOnWinner
            ? netInvested * (1 / pos.avgBuyPrice - 1)
            : -netInvested;
        } else {
          pnl = bettedOnWinner ? -pos.sellVolume : pos.sellVolume;
        }

        const existing = walletDeltas.get(address) ?? { winDelta: 0, lossDelta: 0, pnlDelta: 0 };
        if (isCorrect) existing.winDelta++;
        else existing.lossDelta++;
        existing.pnlDelta += pnl;
        walletDeltas.set(address, existing);
      }

      // Clean up local positions after scoring (data consumed into wallets table)
      if (localPositions && localPositions.length > 0) {
        await bq.from('wallet_trade_positions').delete().eq('market_id', market.conditionId);
      }
    } catch (err) {
      errors.push(`Score market ${market.conditionId}: ${err}`);
    }
  }

  console.log(`[Accuracy] Scoring sources: ${localHits} local, ${apiFallbacks} API fallback`);

  // ─── Step 5: Read existing wallet rows and increment ───
  const walletAddresses = [...walletDeltas.keys()];
  const existingWallets = new Map<string, {
    wins: number; losses: number; total_pnl_usdc: number;
    username: string | null; pseudonym: string | null;
  }>();

  const ADDR_BATCH = 200;
  for (let i = 0; i < walletAddresses.length; i += ADDR_BATCH) {
    const batch = walletAddresses.slice(i, i + ADDR_BATCH);
    const { data } = await bq
      .from('wallets')
      .select('address, wins, losses, total_pnl_usdc, username, pseudonym')
      .in('address', batch);

    if (data) {
      for (const row of data) {
        existingWallets.set(row.address, {
          wins: row.wins ?? 0,
          losses: row.losses ?? 0,
          total_pnl_usdc: row.total_pnl_usdc ?? 0,
          username: row.username,
          pseudonym: row.pseudonym,
        });
      }
    }
  }

  // Build upsert rows with incremented values
  const upsertRows = [];
  for (const [address, delta] of walletDeltas) {
    const existing = existingWallets.get(address) ?? {
      wins: 0, losses: 0, total_pnl_usdc: 0, username: null, pseudonym: null,
    };

    const newWins = existing.wins + delta.winDelta;
    const newLosses = existing.losses + delta.lossDelta;
    const newSampleSize = newWins + newLosses;
    const newAccuracy = newSampleSize > 0 ? newWins / newSampleSize : 0;
    const newPnl = existing.total_pnl_usdc + delta.pnlDelta;

    upsertRows.push({
      address,
      wins: newWins,
      losses: newLosses,
      accuracy_score: Math.round(newAccuracy * 10000) / 10000,
      accuracy_sample_size: newSampleSize,
      total_pnl_usdc: Math.round(newPnl * 100) / 100,
      last_accuracy_update: new Date().toISOString(),
    });
  }

  // Batch upsert
  const UPSERT_BATCH = 500;
  for (let i = 0; i < upsertRows.length; i += UPSERT_BATCH) {
    const chunk = upsertRows.slice(i, i + UPSERT_BATCH);
    const { error } = await bq
      .from('wallets')
      .upsert(chunk, { onConflict: 'address' });

    if (error) {
      errors.push(`Wallet accuracy batch ${i}: ${error.message}`);
    } else {
      walletsUpdated += chunk.length;
    }
  }

  console.log(`[Accuracy] Resolved ${resolved} markets, scored ${walletsUpdated} wallets from ${newlyResolved.length} newly resolved markets`);
  return { resolved, walletsUpdated, errors };
}
