'use client';

import { useState, useMemo } from 'react';
import { Filter, ArrowUpDown } from 'lucide-react';
import { mockMarkets } from './data/mockData';
import { MarketCard } from './components/MarketCard';

type CategoryFilter = 'all' | 'presidential' | 'senate' | 'gubernatorial' | 'policy' | 'crypto' | 'economic' | 'weather' | 'sports';
type SortOption = 'biggest-movers' | 'highest-volume' | 'lowest-confidence';
type SectionTab = 'all' | 'political' | 'other';

export default function Dashboard() {
  const [sectionTab, setSectionTab] = useState<SectionTab>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('biggest-movers');

  const filteredAndSortedMarkets = useMemo(() => {
    let filtered = mockMarkets;

    if (sectionTab !== 'all') {
      filtered = filtered.filter((m) => m.section === sectionTab);
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter((m) => m.category === categoryFilter);
    }

    const sorted = [...filtered];
    switch (sortOption) {
      case 'biggest-movers':
        sorted.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
        break;
      case 'highest-volume':
        sorted.sort((a, b) => b.volume24h - a.volume24h);
        break;
      case 'lowest-confidence':
        const confidenceScore = { low: 0, medium: 1, high: 2 };
        sorted.sort((a, b) => confidenceScore[a.confidence] - confidenceScore[b.confidence]);
        break;
    }

    return sorted;
  }, [sectionTab, categoryFilter, sortOption]);

  const politicalCategories: CategoryFilter[] = ['presidential', 'senate', 'gubernatorial', 'policy'];
  const otherCategories: CategoryFilter[] = ['crypto', 'economic', 'weather', 'sports'];

  const availableCategories = sectionTab === 'political'
    ? politicalCategories
    : sectionTab === 'other'
    ? otherCategories
    : [...politicalCategories, ...otherCategories];

  const politicalMarkets = mockMarkets.filter(m => m.section === 'political');
  const otherMarkets = mockMarkets.filter(m => m.section === 'other');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-8 mb-8 text-white">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold mb-3">
            The intelligence layer for prediction markets
          </h1>
          <p className="text-lg text-blue-100 mb-6">
            Decoding whether odds movements reflect real signal or just noise — across politics, crypto, economics, weather, and more. Every market move gets a confidence rating backed by on-chain behavioral analysis.
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 bg-white/20 rounded-lg px-4 py-2">
              <span className="text-2xl font-semibold">{mockMarkets.length}</span>
              <span className="text-sm text-blue-100">Active Markets</span>
            </div>
            <div className="flex items-center gap-2 bg-white/20 rounded-lg px-4 py-2">
              <span className="text-2xl font-semibold">
                {mockMarkets.filter((m) => m.confidence === 'high').length}
              </span>
              <span className="text-sm text-blue-100">High Confidence Today</span>
            </div>
            <div className="flex items-center gap-2 bg-white/20 rounded-lg px-4 py-2">
              <span className="text-2xl font-semibold">92%</span>
              <span className="text-sm text-blue-100">Signal Accuracy</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section Tabs */}
      <div className="mb-6">
        <div className="flex items-center gap-2 border-b border-gray-200">
          <button
            onClick={() => {
              setSectionTab('all');
              setCategoryFilter('all');
            }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              sectionTab === 'all'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            All Markets ({mockMarkets.length})
          </button>
          <button
            onClick={() => {
              setSectionTab('political');
              setCategoryFilter('all');
            }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              sectionTab === 'political'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Political ({politicalMarkets.length})
          </button>
          <button
            onClick={() => {
              setSectionTab('other');
              setCategoryFilter('all');
            }}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              sectionTab === 'other'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Crypto, Economics & More ({otherMarkets.length})
          </button>
        </div>
      </div>

      {/* Filters and Sorting */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Filter className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Filter by category</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setCategoryFilter('all')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                categoryFilter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              All
            </button>
            {availableCategories.map((category) => (
              <button
                key={category}
                onClick={() => setCategoryFilter(category)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                  categoryFilter === category
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="sm:w-64">
          <div className="flex items-center gap-2 mb-2">
            <ArrowUpDown className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">Sort by</span>
          </div>
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as SortOption)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="biggest-movers">Biggest movers</option>
            <option value="highest-volume">Highest volume</option>
            <option value="lowest-confidence">Lowest confidence</option>
          </select>
        </div>
      </div>

      {/* Markets Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredAndSortedMarkets.map((market) => (
          <MarketCard key={market.id} market={market} />
        ))}
      </div>

      {filteredAndSortedMarkets.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500">No markets found matching your filters.</p>
        </div>
      )}
    </div>
  );
}
