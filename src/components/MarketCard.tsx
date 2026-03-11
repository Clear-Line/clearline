"use client";

import { TrendingUp, TrendingDown, DollarSign, Users } from "lucide-react";
import { Market } from "../types/market";
import { ConfidenceBadge } from "./ConfidenceBadge";
import Link from "next/link";
import { GlowingEffect } from "./ui/glowing-effect";

interface MarketCardProps {
  market: Market;
}

const getCategoryStyle = (category: Market["category"]) => {
  switch (category) {
    case "presidential":
    case "senate":
    case "gubernatorial":
      return "text-[#00d4ff] border-[#00d4ff]/30 bg-[#00d4ff]/10";
    case "policy":
    case "economic":
      return "text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/10";
    case "crypto":
      return "text-[#a855f7] border-[#a855f7]/30 bg-[#a855f7]/10";
    case "geopolitics":
      return "text-[#ef4444] border-[#ef4444]/30 bg-[#ef4444]/10";
    case "weather":
      return "text-[#06b6d4] border-[#06b6d4]/30 bg-[#06b6d4]/10";
    case "sports":
      return "text-[#f97316] border-[#f97316]/30 bg-[#f97316]/10";
    default:
      return "text-[#64748b] border-[#64748b]/30 bg-[#64748b]/10";
  }
};

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatTraders(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

export function MarketCard({ market }: MarketCardProps) {
  const isPositive = market.change > 0;
  const isFlat = market.change === 0;
  const changePercent = (Math.abs(market.change) * 100).toFixed(1);

  return (
    <li className="min-h-[14rem] list-none">
      <div className="relative h-full rounded-2xl border border-[rgba(255,255,255,0.06)] p-[3px]">
        <GlowingEffect
          spread={40}
          glow={true}
          disabled={false}
          proximity={64}
          inactiveZone={0.01}
          borderWidth={2}
        />
        <Link
          href={`/market/${market.id}`}
          className="relative flex h-full flex-col justify-between rounded-[calc(1rem-1px)] bg-[#0d1117] p-5 transition-colors hover:bg-[#111827] overflow-hidden"
        >
          {/* Category + Title */}
          <div className="mb-4">
            <span
              className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border mb-3 ${getCategoryStyle(market.category)}`}
            >
              {market.category}
            </span>
            <h3 className="text-white font-medium text-sm leading-snug line-clamp-2">
              {market.title}
            </h3>
          </div>

          {/* Odds + 24h Change + Confidence */}
          <div className="flex items-end justify-between mt-auto">
            <div>
              <div className="text-4xl font-bold text-white tracking-tight mb-1">
                {(market.currentOdds * 100).toFixed(0)}%
              </div>
              <div
                className={`flex items-center gap-1 text-sm font-medium ${
                  isFlat ? "text-[#64748b]" : isPositive ? "text-[#10b981]" : "text-[#ef4444]"
                }`}
              >
                {isFlat ? (
                  <span className="text-[#64748b]">&mdash;</span>
                ) : isPositive ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                {isFlat ? "0.0%" : `${isPositive ? "+" : "-"}${changePercent}%`}
                <span className="text-[10px] text-[#475569] font-normal ml-0.5">24h</span>
              </div>
            </div>

            <div className="text-right">
              <ConfidenceBadge confidence={market.confidence} score={market.confidenceScore} size="sm" />
            </div>
          </div>

          {/* Bottom stats bar */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-1 text-xs text-[#64748b]">
              <DollarSign className="h-3 w-3" />
              <span>{formatVolume(market.volume24h)}</span>
              <span className="text-[10px] text-[#475569]">vol</span>
            </div>
            {market.traders !== null && (
              <div className="flex items-center gap-1 text-xs text-[#64748b]">
                <Users className="h-3 w-3" />
                <span>{formatTraders(market.traders)}</span>
              </div>
            )}
          </div>
        </Link>
      </div>
    </li>
  );
}
