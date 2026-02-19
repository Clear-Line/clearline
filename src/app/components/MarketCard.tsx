import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { Market } from '../data/mockData';
import { ConfidenceBadge } from './ConfidenceBadge';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

interface MarketCardProps {
  market: Market;
}

const getCategoryColor = (category: Market['category']) => {
  switch (category) {
    case 'crypto':
      return 'bg-purple-100 text-purple-700';
    case 'economic':
      return 'bg-green-100 text-green-700';
    case 'weather':
      return 'bg-cyan-100 text-cyan-700';
    case 'sports':
      return 'bg-orange-100 text-orange-700';
    default:
      return 'bg-gray-100 text-gray-700';
  }
};

export function MarketCard({ market }: MarketCardProps) {
  const isPositive = market.change > 0;
  const changePercent = (market.change * 100).toFixed(1);

  return (
    <Link
      href={`/market/${market.id}`}
      className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1">
          <h3 className="font-medium text-gray-900 mb-1 line-clamp-2">{market.title}</h3>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${getCategoryColor(market.category)}`}>
              {market.category}
            </span>
            <span>·</span>
            <span>{formatDistanceToNow(market.lastUpdated, { addSuffix: true })}</span>
          </div>
        </div>
        <ConfidenceBadge confidence={market.confidence} size="sm" />
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-semibold text-gray-900 mb-1">
            {(market.currentOdds * 100).toFixed(0)}%
          </div>
          <div className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            {isPositive ? '+' : ''}{changePercent}%
          </div>
        </div>

        <div className="text-right">
          <div className="text-xs text-gray-500 mb-1">24h Volume</div>
          <div className="flex items-center gap-1 text-sm font-medium text-gray-900">
            <DollarSign className="h-3.5 w-3.5" />
            {(market.volume24h / 1000000).toFixed(2)}M
          </div>
        </div>
      </div>
    </Link>
  );
}