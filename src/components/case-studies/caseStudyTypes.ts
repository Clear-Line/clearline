/**
 * Shared TypeScript interfaces for the case studies feature.
 * API responses and component props use these.
 */

export type CaseStudyType = 'volume_shock' | 'external_event' | 'calendar' | 'resolution';

export interface CaseStudySummary {
  slug: string;
  title: string;
  studyType: CaseStudyType;
  triggerTimestamp: string;
  triggerMarketTitle: string | null;
  externalHeadline: string | null;
  calendarEventName: string | null;
  evidenceStat: string | null;
  affectedCount: number;
  maxLagHours: number | null;
}

export interface CaseStudyDetail extends CaseStudySummary {
  triggerMarketId: string | null;
  externalSourceUrl: string | null;
  windowStart: string;
  windowEnd: string;
  narrativeMd: string | null;
  series: CaseStudySeriesPoint[];
  markets: CaseStudyMarket[];
}

export interface CaseStudySeriesPoint {
  marketId: string;
  timestamp: string;
  yesPrice: number | null;
  volume24h: number | null;
  liquidity: number | null;
}

export interface CaseStudyMarket {
  marketId: string;
  marketTitle: string;
  category: string;
  role: 'trigger' | 'anchor' | 'affected';
  lagHours: number | null;
  priceDelta: number | null;
  volumeDeltaPct: number | null;
  laggedCorrelation: number | null;
  bestLagHours: number | null;
  rank: number;
}
