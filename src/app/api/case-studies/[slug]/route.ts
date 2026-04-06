import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import type {
  CaseStudyDetail,
  CaseStudyMarket,
  CaseStudySeriesPoint,
  CaseStudyType,
} from '@/components/case-studies/caseStudyTypes';

export const runtime = 'nodejs';

interface StudyRow {
  slug: string;
  title: string;
  study_type: string;
  trigger_timestamp: string;
  trigger_market_id: string | null;
  trigger_market_title: string | null;
  external_headline: string | null;
  external_source_url: string | null;
  calendar_event_name: string | null;
  window_start: string;
  window_end: string;
  evidence_stat: string | null;
  narrative_md: string | null;
  affected_count: number | null;
  max_lag_hours: number | null;
  published: boolean;
}

interface SeriesRow {
  market_id: string;
  timestamp: string;
  yes_price: number | null;
  volume_24h: number | null;
  liquidity: number | null;
}

interface MarketRow {
  market_id: string;
  market_title: string | null;
  category: string | null;
  role: string | null;
  lag_hours: number | null;
  price_delta: number | null;
  volume_delta_pct: number | null;
  lagged_correlation: number | null;
  best_lag_hours: number | null;
  rank: number | null;
}

/**
 * GET /api/case-studies/[slug] — full case study detail.
 * PUBLIC — no auth required.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const [studyRes, seriesRes, marketsRes] = await Promise.all([
    bq
      .from<StudyRow>('case_studies')
      .select('*')
      .eq('slug', slug)
      .eq('published', true)
      .single(),
    bq
      .from<SeriesRow>('case_study_series')
      .select('market_id, timestamp, yes_price, volume_24h, liquidity')
      .eq('slug', slug)
      .order('timestamp', { ascending: true }),
    bq
      .from<MarketRow>('case_study_markets')
      .select(
        'market_id, market_title, category, role, lag_hours, price_delta, volume_delta_pct, lagged_correlation, best_lag_hours, rank',
      )
      .eq('slug', slug)
      .order('rank', { ascending: true }),
  ]);

  if (studyRes.error || !studyRes.data) {
    return NextResponse.json({ error: 'Case study not found' }, { status: 404 });
  }
  if (seriesRes.error) {
    return NextResponse.json({ error: seriesRes.error.message }, { status: 500 });
  }
  if (marketsRes.error) {
    return NextResponse.json({ error: marketsRes.error.message }, { status: 500 });
  }

  const s = studyRes.data;

  const markets: CaseStudyMarket[] = (marketsRes.data ?? []).map((m) => ({
    marketId: m.market_id,
    marketTitle: m.market_title ?? '(unknown)',
    category: m.category ?? 'other',
    role: (m.role ?? 'affected') as CaseStudyMarket['role'],
    lagHours: m.lag_hours,
    priceDelta: m.price_delta,
    volumeDeltaPct: m.volume_delta_pct,
    laggedCorrelation: m.lagged_correlation,
    bestLagHours: m.best_lag_hours,
    rank: m.rank ?? 0,
  }));

  const series: CaseStudySeriesPoint[] = (seriesRes.data ?? []).map((p) => ({
    marketId: p.market_id,
    timestamp: p.timestamp,
    yesPrice: p.yes_price,
    volume24h: p.volume_24h,
    liquidity: p.liquidity,
  }));

  const detail: CaseStudyDetail = {
    slug: s.slug,
    title: s.title,
    studyType: s.study_type as CaseStudyType,
    triggerTimestamp: s.trigger_timestamp,
    triggerMarketId: s.trigger_market_id,
    triggerMarketTitle: s.trigger_market_title,
    externalHeadline: s.external_headline,
    externalSourceUrl: s.external_source_url,
    calendarEventName: s.calendar_event_name,
    evidenceStat: s.evidence_stat,
    affectedCount: s.affected_count ?? markets.filter((m) => m.role !== 'trigger').length,
    maxLagHours: s.max_lag_hours,
    windowStart: s.window_start,
    windowEnd: s.window_end,
    narrativeMd: s.narrative_md,
    series,
    markets,
  };

  const response = NextResponse.json(detail);
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=86400, stale-while-revalidate=604800',
  );
  return response;
}
