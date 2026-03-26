/**
 * GET /api/candidates — returns top-N ranked market opportunities.
 *
 * Query params:
 *   limit (default 20) — max candidates to return
 *
 * Reads from BigQuery candidate_scores + Supabase markets.
 * Pure read-only — no writes.
 */

import { NextResponse } from 'next/server';
import { bq } from '../../../lib/bigquery';
import { supabaseAdmin } from '../../../lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

    // Fetch top candidates by score
    const { data: candidates, error: cErr } = await bq
      .from('candidate_scores')
      .select('market_id, candidate_score, mispricing_score, tradability_score, edge_direction, top_signals, edge_component, momentum_component, flow_component, smart_money_component, whale_component, divergence_component, spread_component, volume_component, computed_at')
      .gt('candidate_score', 0)
      .order('candidate_score', { ascending: false })
      .limit(limit);

    if (cErr || !candidates || candidates.length === 0) {
      return NextResponse.json({
        candidates: [],
        error: cErr?.message || 'No candidate scores found. Pipeline may not have run yet.',
      });
    }

    // Fetch market metadata for these candidates
    const marketIds = candidates.map((c: { market_id: string }) => c.market_id);
    const { data: markets } = await supabaseAdmin
      .from('markets')
      .select('condition_id, question, category, end_date, is_active')
      .in('condition_id', marketIds);

    const marketMap = new Map<string, { question: string; category: string; end_date: string | null; is_active: boolean }>();
    if (markets) {
      for (const m of markets) {
        marketMap.set(m.condition_id, m);
      }
    }

    // Fetch latest prices for these markets
    const { data: snapshots } = await bq
      .from('market_snapshots')
      .select('market_id, yes_price, volume_24h, spread')
      .in('market_id', marketIds)
      .order('timestamp', { ascending: false });

    const priceMap = new Map<string, { yes_price: number; volume_24h: number; spread: number | null }>();
    if (snapshots) {
      for (const s of snapshots as { market_id: string; yes_price: number; volume_24h: number; spread: number | null }[]) {
        if (!priceMap.has(s.market_id)) {
          priceMap.set(s.market_id, s);
        }
      }
    }

    // Combine everything
    const enrichedCandidates = candidates.map((c: Record<string, unknown>) => {
      const market = marketMap.get(c.market_id as string);
      const price = priceMap.get(c.market_id as string);

      let topSignals: string[] = [];
      try {
        if (c.top_signals) topSignals = JSON.parse(c.top_signals as string);
      } catch { /* ignore */ }

      return {
        market_id: c.market_id,
        question: market?.question || 'Unknown Market',
        category: market?.category || 'other',
        is_active: market?.is_active ?? true,
        end_date: market?.end_date || null,

        // Scores
        candidate_score: c.candidate_score,
        mispricing_score: c.mispricing_score,
        tradability_score: c.tradability_score,
        edge_direction: c.edge_direction,

        // Components
        components: {
          edge: c.edge_component,
          momentum: c.momentum_component,
          flow: c.flow_component,
          smart_money: c.smart_money_component,
          whale: c.whale_component,
          divergence: c.divergence_component,
          spread: c.spread_component,
          volume: c.volume_component,
        },

        // Market context
        current_price: price?.yes_price ?? null,
        volume_24h: price?.volume_24h ?? 0,
        spread: price?.spread ?? null,

        // Explanation
        top_signals: topSignals,
        computed_at: c.computed_at,
      };
    });

    return NextResponse.json({
      candidates: enrichedCandidates,
      count: enrichedCandidates.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Candidates API error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch candidates', candidates: [] },
      { status: 500 },
    );
  }
}
