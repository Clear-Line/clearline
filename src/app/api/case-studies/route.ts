import { NextResponse } from 'next/server';
import { bq } from '@/lib/bigquery';
import type { CaseStudySummary, CaseStudyType } from '@/components/case-studies/caseStudyTypes';

export const runtime = 'nodejs';

interface StudyRow {
  slug: string;
  title: string;
  study_type: string;
  trigger_timestamp: string;
  trigger_market_title: string | null;
  external_headline: string | null;
  calendar_event_name: string | null;
  evidence_stat: string | null;
  affected_count: number | null;
  max_lag_hours: number | null;
}

/**
 * GET /api/case-studies — list of published case studies, newest first.
 * PUBLIC — no auth required.
 */
export async function GET() {
  const { data, error } = await bq
    .from<StudyRow>('case_studies')
    .select(
      'slug, title, study_type, trigger_timestamp, trigger_market_title, external_headline, calendar_event_name, evidence_stat, affected_count, max_lag_hours',
    )
    .eq('published', true)
    .order('trigger_timestamp', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const studies: CaseStudySummary[] = (data ?? []).map((r) => ({
    slug: r.slug,
    title: r.title,
    studyType: r.study_type as CaseStudyType,
    triggerTimestamp: r.trigger_timestamp,
    triggerMarketTitle: r.trigger_market_title,
    externalHeadline: r.external_headline,
    calendarEventName: r.calendar_event_name,
    evidenceStat: r.evidence_stat,
    affectedCount: r.affected_count ?? 0,
    maxLagHours: r.max_lag_hours,
  }));

  const response = NextResponse.json({ studies });
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=3600, stale-while-revalidate=86400',
  );
  return response;
}
