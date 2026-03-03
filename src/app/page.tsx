"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Loader2,
  Activity,
  TrendingUp,
  DollarSign,
  Users,
  Search,
  Zap,
  Download,
  ArrowRight,
  Globe,
} from "lucide-react";
import { Market, mockMarkets } from "../data/mockData";
import { MarketCard } from "../components/MarketCard";
import { InteractiveGlobe } from "../components/ui/interactive-globe";

type SortOption = "highest-volume" | "biggest-movers" | "highest-odds" | "lowest-odds";

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

export default function Dashboard() {
  const [sortOption, setSortOption] = useState<SortOption>("highest-volume");
  const [markets, setMarkets] = useState<Market[]>(mockMarkets);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [currentTime, setCurrentTime] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setCurrentTime(formatTime());
    const timer = setInterval(() => setCurrentTime(formatTime()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const res = await fetch("/api/markets?limit=100");
        if (!res.ok) throw new Error("API error");
        const json = await res.json();
        if (json.markets && json.markets.length > 0) {
          const liveMarkets: Market[] = json.markets.map((m: Record<string, unknown>) => ({
            id: m.id as string,
            title: m.title as string,
            category: m.category as Market["category"],
            section: m.section as Market["section"],
            currentOdds: m.currentOdds as number,
            previousOdds: m.previousOdds as number,
            change: m.change as number,
            volume24h: m.volume24h as number,
            confidence: m.confidence as Market["confidence"],
            confidenceScore: (m.confidenceScore as number) ?? 0,
            traders: (m.traders as number | null) ?? null,
            lastUpdated: new Date(m.lastUpdated as string),
            liquidity: m.liquidity as number,
          }));
          setMarkets(liveMarkets);
          setIsLive(true);
        }
      } catch {
        // Keep mock data on failure
      } finally {
        setLoading(false);
      }
    }
    fetchMarkets();
  }, []);

  const sortedMarkets = useMemo(() => {
    let filtered = [...markets];

    // Apply search filter
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
  const totalTraders = markets.reduce((sum, m) => sum + (m.traders ?? 0), 0);

  const tickerItems = markets
    .filter((m) => Math.abs(m.change) > 0.01)
    .slice(0, 6)
    .map((m) => ({
      category: m.category.toUpperCase(),
      odds: `${(m.currentOdds * 100).toFixed(0)}%`,
      change: m.change,
    }));

  return (
    <div className="min-h-screen">
      {/* Status Bar */}
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
                {isLive ? "Live" : "Mock"}
              </span>
            </div>
            <span className="text-[#64748b] font-mono">{currentTime} EST</span>
            <span className="text-[#475569]">{formatDate()}</span>
          </div>
          <div className="hidden sm:flex items-center gap-5 text-[#64748b]">
            <span className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-[#00d4ff]" />
              <span className="uppercase">Markets:</span>
              <span className="text-white font-medium">{markets.length}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-3 w-3 text-[#00d4ff]" />
              <span className="uppercase">Traders:</span>
              <span className="text-white font-medium">{(totalTraders / 1000).toFixed(1)}K</span>
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
        {/* Hero */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#0088aa] flex items-center justify-center">
              <Activity className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">CLEARLINE TERMINAL</h1>
              <p className="text-[#00d4ff] text-xs tracking-[0.2em] uppercase font-medium">
                Prediction Market Intelligence
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-4 py-2 text-xs font-medium tracking-wide uppercase text-[#94a3b8] border border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)] hover:text-white rounded-lg transition-colors">
              <Download className="h-3.5 w-3.5" />
              Export Data
            </button>
            <button className="flex items-center gap-2 px-4 py-2 text-xs font-bold tracking-wide uppercase text-[#080b12] bg-[#00d4ff] hover:bg-[#00bde0] rounded-lg transition-colors">
              Upgrade Pro
            </button>
          </div>
        </div>

        {/* Search Bar */}
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

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-8">
          {/* Left: Global Market Activity */}
          <div className="lg:col-span-4 xl:col-span-3">
            <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-2xl p-6 h-full">
              <div className="flex items-center gap-2 mb-6">
                <Globe className="h-4 w-4 text-[#00d4ff]" />
                <h2 className="text-[11px] font-bold text-[#10b981] tracking-[0.15em] uppercase">
                  Global Market Activity
                </h2>
              </div>

              {/* Globe Visualization */}
              <div className="relative mx-auto mb-8 aspect-square w-full max-w-[260px]">
                <InteractiveGlobe
                  size={260}
                  className="h-full w-full rounded-full"
                  autoRotateSpeed={0.0018}
                  arcColor="rgba(0, 212, 255, 0.35)"
                  markerColor="rgba(16, 185, 129, 1)"
                />
              </div>

              <div className="border-t border-[rgba(255,255,255,0.06)] pt-5" />

              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-xl font-bold text-[#00d4ff]">150+</div>
                  <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase mt-0.5">Regions</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-[#00d4ff]">&lt;2s</div>
                  <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase mt-0.5">Latency</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-[#00d4ff]">99.9%</div>
                  <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase mt-0.5">Uptime</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Live Feed + Market Movers */}
          <div className="lg:col-span-8 xl:col-span-9 space-y-5">
            {/* Live Feed Ticker */}
            <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-2xl overflow-hidden">
              <div className="flex items-center h-10 px-4">
                <div className="flex items-center gap-2 pr-4 border-r border-[rgba(255,255,255,0.08)] mr-4 shrink-0">
                  <Zap className="h-3 w-3 text-[#f59e0b]" />
                  <span className="text-[10px] font-bold text-[#f59e0b] tracking-[0.15em] uppercase">Live Feed:</span>
                </div>
                <div className="overflow-hidden flex-1">
                  <div className="flex items-center gap-6 animate-ticker whitespace-nowrap">
                    {[...tickerItems, ...tickerItems].map((item, i) => (
                      <span key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-[#00d4ff] font-bold tracking-wider uppercase">{item.category}</span>
                        <span className="text-white font-medium">{item.odds}</span>
                        <span className={`font-medium ${item.change > 0 ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                          {item.change > 0 ? "\u25B2" : "\u25BC"}{(Math.abs(item.change) * 100).toFixed(1)}%
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Top Market Movers Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#00d4ff]" />
                <h2 className="text-[11px] font-bold text-white tracking-[0.15em] uppercase">
                  Top Market Movers
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

            {/* Market Cards Grid */}
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
                <p className="text-sm text-[#64748b]">No markets found.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
