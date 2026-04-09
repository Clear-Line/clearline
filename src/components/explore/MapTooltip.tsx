'use client';

import type { HoveredNode } from './mapTypes';
import { CATEGORY_COLORS, CATEGORY_LABELS, INTERACTION } from './mapConstants';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface MapTooltipProps {
  hovered: HoveredNode | null;
}

function formatVolume(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

export function MapTooltip({ hovered }: MapTooltipProps) {
  if (!hovered) return null;

  const { node, screenX, screenY } = hovered;

  // Clamp to viewport
  const tooltipW = 220;
  const tooltipH = 180;
  let x = screenX + INTERACTION.tooltipOffsetX;
  let y = screenY + INTERACTION.tooltipOffsetY;
  if (x + tooltipW > window.innerWidth - 8) x = screenX - tooltipW - INTERACTION.tooltipOffsetX;
  if (y + tooltipH > window.innerHeight - 8) y = screenY - tooltipH - INTERACTION.tooltipOffsetY;

  const changePositive = node.change24h >= 0;

  return (
    <div
      className="fixed z-30 pointer-events-none w-[220px] bg-[#0D1117] border border-white/[0.08] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] p-3.5 transition-opacity duration-[120ms]"
      style={{ left: x, top: y }}
    >
      {/* Category */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-[5px] h-[5px] rounded-full"
          style={{ backgroundColor: CATEGORY_COLORS[node.category] }}
        />
        <span className="text-[8px] tracking-[0.16em] uppercase text-[#475569]">
          {CATEGORY_LABELS[node.category]}
        </span>
      </div>

      {/* Title */}
      <p className="text-[13px] font-medium text-white leading-snug mt-1.5 line-clamp-2">
        {node.fullLabel}
      </p>

      {/* Probability + change */}
      <div className="flex items-baseline gap-2 mt-1.5">
        <span className="text-[22px] font-semibold text-white font-mono">
          {Math.round(node.probability * 100)}%
        </span>
        <span
          className={`text-[11px] font-medium font-mono flex items-center gap-0.5 ${
            changePositive ? 'text-[#10B981]' : 'text-[#EF4444]'
          }`}
        >
          {changePositive ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {changePositive ? '+' : ''}{(node.change24h * 100).toFixed(1)}%
        </span>
      </div>

      {/* Divider + stats */}
      <div className="border-t border-white/[0.04] mt-2.5 pt-2.5 flex justify-between">
        <span className="text-[10px] font-mono text-[#475569]">
          Vol {formatVolume(node.totalVolume)}
        </span>
        <span className="text-[10px] font-mono text-[#475569]">
          {node.insiderCount} insiders
        </span>
      </div>
    </div>
  );
}
