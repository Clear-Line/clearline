"use client";

import { TrendingUp, TrendingDown, DollarSign, Users, ArrowUpCircle, ArrowDownCircle, MinusCircle } from "lucide-react";
import { Market } from "../types/market";
import Link from "next/link";
import { GlowingEffect } from "./ui/glowing-effect";

interface MarketCardProps {
  market: Market;
}

const getCategoryStyle = (category: string) => {
  switch (category) {
    case "politics":
      return "text-[#00d4ff] border-[#00d4ff]/30 bg-[#00d4ff]/10";
    case "economics":
      return "text-[#f59e0b] border-[#f59e0b]/30 bg-[#f59e0b]/10";
    case "crypto":
      return "text-[#a855f7] border-[#a855f7]/30 bg-[#a855f7]/10";
    case "geopolitics":
      return "text-[#ef4444] border-[#ef4444]/30 bg-[#ef4444]/10";
    default:
      return "text-[#64748b] border-[#64748b]/30 bg-[#64748b]/10";
  }
};

const getSignalStyle = (signal: string) => {
  switch (signal) {
    case 'BUY':
      return { color: 'text-[#10b981]', bg: 'bg-[#10b981]/10 border-[#10b981]/30', icon: ArrowUpCircle, label: 'BUY' };
    case 'SELL':
      return { color: 'text-[#ef4444]', bg: 'bg-[#ef4444]/10 border-[#ef4444]/30', icon: ArrowDownCircle, label: 'SELL' };
    default:
      return { color: 'text-[#64748b]', bg: 'bg-[#64748b]/10 border-[#64748b]/30', icon: MinusCircle, label: 'NEUTRAL' };
  }
};

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function MarketCard({ market }: MarketCardProps) {
  const isPositive = market.change > 0;
  const isFlat = market.change === 0;
  const changePercent = (Math.abs(market.change) * 100).toFixed(1);
  const signalInfo = getSignalStyle(market.signal);
  const SignalIcon = signalInfo.icon;

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
          {/* Category + Signal Badge */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-3">
              <span
                className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase border ${getCategoryStyle(market.category)}`}
              >
                {market.category}
              </span>
              {market.signal !== 'NEUTRAL' && (
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${signalInfo.bg} ${signalInfo.color}`}>
                  <SignalIcon className="h-3 w-3" />
                  {signalInfo.label}
                </span>
              )}
            </div>
            <h3 className="text-white font-medium text-sm leading-snug line-clamp-2">
              {market.title}
            </h3>
          </div>

          {/* Odds + 24h Change */}
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

            {/* Insider wallets info */}
            {market.insiderCount > 0 && (
              <div className="text-right">
                <div className={`text-lg font-bold ${signalInfo.color}`}>
                  {market.insiderCount}
                </div>
                <div className="text-[9px] text-[#475569] tracking-wider uppercase">
                  Insider Wallets
                </div>
                {market.signalConfidence > 0 && (
                  <div className="text-[9px] text-[#64748b] mt-0.5">
                    {Math.round(market.signalConfidence * 100)}% conf
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Bottom stats bar */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-1 text-xs text-[#64748b]">
              <DollarSign className="h-3 w-3" />
              <span>{formatVolume(market.volume24h)}</span>
              <span className="text-[10px] text-[#475569]">vol</span>
            </div>
            <div className="flex items-center gap-3">
              {market.smartBuyVolume + market.smartSellVolume > 0 && (
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-[#10b981] font-mono font-bold">{formatVolume(market.smartBuyVolume)}</span>
                  <span className="text-[#475569]">/</span>
                  <span className="text-[#ef4444] font-mono font-bold">{formatVolume(market.smartSellVolume)}</span>
                </div>
              )}
            </div>
          </div>
        </Link>
      </div>
    </li>
  );
}
