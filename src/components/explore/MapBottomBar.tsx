'use client';

import { Activity, DollarSign, GitBranch } from 'lucide-react';

interface MapBottomBarProps {
  nodeCount: number;
  edgeCount: number;
  totalVolume: number;
}

function formatVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

export function MapBottomBar({ nodeCount, edgeCount, totalVolume }: MapBottomBarProps) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-10 h-9 flex items-center justify-between px-5 bg-[#04040B]/60 backdrop-blur-2xl border-t border-white/[0.04]">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-[#00D4FF]" />
          <span className="text-[11px] font-mono text-[#64748B]">{nodeCount} markets</span>
        </div>
        <div className="flex items-center gap-1.5">
          <DollarSign className="h-3 w-3 text-[#10B981]" />
          <span className="text-[11px] font-mono text-[#64748B]">{formatVolume(totalVolume)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <GitBranch className="h-3 w-3 text-[#F59E0B]" />
          <span className="text-[11px] font-mono text-[#64748B]">{edgeCount} connections</span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="text-[10px] text-[#374151] font-mono">Updated 2m ago</span>
        <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
      </div>
    </div>
  );
}
