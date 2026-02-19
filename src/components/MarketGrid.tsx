"use client";

import { useState, useMemo } from "react";
import { type Market, type Category, getMarketTab } from "@/src/lib/markets";
import MarketCard from "./MarketCard";

type TabId  = "all" | "political" | "other";
type SortId = "biggest-movers" | "highest-volume" | "lowest-confidence";

const TABS: { id: TabId; label: string; filter: (m: Market) => boolean }[] = [
  { id: "all",       label: "All Markets",              filter: () => true },
  { id: "political", label: "Political",                filter: (m) => getMarketTab(m.category) === "political" },
  { id: "other",     label: "Crypto, Economics & More", filter: (m) => getMarketTab(m.category) === "other" },
];

const CATEGORIES: { id: "all" | Category; label: string }[] = [
  { id: "all",           label: "All" },
  { id: "presidential",  label: "Presidential" },
  { id: "senate",        label: "Senate" },
  { id: "gubernatorial", label: "Gubernatorial" },
  { id: "policy",        label: "Policy" },
  { id: "crypto",        label: "Crypto" },
  { id: "economic",      label: "Economic" },
  { id: "weather",       label: "Weather" },
  { id: "sports",        label: "Sports" },
];

const SORT_OPTIONS: { value: SortId; label: string }[] = [
  { value: "biggest-movers",    label: "Biggest movers"   },
  { value: "highest-volume",    label: "Highest volume"   },
  { value: "lowest-confidence", label: "Lowest confidence" },
];

function applySorting(markets: Market[], sortBy: SortId): Market[] {
  const list = [...markets];
  switch (sortBy) {
    case "biggest-movers":    return list.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    case "highest-volume":    return list.sort((a, b) => b.volume - a.volume);
    case "lowest-confidence": return list.sort((a, b) => a.probability - b.probability);
  }
}

interface MarketGridProps {
  markets: Market[];
}

export default function MarketGrid({ markets }: MarketGridProps) {
  const [activeTab,      setActiveTab]      = useState<TabId>("all");
  const [activeCategory, setActiveCategory] = useState<"all" | Category>("all");
  const [sortBy,         setSortBy]         = useState<SortId>("biggest-movers");

  const tabCounts = useMemo(
    () => Object.fromEntries(TABS.map((t) => [t.id, markets.filter(t.filter).length])) as Record<TabId, number>,
    [markets],
  );

  const filtered = useMemo(() => {
    const tabFilter = TABS.find((t) => t.id === activeTab)!.filter;
    const byTab = markets.filter(tabFilter);
    const byCategory = activeCategory === "all" ? byTab : byTab.filter((m) => m.category === activeCategory);
    return applySorting(byCategory, sortBy);
  }, [markets, activeTab, activeCategory, sortBy]);

  function handleTabChange(id: TabId) {
    setActiveTab(id);
    setActiveCategory("all");
  }

  return (
    <div>
      {/* ── Tab bar ── */}
      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-max items-center gap-0 border-b border-gray-200">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`-mb-px whitespace-nowrap border-b-2 px-5 py-4 text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-800"
              }`}
            >
              {tab.label}
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${
                activeTab === tab.id
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-500"
              }`}>
                {tabCounts[tab.id]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Filter + Sort row ── */}
      <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Category chips */}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                activeCategory === cat.id
                  ? "bg-blue-600 text-white shadow-sm shadow-blue-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortId)}
          className="w-full shrink-0 rounded-lg border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-48"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* ── Grid ── */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {filtered.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="mb-3 text-3xl">🔍</div>
          <p className="text-base font-medium text-gray-600">No markets match your filters</p>
          <p className="mt-1 text-sm text-gray-400">Try selecting a different category or tab</p>
        </div>
      )}
    </div>
  );
}
