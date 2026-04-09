"use client";

import { useState, useMemo, useEffect, memo } from "react";
import {
  Loader2,
  Activity,
  TrendingUp,
  DollarSign,
  Search,
  Zap,
  ArrowRight,
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
import { Market } from "../types/market";
import { MarketCard } from "./MarketCard";

type SortOption = "highest-volume" | "biggest-movers" | "smart-money" | "highest-odds" | "lowest-odds";
const TERMINAL_MARKET_LIMIT = 500;

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function formatTime(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/New_York",
  });
}

function formatDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const Clock = memo(function Clock() {
  const [time, setTime] = useState("");

  useEffect(() => {
    setTime(formatTime());
    const timer = setInterval(() => setTime(formatTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <span className="text-[#64748b] font-mono">{time} EST</span>;
});

export function TerminalDashboard() {
  const [sortOption, setSortOption] = useState<SortOption>("highest-volume");
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const res = await fetch(`/api/markets?limit=${TERMINAL_MARKET_LIMIT}`);
        if (!res.ok) throw new Error("API error");
        const json = await res.json();
        if (json.markets && json.markets.length > 0) {
          const liveMarkets: Market[] = json.markets.map((m: Record<string, unknown>) => ({
            id: m.id as string,
            title: m.title as string,
            category: m.category as string,
            section: m.section as string,
            currentOdds: m.currentOdds as number,
            previousOdds: m.previousOdds as number,
            change: m.change as number,
            volume24h: m.volume24h as number,
            confidence: m.confidence as Market["confidence"],
            confidenceScore: (m.confidenceScore as number) ?? 0,
            traders: (m.traders as number | null) ?? null,
            lastUpdated: new Date(m.lastUpdated as string),
            liquidity: m.liquidity as number,
            spread: (m.spread as number | null) ?? null,
            signal: (m.signal as Market["signal"]) ?? "NEUTRAL",
            signalConfidence: (m.signalConfidence as number) ?? 0,
            smartBuyVolume: (m.smartBuyVolume as number) ?? 0,
            smartSellVolume: (m.smartSellVolume as number) ?? 0,
            smartWalletCount: (m.smartWalletCount as number) ?? 0,
            topSmartWallets: (m.topSmartWallets as Market["topSmartWallets"]) ?? [],
            insiderCount: (m.insiderCount as number) ?? 0,
            topInsiders: (m.topInsiders as Market["topInsiders"]) ?? [],
          }));
          setMarkets(liveMarkets);
          setIsLive(true);
        }
      } catch {
        setFetchError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchMarkets();
  }, []);

  const sortedMarkets = useMemo(() => {
    let filtered = [...markets];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((m) => m.title.toLowerCase().includes(q));
    }

    switch (sortOption) {
      case "highest-volume":
        filtered.sort((a, b) => b.volume24h - a.volume24h);
        break;
      case "biggest-movers":
        filtered.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        break;
      case "smart-money":
        filtered.sort((a, b) => {
          const aHasSignal = a.signal !== "NEUTRAL" ? 1 : 0;
          const bHasSignal = b.signal !== "NEUTRAL" ? 1 : 0;
          if (bHasSignal !== aHasSignal) return bHasSignal - aHasSignal;
          return b.insiderCount - a.insiderCount;
        });
        break;
      case "highest-odds":
        filtered.sort((a, b) => b.currentOdds - a.currentOdds);
        break;
      case "lowest-odds":
        filtered.sort((a, b) => a.currentOdds - b.currentOdds);
        break;
    }

    return filtered;
  }, [markets, sortOption, searchQuery]);

  const totalVolume = markets.reduce((sum, m) => sum + m.volume24h, 0);
  const signalCount = markets.filter((m) => m.signal !== "NEUTRAL").length;

  const tickerItems = markets
    .filter((m) => m.signal !== "NEUTRAL")
    .slice(0, 8)
    .map((m) => ({
      title: m.title.length > 40 ? `${m.title.slice(0, 40)}...` : m.title,
      signal: m.signal,
      odds: `${(m.currentOdds * 100).toFixed(0)}%`,
      wallets: m.smartWalletCount,
    }));

  return (
    <div className="min-h-screen">
      <div className="border-b border-[rgba(255,255,255,0.06)] bg-[#0a0e17]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-8 text-[11px] tracking-wide">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isLive ? "bg-[#10b981] animate-pulse" : "bg-[#f59e0b]"
                }`}
              />
              <span
                className={`font-medium uppercase ${
                  isLive ? "text-[#10b981]" : "text-[#f59e0b]"
                }`}
              >
                {isLive ? "Live" : fetchError ? "Offline" : "Connecting..."}
              </span>
            </div>
            <Clock />
            <span className="text-[#475569]">{formatDate()}</span>
          </div>
          <div className="hidden sm:flex items-center gap-5 text-[#64748b]">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-[#00d4ff]" />
              <span className="uppercase">Markets:</span>
              <span className="text-white font-medium">{markets.length}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-[#10b981]" />
              <span className="uppercase">Signals:</span>
              <span className="text-white font-medium">{signalCount}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <DollarSign className="h-3 w-3 text-[#00d4ff]" />
              <span className="uppercase">24H Vol:</span>
              <span className="text-white font-medium">{formatVolume(totalVolume)}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#0088aa] flex items-center justify-center">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">CLEARLINE TERMINAL</h1>
              <p className="text-[#00d4ff] text-xs tracking-[0.2em] uppercase font-medium">
                Smart Money Signals
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#475569]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search markets (e.g. iran, trump, tariff)..."
              className="w-full bg-[#0d1117] border border-[rgba(255,255,255,0.08)] rounded-xl pl-11 pr-24 py-3 text-sm text-white placeholder:text-[#475569] focus:outline-none focus:border-[#00d4ff]/40 focus:ring-1 focus:ring-[#00d4ff]/20 transition-colors"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] text-[#475569] tracking-wide">
              Press / to search
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-8">
          <div className="lg:col-span-12 space-y-5">
            {tickerItems.length > 0 && (
              <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-2xl overflow-hidden">
                <div className="flex items-center h-10 px-4">
                  <div className="flex items-center gap-2 pr-4 border-r border-[rgba(255,255,255,0.08)] mr-4 shrink-0">
                    <Zap className="h-3 w-3 text-[#10b981]" />
                    <span className="text-[10px] font-bold text-[#10b981] tracking-[0.15em] uppercase">Smart Money:</span>
                  </div>
                  <div className="overflow-hidden flex-1">
                    <div className="flex items-center gap-6 animate-ticker whitespace-nowrap">
                      {[...tickerItems, ...tickerItems].map((item, i) => (
                        <span key={i} className="flex items-center gap-2 text-xs">
                          {item.signal === "BUY" ? (
                            <ArrowUpCircle className="h-3 w-3 text-[#10b981]" />
                          ) : (
                            <ArrowDownCircle className="h-3 w-3 text-[#ef4444]" />
                          )}
                          <span className="text-[#94a3b8] truncate max-w-[200px]">{item.title}</span>
                          <span className="text-white font-medium">{item.odds}</span>
                          <span className={`font-bold ${item.signal === "BUY" ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                            {item.signal}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#00d4ff]" />
                <h2 className="text-[11px] font-bold text-white tracking-[0.15em] uppercase">
                  Market Dashboard
                </h2>
              </div>
              <button
                onClick={() => setShowAll(!showAll)}
                className="flex items-center gap-1 text-[10px] font-medium text-[#00d4ff] hover:text-[#00bde0] tracking-[0.1em] uppercase transition-colors"
              >
                {showAll ? "Show Less" : `View All (${sortedMarkets.length})`}
                <ArrowRight className={`h-3 w-3 transition-transform ${showAll ? "rotate-90" : ""}`} />
              </button>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {([
                { key: "highest-volume", label: "Volume" },
                { key: "biggest-movers", label: "Movers" },
                { key: "smart-money", label: "Smart Money" },
                { key: "highest-odds", label: "High Odds" },
                { key: "lowest-odds", label: "Low Odds" },
              ] as { key: SortOption; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setSortOption(key)}
                  className={`px-3 py-1 rounded-lg text-[10px] font-medium tracking-wider uppercase transition-colors ${
                    sortOption === key
                      ? "bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30"
                      : "text-[#64748b] border border-transparent hover:text-white hover:bg-[rgba(255,255,255,0.04)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-[#00d4ff]" />
                <span className="ml-2 text-sm text-[#64748b]">Loading markets...</span>
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(showAll || searchQuery.trim() ? sortedMarkets : sortedMarkets.slice(0, 6)).map((market) => (
                  <MarketCard key={market.id} market={market} />
                ))}
              </ul>
            )}

            {!loading && sortedMarkets.length === 0 && (
              <div className="text-center py-16">
                <p className="text-sm text-[#94a3b8] mb-2">
                  {fetchError ? "Unable to connect to data pipeline." : "No markets found."}
                </p>
                {fetchError && (
                  <p className="text-xs text-[#64748b]">
                    The pipeline may still be populating data. Try refreshing in a few minutes.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
