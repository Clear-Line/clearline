import Link from 'next/link';
import { ArrowRight, Clock, Network } from 'lucide-react';
import { TypeBadge } from './TypeBadge';
import type { CaseStudySummary } from './caseStudyTypes';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CaseStudyCard({ study }: { study: CaseStudySummary }) {
  return (
    <Link
      href={`/case-studies/${study.slug}`}
      className="group block bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-2xl p-5 hover:border-[#00d4ff]/30 transition-colors"
    >
      {/* Row 1: type badge + date */}
      <div className="flex items-center justify-between mb-3">
        <TypeBadge type={study.studyType} />
        <span className="text-[10px] text-[#475569] tracking-wide uppercase font-mono">
          {formatDate(study.triggerTimestamp)}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-white font-medium text-base mb-2 leading-snug group-hover:text-[#00d4ff] transition-colors">
        {study.title}
      </h3>

      {/* Subtitle: headline or trigger market or event name */}
      {(study.externalHeadline || study.triggerMarketTitle || study.calendarEventName) && (
        <p className="text-[#64748b] text-xs mb-3 line-clamp-2">
          {study.externalHeadline || study.calendarEventName || study.triggerMarketTitle}
        </p>
      )}

      {/* Evidence stat — the credibility layer */}
      {study.evidenceStat && (
        <div className="mb-3 border border-[rgba(255,255,255,0.04)] rounded-xl bg-[#080b12]/50 py-2.5 px-3">
          <div className="text-[9px] text-[#64748b] tracking-[0.1em] uppercase mb-1">Evidence</div>
          <div className="text-[#00d4ff] font-mono text-xs font-medium">{study.evidenceStat}</div>
        </div>
      )}

      {/* Row 3: footer stats + cta */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-[10px] text-[#64748b] tracking-wide uppercase">
          <div className="flex items-center gap-1">
            <Network className="h-3 w-3" />
            <span className="font-mono text-[#94a3b8]">{study.affectedCount}</span> markets
          </div>
          {study.maxLagHours != null && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span className="font-mono text-[#94a3b8]">{study.maxLagHours.toFixed(1)}h</span> max lag
            </div>
          )}
        </div>
        <span className="flex items-center gap-1 text-[#00d4ff] text-[10px] font-medium tracking-[0.1em] uppercase group-hover:gap-1.5 transition-all">
          Read
          <ArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}
