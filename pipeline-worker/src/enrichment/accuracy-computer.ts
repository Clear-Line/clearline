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

/**
 * One-time backfill: reset legacy wallets that have accuracy_score set
 * but wins=0 and losses=0 (from before the wins/losses columns existed).
 * Clears their stale accuracy_score and total_pnl_usdc so they get
 * re-scored properly by the normal accuracy flow.
 */
export async function backfillLegacyWallets(): Promise<{ reset: number; errors: string[] }> {
  const errors: string[] = [];
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;

  // Check if backfill already ran — skip if so (one-time operation)
  const { data: flagRow } = await bq
    .from('pipeline_metadata')
    .select('value')
    .eq('key', 'legacy_wallet_backfill_done')
    .limit(1);

  if (flagRow?.[0]?.value === 'true') {
    console.log('[Accuracy] Legacy wallet backfill already completed — skipping');
    return { reset: 0, errors: [] };
  }

  // Find wallets with stale legacy data: accuracy_score > 0 but wins=0 and losses=0
  const { data: legacy, error: qErr } = await bq.rawQuery<{ cnt: number }>(`
    SELECT COUNT(*) as cnt FROM \`${dataset}.wallets\`
    WHERE accuracy_score > 0
      AND (wins IS NULL OR wins = 0)
      AND (losses IS NULL OR losses = 0)
  `);

  const count = legacy?.[0]?.cnt ?? 0;
  if (qErr) return { reset: 0, errors: [`Legacy query: ${qErr.message}`] };
  if (count === 0) {
    console.log('[Accuracy] No legacy wallets to reset');
    return { reset: 0, errors: [] };
  }

  console.log(`[Accuracy] Resetting ${count} legacy wallets with stale accuracy data...`);

  // Reset their accuracy_score, total_pnl_usdc, and accuracy_sample_size
  // so they start fresh. The normal accuracy flow will re-score them
  // when their markets resolve (or have already resolved).
  try {
    await bq.rawQuery(`
      UPDATE \`${dataset}.wallets\`
      SET accuracy_score = 0,
          accuracy_sample_size = 0,
          total_pnl_usdc = 0,
          credibility_score = NULL,
          last_accuracy_update = CURRENT_TIMESTAMP()
      WHERE accuracy_score > 0
        AND (wins IS NULL OR wins = 0)
        AND (losses IS NULL OR losses = 0)
    `);
  } catch (err) {
    errors.push(`Legacy reset: ${err}`);
    return { reset: 0, errors };
  }

  // Now re-score these wallets from already-resolved markets
  // by finding their positions in wallet_trade_positions for resolved markets
  const { data: resolvedMarkets, error: rmErr } = await bq
    .from('markets')
    .select('condition_id, resolution_outcome')
    .eq('is_resolved', true)
    .not('resolution_outcome', 'is', null);

  if (rmErr || !resolvedMarkets || resolvedMarkets.length === 0) {
    console.log('[Accuracy] No resolved markets to backfill from');
    return { reset: count, errors };
  }

  console.log(`[Accuracy] Re-scoring from ${resolvedMarkets.length} resolved markets...`);

  const walletDeltas = new Map<string, { winDelta: number; lossDelta: number; pnlDelta: number }>();
  let marketsProcessed = 0;

  // BIGQUERY COST DISCIPLINE: batched fetch instead of one query per market.
  // Build resolution_outcome lookup so we can score in memory.
  const outcomeByMarket = new Map<string, string>();
  for (const m of resolvedMarkets) {
    if (m.resolution_outcome) outcomeByMarket.set(m.condition_id, m.resolution_outcome);
  }
  const resolvedIds = [...outcomeByMarket.keys()];

  const ID_CHUNK = 1000;
  for (let i = 0; i < resolvedIds.length; i += ID_CHUNK) {
    const chunk = resolvedIds.slice(i, i + ID_CHUNK);
    const { data: positions, error: posErr } = await bq.rawQuery<{
      market_id: string;
      wallet_address: string;
      outcome: string;
      buy_volume: number;
      sell_volume: number;
      avg_buy_price: number;
    }>(
      `SELECT market_id, wallet_address, outcome, buy_volume, sell_volume, avg_buy_price
       FROM \`${dataset}.wallet_trade_positions\`
       WHERE market_id IN UNNEST(@market_ids)`,
      { market_ids: chunk },
    );

    if (posErr) {
      errors.push(`Backfill positions batch ${i}: ${posErr.message}`);
      continue;
    }

    const seenMarkets = new Set<string>();
    for (const pos of positions ?? []) {
      const winnerOutcome = outcomeByMarket.get(pos.market_id);
      if (!winnerOutcome) continue;
      if (!seenMarkets.has(pos.market_id)) {
        seenMarkets.add(pos.market_id);
        marketsProcessed++;
      }

      const isNetBuyer = (pos.buy_volume || 0) > (pos.sell_volume || 0);
      const bettedOnWinner = pos.outcome === winnerOutcome;
      const isCorrect = (isNetBuyer && bettedOnWinner) || (!isNetBuyer && !bettedOnWinner);

      let pnl = 0;
      if (isNetBuyer && pos.avg_buy_price > 0) {
        const netInvested = (pos.buy_volume || 0) - (pos.sell_volume || 0);
        pnl = bettedOnWinner ? netInvested * (1 / pos.avg_buy_price - 1) : -netInvested;
      } else if (!isNetBuyer) {
        const netSold = (pos.sell_volume || 0) - (pos.buy_volume || 0);
        pnl = bettedOnWinner ? -netSold : netSold * 0.5; // conservative estimate for sellers
      }

      const existing = walletDeltas.get(pos.wallet_address) ?? { winDelta: 0, lossDelta: 0, pnlDelta: 0 };
      if (isCorrect) existing.winDelta++;
      else existing.lossDelta++;
      existing.pnlDelta += pnl;
      walletDeltas.set(pos.wallet_address, existing);
    }
  }

  // Upsert re-scored wallets
  const upsertRows = [];
  for (const [address, delta] of walletDeltas) {
    const newWins = delta.winDelta;
    const newLosses = delta.lossDelta;
    const newSampleSize = newWins + newLosses;
    const newAccuracy = newSampleSize > 0 ? newWins / newSampleSize : 0;

    upsertRows.push({
      address,
      wins: newWins,
      losses: newLosses,
      accuracy_score: Math.round(newAccuracy * 10000) / 10000,
      accuracy_sample_size: newSampleSize,
      total_pnl_usdc: Math.round(delta.pnlDelta * 100) / 100,
      last_accuracy_update: new Date().toISOString(),
    });
  }

  const BATCH = 500;
  let upserted = 0;
  for (let i = 0; i < upsertRows.length; i += BATCH) {
    const chunk = upsertRows.slice(i, i + BATCH);
    const { error } = await bq.from('wallets').upsert(chunk, { onConflict: 'address' });
    if (error) errors.push(`Backfill upsert batch ${i}: ${error.message}`);
    else upserted += chunk.length;
  }

  // Mark as done so it never runs again
  try {
    await bq.from('pipeline_metadata').upsert(
      [{ key: 'legacy_wallet_backfill_done', value: 'true', updated_at: new Date().toISOString() }],
      { onConflict: 'key' },
    );
  } catch { /* non-critical */ }

  console.log(`[Accuracy] Backfill complete: reset ${count} legacy wallets, re-scored ${upserted} from ${marketsProcessed} resolved markets`);
  return { reset: count, errors };
}

