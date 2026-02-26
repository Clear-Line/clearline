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
  if (/president|gop|democrat|republican|election|senate|governor|congress|vote/.test(q)) return 'politics';
  // Crypto
  if (/bitcoin|btc|ethereum|eth|crypto|token|defi|solana/.test(q)) return 'crypto';
  // Economics
  if (/fed |interest rate|inflation|gdp|s&p|nasdaq|recession|unemployment/.test(q)) return 'economics';
  // Sports
  if (/nba|nfl|mlb|nhl|super bowl|championship|world cup|match/.test(q)) return 'sports';
  // Weather
  if (/hurricane|tornado|temperature|weather|climate/.test(q)) return 'weather';

  return 'other';
}

export async function pollMarkets(): Promise<{ upserted: number; errors: string[] }> {
  const errors: string[] = [];
  let allMarkets: GammaMarket[] = [];

  // Paginate through all active markets
  let offset = 0;
  const limit = 100;
  let keepGoing = true;

  while (keepGoing) {
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

  // Upsert into markets table
  let upserted = 0;
  for (const m of allMarkets) {
    const outcomes = parseJsonField(m.outcomes);
    const clobTokenIds = parseJsonField(m.clobTokenIds);
    const outcomePrices = parseJsonField(m.outcomePrices) as string[];

    const row = {
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
    };

    const { error } = await supabaseAdmin
      .from('markets')
      .upsert(row, { onConflict: 'condition_id' });

    if (error) {
      errors.push(`Upsert market ${m.conditionId}: ${error.message}`);
    } else {
      upserted++;
    }

    // Also create a snapshot with current prices
    if (outcomePrices.length >= 2) {
      const yesPrice = parseFloat(outcomePrices[0]) || 0;
      const noPrice = parseFloat(outcomePrices[1]) || 0;

      const { error: snapError } = await supabaseAdmin
        .from('market_snapshots')
        .insert({
          market_id: m.conditionId,
          yes_price: yesPrice,
          no_price: noPrice,
          volume_24h: parseFloat(m.volume24hr) || 0,
          total_volume: parseFloat(m.volume) || 0,
          liquidity: parseFloat(m.liquidity) || 0,
        });

      if (snapError) {
        errors.push(`Snapshot ${m.conditionId}: ${snapError.message}`);
      }
    }
  }

  return { upserted, errors };
}
