"use client";

import Link from 'next/link';
import { ArrowUpRight, ArrowDownRight, ExternalLink } from 'lucide-react';
import { CATEGORY_COLORS } from '@/components/explore/mapConstants';
import type { CaseStudyMarket } from './caseStudyTypes';

interface Props {
  markets: CaseStudyMarket[];
  highlightedMarketId?: string | null;
  onHover?: (marketId: string | null) => void;
  maxLagHours: number | null;
}

function pct(n: number | null, digits = 1): string {
  if (n == null) return '—';
  const v = n * 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function num(n: number | null, digits = 2): string {
  if (n == null) return '—';
  return n.toFixed(digits);
}

export function AffectedMarketsGrid({
  markets,
  highlightedMarketId,
  onHover,
  maxLagHours,
}: Props) {
  const affected = markets.filter((m) => m.role !== 'trigger');
  if (affected.length === 0) {
    return (
      <div className="border border-[rgba(255,255,255,0.06)] rounded-2xl bg-[#0d1117] p-8 text-center">
        <p className="text-sm text-[#64748b]">No affected markets recorded for this study.</p>
      </div>
    );
  }

  const lagMax = Math.max(maxLagHours ?? 0, 1);

  return (
    <div className="border border-[rgba(255,255,255,0.06)] rounded-2xl bg-[#0d1117] overflow-hidden">
      <div className="px-5 py-3 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
        <h2 className="text-white text-sm font-semibold tracking-wide uppercase">
          Affected Markets
        </h2>
        <span className="text-[10px] text-[#475569] tracking-[0.1em] uppercase font-mono">
          {affected.length} ranked by impact
        </span>
      </div>

      {/* Header row */}
      <div className="hidden sm:grid grid-cols-[1fr_auto_120px_90px_90px_auto] gap-3 px-5 py-2 text-[9px] text-[#64748b] tracking-[0.1em] uppercase border-b border-[rgba(255,255,255,0.04)]">
        <div>Market</div>
        <div className="text-right">Role</div>
        <div>Lag</div>
        <div className="text-right">Δ Price</div>
        <div className="text-right">Δ Volume</div>
        <div className="text-right">Corr</div>
      </div>

      <div className="divide-y divide-[rgba(255,255,255,0.04)]">
        {affected.map((m) => {
          const isHighlighted = highlightedMarketId === m.marketId;
          const categoryColor = CATEGORY_COLORS[m.category as keyof typeof CATEGORY_COLORS] ?? '#94a3b8';
          const lagPct = m.bestLagHours != null ? (m.bestLagHours / lagMax) * 100 : 0;
          const priceUp = (m.priceDelta ?? 0) >= 0;
          const PriceIcon = priceUp ? ArrowUpRight : ArrowDownRight;

          return (
            <div
              key={m.marketId}
              onMouseEnter={() => onHover?.(m.marketId)}
              onMouseLeave={() => onHover?.(null)}
              className={`grid grid-cols-[1fr_auto_120px_90px_90px_auto] gap-3 px-5 py-3 items-center text-xs transition-colors ${
                isHighlighted ? 'bg-[#00d4ff]/5' : 'hover:bg-[rgba(255,255,255,0.02)]'
              }`}
            >
              {/* Title + category + rank */}
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[9px] font-mono text-[#475569] w-5 shrink-0">#{m.rank}</span>
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: categoryColor }}
                />
                <Link
                  href={`/market/${m.marketId}`}
                  className="text-[#e2e8f0] hover:text-[#00d4ff] transition-colors truncate group"
                >
                  <span className="group-hover:underline">{m.marketTitle}</span>
                  <ExternalLink className="inline-block h-3 w-3 ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
                </Link>
              </div>

              {/* Role */}
              <div className="text-[9px] text-[#64748b] tracking-[0.1em] uppercase font-mono text-right">
                {m.role}
              </div>

              {/* Lag bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#00d4ff]/60 rounded-full"
                    style={{ width: `${Math.max(lagPct, 3)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-[#94a3b8] w-10 text-right">
                  {m.bestLagHours != null ? `${m.bestLagHours}h` : '—'}
                </span>
              </div>

              {/* Price delta */}
              <div className={`text-right font-mono ${priceUp ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
                <PriceIcon className="inline-block h-3 w-3 mr-0.5" />
                {pct(m.priceDelta)}
              </div>

              {/* Volume delta */}
              <div className="text-right font-mono text-[#94a3b8]">{pct(m.volumeDeltaPct, 0)}</div>

              {/* Correlation */}
              <div className="text-right font-mono text-[#94a3b8] w-12">
                {num(m.laggedCorrelation)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