export async function computeAccuracy(): Promise<{
  resolved: number;
  walletsUpdated: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let resolved = 0;
  let walletsUpdated = 0;
  const dataset = `${process.env.GCP_PROJECT_ID}.${process.env.BQ_DATASET || 'polymarket'}`;

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
  //
  // BIGQUERY COST DISCIPLINE: previously this loop ran one
  // `SELECT ... WHERE market_id = @id` per resolved market, which scanned ~30 MB
  // each (BQ minimum scan size). With 80k+ markets that's $5–10/day for nothing.
  // Now we issue ONE batched query for all newly-resolved markets and group in
  // memory. Same logic, ~10,000× cheaper.

  if (newlyResolved.length === 0) {
    return { resolved, walletsUpdated: 0, errors };
  }

  // Collect per-wallet results across all newly resolved markets
  const walletDeltas = new Map<string, { winDelta: number; lossDelta: number; pnlDelta: number }>();
  let localHits = 0;
  let apiFallbacks = 0;

  // ── 4a: One batched query for all newly-resolved markets ──
  const newlyResolvedIds = newlyResolved.map((m) => m.conditionId);
  const positionsByMarket = new Map<string, Array<{
    wallet_address: string;
    outcome: string;
    buy_volume: number;
    sell_volume: number;
    avg_buy_price: number;
    buy_count: number;
    sell_count: number;
  }>>();

  // Chunk the IN UNNEST list to avoid query parameter size limits
  const ID_CHUNK = 1000;
  for (let i = 0; i < newlyResolvedIds.length; i += ID_CHUNK) {
    const chunk = newlyResolvedIds.slice(i, i + ID_CHUNK);
    const { data: rows, error: posErr } = await bq.rawQuery<{
      market_id: string;
      wallet_address: string;
      outcome: string;
      buy_volume: number;
      sell_volume: number;
      avg_buy_price: number;
      buy_count: number;
      sell_count: number;
    }>(
      `SELECT market_id, wallet_address, outcome, buy_volume, sell_volume,
              avg_buy_price, buy_count, sell_count
       FROM \`${dataset}.wallet_trade_positions\`
       WHERE market_id IN UNNEST(@market_ids)`,
      { market_ids: chunk },
    );

    if (posErr) {
      errors.push(`Positions batch ${i}: ${posErr.message}`);
      continue;
    }
    for (const row of rows ?? []) {
      const arr = positionsByMarket.get(row.market_id) ?? [];
      arr.push(row);
      positionsByMarket.set(row.market_id, arr);
    }
  }

  // ── 4b: Score each market (in memory now — no per-market BQ calls) ──
  const marketsWithLocalPositions: string[] = [];

  for (const market of newlyResolved) {
    try {
      const localPositions = positionsByMarket.get(market.conditionId) ?? [];

      const walletPositions = new Map<string, {
        buyVolume: number;
        sellVolume: number;
        outcome: string;
        avgBuyPrice: number;
        buyCount: number;
      }>();

      if (localPositions.length > 0) {
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
        marketsWithLocalPositions.push(market.conditionId);
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
        } else if (!isNetBuyer) {
          // Net seller: conservative estimate — profit is capped at net sold amount
          const netSold = pos.sellVolume - pos.buyVolume;
          pnl = bettedOnWinner ? -netSold : netSold * 0.5;
        }

        const existing = walletDeltas.get(address) ?? { winDelta: 0, lossDelta: 0, pnlDelta: 0 };
        if (isCorrect) existing.winDelta++;
        else existing.lossDelta++;
        existing.pnlDelta += pnl;
        walletDeltas.set(address, existing);
      }
    } catch (err) {
      errors.push(`Score market ${market.conditionId}: ${err}`);
    }
  }

  // ── 4c: Single batched DELETE of consumed positions (was N per-market deletes) ──
  if (marketsWithLocalPositions.length > 0) {
    for (let i = 0; i < marketsWithLocalPositions.length; i += ID_CHUNK) {
      const chunk = marketsWithLocalPositions.slice(i, i + ID_CHUNK);
      try {
        await bq.rawQuery(
          `DELETE FROM \`${dataset}.wallet_trade_positions\`
           WHERE market_id IN UNNEST(@market_ids)`,
          { market_ids: chunk },
        );
      } catch (err) {
        errors.push(`Cleanup batch ${i}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`[Accuracy] Scoring sources: ${localHits} local, ${apiFallbacks} API fallback`);

  // ─── Step 5: Single additive MERGE — increment wins/losses/pnl in BigQuery ───
  // BIGQUERY COST DISCIPLINE: previously this was a fetch-existing-then-upsert
  // loop that scanned ~25 MB per 200-wallet batch. Now we MERGE deltas directly
  // and let BigQuery do the addition server-side. The accuracy_score is
  // computed in the UPDATE clause from the new wins/losses totals.
  const nowIso = new Date().toISOString();
  const deltaRows = [...walletDeltas.entries()].map(([address, delta]) => ({
    address,
    win_delta: delta.winDelta,
    loss_delta: delta.lossDelta,
    pnl_delta: Math.round(delta.pnlDelta * 100) / 100,
  }));

  if (deltaRows.length > 0) {
    const MERGE_BATCH = 500;
    for (let i = 0; i < deltaRows.length; i += MERGE_BATCH) {
      const chunk = deltaRows.slice(i, i + MERGE_BATCH);
      const sourceRows = chunk
        .map((d) => {
          const escaped = d.address.replace(/'/g, "\\'");
          return `SELECT '${escaped}' AS address, ${d.win_delta} AS win_delta, ${d.loss_delta} AS loss_delta, ${d.pnl_delta} AS pnl_delta`;
        })
        .join('\nUNION ALL\n');

      const mergeSQL = `
        MERGE \`${dataset}.wallets\` AS target
        USING (${sourceRows}) AS source
        ON target.address = source.address
        WHEN MATCHED THEN UPDATE SET
          wins = COALESCE(target.wins, 0) + source.win_delta,
          losses = COALESCE(target.losses, 0) + source.loss_delta,
          accuracy_sample_size =
            COALESCE(target.wins, 0) + source.win_delta +
            COALESCE(target.losses, 0) + source.loss_delta,
          accuracy_score = SAFE_DIVIDE(
            COALESCE(target.wins, 0) + source.win_delta,
            COALESCE(target.wins, 0) + source.win_delta +
              COALESCE(target.losses, 0) + source.loss_delta
          ),
          total_pnl_usdc = ROUND(COALESCE(target.total_pnl_usdc, 0) + source.pnl_delta, 2),
          last_accuracy_update = TIMESTAMP('${nowIso}')
        WHEN NOT MATCHED THEN
          INSERT (address, wins, losses, accuracy_sample_size, accuracy_score, total_pnl_usdc, last_accuracy_update)
          VALUES (
            source.address,
            source.win_delta,
            source.loss_delta,
            source.win_delta + source.loss_delta,
            SAFE_DIVIDE(source.win_delta, source.win_delta + source.loss_delta),
            ROUND(source.pnl_delta, 2),
            TIMESTAMP('${nowIso}')
          )
      `;

      try {
        await bq.rawQuery(mergeSQL);
        walletsUpdated += chunk.length;
      } catch (err) {
        errors.push(`Wallet accuracy merge batch ${i}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  console.log(`[Accuracy] Resolved ${resolved} markets, scored ${walletsUpdated} wallets from ${newlyResolved.length} newly resolved markets`);
  return { resolved, walletsUpdated, errors };
}
