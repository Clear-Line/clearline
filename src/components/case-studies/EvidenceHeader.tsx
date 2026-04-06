import { ExternalLink, Clock, Network } from 'lucide-react';
import { TypeBadge } from './TypeBadge';
import type { CaseStudyDetail } from './caseStudyTypes';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function EvidenceHeader({ study }: { study: CaseStudyDetail }) {
  return (
    <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-2xl p-6 mb-6">
      {/* Row 1: badge + trigger timestamp */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <TypeBadge type={study.studyType} size="md" />
        <span className="text-[10px] text-[#475569] tracking-wide uppercase font-mono">
          Trigger: {formatDateTime(study.triggerTimestamp)}
        </span>
      </div>

      {/* Title */}
      <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight mb-2">
        {study.title}
      </h1>

      {/* Subtitle: headline or trigger market */}
      {(study.externalHeadline || study.triggerMarketTitle || study.calendarEventName) && (
        <p className="text-[#94a3b8] text-sm mb-4 leading-relaxed">
          {study.externalHeadline || study.calendarEventName || study.triggerMarketTitle}
          {study.externalSourceUrl && (
            <a
              href={study.externalSourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 ml-2 text-[#00d4ff] hover:text-[#00bde0] text-xs"
            >
              Source
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </p>
      )}

      {/* Evidence stat — the big cyan monospace claim */}
      {study.evidenceStat && (
        <div className="border border-[#00d4ff]/20 rounded-xl bg-[#00d4ff]/5 py-4 px-5 mb-4">
          <div className="text-[10px] text-[#00d4ff]/60 tracking-[0.2em] uppercase mb-2">
            Evidence
          </div>
          <div className="text-[#00d4ff] font-mono text-lg sm:text-xl font-medium leading-tight">
            {study.evidenceStat}
          </div>
        </div>
      )}

      {/* Footer stats */}
      <div className="flex items-center gap-6 flex-wrap text-[11px] text-[#64748b] tracking-wide uppercase">
        <div className="flex items-center gap-1.5">
          <Network className="h-3.5 w-3.5" />
          <span className="font-mono text-[#94a3b8]">{study.affectedCount}</span>
          <span>affected markets</span>
        </div>
        {study.maxLagHours != null && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span className="font-mono text-[#94a3b8]">{study.maxLagHours.toFixed(1)}h</span>
            <span>max lag</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span>Window:</span>
          <span className="font-mono text-[#94a3b8]">
            {formatDateTime(study.windowStart)}
          </span>
          <span>→</span>
          <span className="font-mono text-[#94a3b8]">
            {formatDateTime(study.windowEnd)}
          </span>
        </div>
      </div>
    </div>
  );
}
