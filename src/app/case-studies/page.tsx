"use client";

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { CaseStudyCard } from '@/components/case-studies/CaseStudyCard';
import type {
  CaseStudySummary,
  CaseStudyType,
} from '@/components/case-studies/caseStudyTypes';

type FilterOption = 'ALL' | CaseStudyType;

const FILTERS: { key: FilterOption; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'volume_shock', label: 'Volume Shocks' },
  { key: 'external_event', label: 'External Events' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'resolution', label: 'Resolutions' },
];

export default function CaseStudiesPage() {
  const [studies, setStudies] = useState<CaseStudySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterOption>('ALL');

  useEffect(() => {
    async function run() {
      try {
        const res = await fetch('/api/case-studies');
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? 'Failed to load case studies');
        setStudies(json.studies ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load case studies');
      } finally {
        setLoading(false);
      }
    }
    run();
  }, []);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return studies;
    return studies.filter((s) => s.studyType === filter);
  }, [studies, filter]);

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#0088aa] flex items-center justify-center">
              <BookOpen className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">CASE STUDIES</h1>
              <p className="text-[#00d4ff] text-xs tracking-[0.2em] uppercase font-medium">
                Evidence from the prediction-market ecosystem
              </p>
            </div>
          </div>
          {!loading && (
            <div className="text-[10px] text-[#475569] tracking-wide uppercase font-mono">
              {studies.length} published
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-1 flex-wrap mb-6">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1 rounded-lg text-[10px] font-medium tracking-wider uppercase transition-colors ${
                filter === key
                  ? 'bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30'
                  : 'text-[#64748b] border border-transparent hover:text-white hover:bg-[rgba(255,255,255,0.04)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-[#00d4ff]" />
            <span className="ml-2 text-sm text-[#64748b]">Loading case studies...</span>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-sm text-[#94a3b8] mb-2">Unable to load case studies.</p>
            <p className="text-xs text-[#64748b] font-mono">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-[#0d1117] border border-[rgba(255,255,255,0.06)] mb-4">
              <BookOpen className="h-6 w-6 text-[#475569]" />
            </div>
            <p className="text-sm text-[#94a3b8] mb-2">
              {filter === 'ALL' ? 'No case studies published yet' : `No ${filter.replace('_', ' ')} studies`}
            </p>
            <p className="text-xs text-[#64748b]">
              Case studies are retrospective analyses of big market moments, showing how connected markets reacted.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((study) => (
              <CaseStudyCard key={study.slug} study={study} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
