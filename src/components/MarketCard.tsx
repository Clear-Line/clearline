import Link from "next/link";
import { TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import { type Market, formatVolume } from "@/src/lib/markets";

const SIGNAL_ACCENT: Record<string, string> = {
  high:   "border-l-green-500",
  medium: "border-l-yellow-400",
  low:    "border-l-red-400",
};

const SIGNAL_BADGE: Record<string, { badge: string; dot: string; label: string }> = {
  high: {
    badge: "bg-green-50 text-green-700 border-green-200",
    dot:   "bg-green-500",
    label: "High signal",
  },
  medium: {
    badge: "bg-yellow-50 text-yellow-700 border-yellow-200",
    dot:   "bg-yellow-500",
    label: "Medium signal",
  },
  low: {
    badge: "bg-red-50 text-red-600 border-red-200",
    dot:   "bg-red-500",
    label: "Low signal",
  },
};

const CATEGORY_STYLES: Record<string, string> = {
  presidential:  "bg-blue-50 text-blue-700",
  senate:        "bg-blue-50 text-blue-700",
  gubernatorial: "bg-blue-50 text-blue-700",
  policy:        "bg-blue-50 text-blue-700",
  crypto:        "bg-purple-50 text-purple-700",
  economic:      "bg-emerald-50 text-emerald-700",
  weather:       "bg-cyan-50 text-cyan-700",
  sports:        "bg-orange-50 text-orange-700",
};

interface MarketCardProps {
  market: Market;
}

export default function MarketCard({ market }: MarketCardProps) {
  const signal = SIGNAL_BADGE[market.signal];
  const isUp = market.change >= 0;

  return (
    <Link
      href={`/market/${market.id}`}
      className={`group block rounded-xl border border-gray-200 border-l-4 bg-white p-6
        transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-gray-200/80
        ${SIGNAL_ACCENT[market.signal]}`}
    >
      {/* Header: title + signal badge */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="mb-2.5 line-clamp-2 text-[15px] font-semibold leading-snug text-gray-900 transition-colors group-hover:text-blue-700">
            {market.title}
          </h3>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${CATEGORY_STYLES[market.category]}`}>
              {market.category}
            </span>
            <span className="text-gray-300" aria-hidden>·</span>
            <span className="text-xs text-gray-400">{market.updatedAt}</span>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${signal.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${signal.dot}`} />
          {signal.label}
        </span>
      </div>

      {/* Divider */}
      <div className="mb-5 border-t border-gray-100" />

      {/* Stats row */}
      <div className="flex items-end justify-between">
        <div>
          <div className="mb-1.5 text-4xl font-bold tracking-tight text-gray-900">
            {market.probability}%
          </div>
          <div className={`flex items-center gap-1.5 text-sm font-semibold ${isUp ? "text-green-600" : "text-red-500"}`}>
            {isUp
              ? <TrendingUp  className="h-4 w-4" aria-hidden />
              : <TrendingDown className="h-4 w-4" aria-hidden />
            }
            {isUp ? "+" : ""}{market.change.toFixed(1)}%
          </div>
        </div>

        <div className="text-right">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            24h Volume
          </div>
          <div className="flex items-center justify-end gap-1 text-base font-bold text-gray-900">
            <DollarSign className="h-4 w-4 text-gray-400" aria-hidden />
            {formatVolume(market.volume)}
          </div>
        </div>
      </div>
    </Link>
  );
}
