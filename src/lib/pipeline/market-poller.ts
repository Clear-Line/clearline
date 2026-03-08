/**
 * Market Poller — fetches active markets from Gamma API and upserts into Supabase.
 * Run every 5 minutes.
 */

import { supabaseAdmin } from '../supabase';
import { fetchActiveMarkets, GammaMarket } from './polymarket';

function parseJsonField(raw: string | null | undefined): unknown {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function categorizeMarket(question: string, tags?: string[]): string {
  const q = question.toLowerCase();

  if (tags?.includes('politics')) return 'politics';

  // Political keywords
  if (/president|gop|democrat|republican|election|senate|governor|congress|vote|primary|caucus|ballot/.test(q)) return 'politics';
  // Geopolitics / current events / wars
  if (/iran|israel|gaza|ukraine|russia|china|taiwan|war |conflict|sanctions|military|nato|ceasefire|invasion|missile|nuclear|north korea|houthi|hezbollah|syria|yemen|coup|terror/.test(q)) return 'geopolitics';
  // Economics
  if (/fed |interest rate|inflation|gdp|s&p|nasdaq|recession|unemployment|tariff|trade war|oil price|treasury|debt ceiling|stock market|dow jones/.test(q)) return 'economics';
  // Crypto
  if (/bitcoin|btc|ethereum|eth|crypto|token|defi|solana/.test(q)) return 'crypto';
  // Sports
  if (/nba|nfl|mlb|nhl|super bowl|championship|world cup|match/.test(q)) return 'sports';
  // Weather
  if (/hurricane|tornado|temperature|weather|climate/.test(q)) return 'weather';

  return 'other';
}

export async function pollMarkets(): Promise<{ upserted: number; errors: string[] }> {
  const startTime = Date.now();
  const TIME_BUDGET_MS = 45_000; // leave 15s buffer for DB writes
  const errors: string[] = [];
  let allMarkets: GammaMarket[] = [];

  // Paginate through all active markets (with time budget)
  let offset = 0;
  const limit = 100;
  let keepGoing = true;

  while (keepGoing) {
    if (Date.now() - startTime > TIME_BUDGET_MS) {
      errors.push(`Time budget reached at offset=${offset}, will continue next run`);
      break;
    }
    try {
      const batch = await fetchActiveMarkets(limit, offset);
      allMarkets = allMarkets.concat(batch);
      if (batch.length < limit) keepGoing = false;
      else offset += limit;
    } catch (err) {
      errors.push(`Fetch page offset=${offset}: ${err}`);
      keepGoing = false;
    }
  }

  // Filter to politics, economics, and geopolitics/current events
  const FOCUS_CATEGORIES = new Set(['politics', 'economics', 'geopolitics']);
  const focusedMarkets = allMarkets.filter((m) =>
    FOCUS_CATEGORIES.has(categorizeMarket(m.question, m.tags)),
  );

  // Build rows for batch upsert
  const marketRows = [];
  const snapshotRows = [];
  const marketSeen = new Set<string>();
  const snapshotSeen = new Set<string>();

  for (const m of focusedMarkets) {
    const outcomes = parseJsonField(m.outcomes);
    const clobTokenIds = parseJsonField(m.clobTokenIds);
    const outcomePrices = parseJsonField(m.outcomePrices) as string[];

    if (!m.conditionId || marketSeen.has(m.conditionId)) continue;
    marketSeen.add(m.conditionId);

    marketRows.push({
      condition_id: m.conditionId,
      question: m.question,
      slug: m.slug || null,
      event_id: m.eventId || null,
      category: categorizeMarket(m.question, m.tags),
      outcomes,
      clob_token_ids: clobTokenIds,
      start_date: m.startDate || null,
      end_date: m.endDate || null,
      is_active: m.active && !m.closed,
      is_resolved: false,
      updated_at: new Date().toISOString(),
    });

    if (outcomePrices.length >= 2 && !snapshotSeen.has(m.conditionId)) {
      const vol24h = parseFloat(m.volume24hr) || 0;
      const totalVol = parseFloat(m.volume) || 0;
      const liq = parseFloat(m.liquidity) || 0;
      // Only snapshot markets with some activity — skip truly dead markets
      // (no 24h volume, no total volume, and no liquidity)
      if (vol24h > 0 || totalVol > 0 || liq > 0) {
        snapshotSeen.add(m.conditionId);
        snapshotRows.push({
          market_id: m.conditionId,
          timestamp: new Date().toISOString(),
          yes_price: parseFloat(outcomePrices[0]) || 0,
          no_price: parseFloat(outcomePrices[1]) || 0,
          volume_24h: vol24h,
          total_volume: totalVol,
          liquidity: liq,
        });
      }
    }
  }

  // Batch upsert markets in chunks of 500
  let upserted = 0;
  const BATCH_SIZE = 500;

  for (let i = 0; i < marketRows.length; i += BATCH_SIZE) {
    const batch = marketRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from('markets')
      .upsert(batch, { onConflict: 'condition_id' });

    if (error) {
      errors.push(`Upsert batch offset=${i}: ${error.message}`);
    } else {
      upserted += batch.length;
    }
  }

  // Batch insert snapshots in chunks of 500
  for (let i = 0; i < snapshotRows.length; i += BATCH_SIZE) {
    const batch = snapshotRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin
      .from('market_snapshots')
      .insert(batch);

    if (error) {
      errors.push(`Snapshot batch offset=${i}: ${error.message}`);
    }
  }

  return { upserted, errors };
}
