"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { EvidenceHeader } from '@/components/case-studies/EvidenceHeader';
import { CaseStudyChart } from '@/components/case-studies/CaseStudyChart';
import { AffectedMarketsGrid } from '@/components/case-studies/AffectedMarketsGrid';
import type { CaseStudyDetail } from '@/components/case-studies/caseStudyTypes';

export default function CaseStudyDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const [study, setStudy] = useState<CaseStudyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightedMarketId, setHighlightedMarketId] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    async function run() {
      try {
        const res = await fetch(`/api/case-studies/${slug}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? 'Failed to load case study');
        setStudy(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load case study');
      } finally {
        setLoading(false);
      }
    }
    run();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[#00d4ff]" />
        <span className="ml-2 text-sm text-[#64748b]">Loading case study...</span>
      </div>
    );
  }

  if (error || !study) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <p className="text-sm text-[#94a3b8] mb-2">Case study not found.</p>
        {error && <p className="text-xs text-[#64748b] font-mono">{error}</p>}
        <Link
          href="/case-studies"
          className="mt-6 inline-flex items-center gap-2 text-[#00d4ff] text-xs font-medium tracking-[0.1em] uppercase hover:text-[#00bde0]"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Case Studies
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Link
          href="/case-studies"
          className="inline-flex items-center gap-2 text-[#64748b] text-[11px] font-medium tracking-[0.1em] uppercase hover:text-[#00d4ff] transition-colors mb-4"
        >
          <ArrowLeft className="h-3 w-3" />
          All Case Studies
        </Link>

        <EvidenceHeader study={study} />

        {study.narrativeMd && (
          <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-2xl p-6 mb-6">
            <div className="text-[10px] text-[#64748b] tracking-[0.2em] uppercase mb-3">
              Analysis
            </div>
            <div className="prose prose-invert max-w-none text-sm text-[#cbd5e1] leading-relaxed whitespace-pre-wrap">
              {study.narrativeMd}
            </div>
          </div>
        )}

        <div className="mb-6">
          <CaseStudyChart study={study} highlightedMarketId={highlightedMarketId} />
        </div>

        <AffectedMarketsGrid
          markets={study.markets}
          highlightedMarketId={highlightedMarketId}
          onHover={setHighlightedMarketId}
          maxLagHours={study.maxLagHours}
        />
      </div>
    </div>
  );
}
