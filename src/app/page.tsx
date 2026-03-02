"use client";

import { useState, useMemo, useEffect } from "react";
import { ArrowUpDown, Loader2, Activity, TrendingUp, DollarSign } from "lucide-react";
import { Market, mockMarkets } from "../data/mockData";
import { MarketCard } from "../components/MarketCard";

type CategoryFilter = "all" | "presidential" | "senate" | "gubernatorial" | "policy" | "economic" | "geopolitics";
type SortOption = "highest-volume" | "biggest-movers" | "highest-odds" | "lowest-odds";
type SectionTab = "all" | "political" | "economics" | "geopolitics";

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export default function Dashboard() {
  const [sectionTab, setSectionTab] = useState<SectionTab>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("highest-volume");
  const [markets, setMarkets] = useState<Market[]>(mockMarkets);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);

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

  const filteredAndSortedMarkets = useMemo(() => {
    let filtered = markets;

    if (sectionTab !== "all") {
      filtered = filtered.filter((m) => m.section === sectionTab);
    }

    if (categoryFilter !== "all") {
      filtered = filtered.filter((m) => m.category === categoryFilter);
    }

    const sorted = [...filtered];
    switch (sortOption) {
      case "highest-volume":
        sorted.sort((a, b) => b.volume24h - a.volume24h);
        break;
      case "biggest-movers":
        sorted.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        break;
      case "highest-odds":
        sorted.sort((a, b) => b.currentOdds - a.currentOdds);
        break;
      case "lowest-odds":
        sorted.sort((a, b) => a.currentOdds - b.currentOdds);
        break;
    }

    return sorted;
  }, [markets, sectionTab, categoryFilter, sortOption]);

  const politicalCategories: CategoryFilter[] = [
    "presidential",
    "senate",
    "gubernatorial",
    "policy",
  ];
  const economicsCategories: CategoryFilter[] = [
    "economic",
  ];
  const geopoliticsCategories: CategoryFilter[] = [
    "geopolitics",
  ];

  const availableCategories =
    sectionTab === "political"
      ? politicalCategories
      : sectionTab === "economics"
        ? economicsCategories
        : sectionTab === "geopolitics"
          ? geopoliticsCategories
          : [...politicalCategories, ...economicsCategories, ...geopoliticsCategories];

  const politicalMarkets = markets.filter((m) => m.section === "political");
  const economicsMarkets = markets.filter((m) => m.section === "economics");
  const geopoliticsMarkets = markets.filter((m) => m.section === "geopolitics");

  const totalVolume = markets.reduce((sum, m) => sum + m.volume24h, 0);
  const highSignalCount = markets.filter((m) => m.confidence === "high").length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-8 mb-8 text-white">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex-1">
            <h1 className="text-3xl font-semibold mb-2">
              Prediction Market Intelligence
            </h1>
            <p className="text-gray-400 mb-0">
              Real-time odds, volume, and on-chain signal analysis across politics, economics, and global events.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="bg-white/10 rounded-lg px-4 py-3 min-w-[120px]">
              <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-1">
                <Activity className="h-3 w-3" />
                Markets
              </div>
              <div className="text-xl font-semibold">{markets.length}</div>
            </div>
            <div className="bg-white/10 rounded-lg px-4 py-3 min-w-[120px]">
              <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-1">
                <DollarSign className="h-3 w-3" />
                24h Volume
              </div>
              <div className="text-xl font-semibold">{formatVolume(totalVolume)}</div>
            </div>
            <div className="bg-white/10 rounded-lg px-4 py-3 min-w-[120px]">
              <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-1">
                <TrendingUp className="h-3 w-3" />
                High Signal
              </div>
              <div className="text-xl font-semibold">{highSignalCount}</div>
            </div>
            {isLive && (
              <div className="flex items-center gap-2 bg-green-500/20 rounded-lg px-4 py-3">
                <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-sm text-green-300">Live</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section Tabs + Sort in one row */}
      <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-1 border-b border-gray-200 sm:border-0">
          {([
            { tab: "all" as SectionTab, label: "All", count: markets.length },
            { tab: "political" as SectionTab, label: "Politics", count: politicalMarkets.length },
            { tab: "economics" as SectionTab, label: "Economics", count: economicsMarkets.length },
            { tab: "geopolitics" as SectionTab, label: "Global Events", count: geopoliticsMarkets.length },
          ]).map(({ tab, label, count }) => (
            <button
              key={tab}
              onClick={() => { setSectionTab(tab); setCategoryFilter("all"); }}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                sectionTab === tab
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              }`}
            >
              {label} <span className="text-xs opacity-60">({count})</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-gray-400" />
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as SortOption)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-300"
          >
            <option value="highest-volume">Highest volume</option>
            <option value="biggest-movers">Biggest movers</option>
            <option value="highest-odds">Highest odds</option>
            <option value="lowest-odds">Lowest odds</option>
          </select>
        </div>
      </div>

      {/* Subcategory filters (only show if relevant) */}
      {sectionTab === "political" && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              categoryFilter === "all"
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            All Political
          </button>
          {availableCategories.map((category) => (
            <button
              key={category}
              onClick={() => setCategoryFilter(category)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                categoryFilter === category
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {category.charAt(0).toUpperCase() + category.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Signal legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
        <span className="font-medium text-gray-700">Signal strength:</span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          High — significant move + high volume
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-yellow-500" />
          Medium — moderate activity
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-gray-400" />
          Low — minimal movement
        </span>
      </div>

      {/* Markets Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">Loading markets...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredAndSortedMarkets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}

      {!loading && filteredAndSortedMarkets.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">
            No markets found matching your filters.
          </p>
        </div>
      )}
    </div>
  );
}
