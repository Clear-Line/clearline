"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Users,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { ConfidenceBadge } from "../../../components/ConfidenceBadge";
import { ConfidenceLevel } from "../../../data/mockData";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface MarketDetail {
  id: string;
  title: string;
  category: string;
  section: string;
  currentOdds: number;
  previousOdds: number;
  change: number;
  volume24h: number;
  totalVolume: number;
  liquidity: number;
  confidence: ConfidenceLevel;
  lastUpdated: string;
  startDate: string | null;
  endDate: string | null;
  outcomes: string[];
  chartData: { time: string; odds: number; volume: number }[];
  volumeProfile: {
    totalVolume: number;
    uniqueWallets: number;
    topWalletConcentration: number;
  };
  walletBreakdown: {
    walletId: string;
    fullAddress: string;
    percentage: number;
    accuracy: number | null;
    tradeCount: number;
    totalMarkets: number | null;
  }[];
  catalysts: {
    type: string;
    description: string;
    timestamp: string;
  }[];
  flaggedMoves: {
    summary: string;
    confidence: number;
    direction: string;
    priceDelta: number;
    timestamp: string;
  }[];
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export default function MarketDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [market, setMarket] = useState<MarketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMarket() {
      try {
        const res = await fetch(`/api/markets/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Market not found");
          } else {
            setError("Failed to load market data");
          }
          return;
        }
        const data = await res.json();
        setMarket(data);
      } catch {
        setError("Failed to load market data");
      } finally {
        setLoading(false);
      }
    }
    fetchMarket();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">Loading market...</span>
        </div>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-20">
          <p className="text-gray-500">{error || "Market not found"}</p>
          <Link
            href="/"
            className="text-blue-600 hover:underline mt-2 inline-block"
          >
            Return to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const isPositive = market.change > 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back Button */}
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to markets
      </Link>

      {/* Market Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-6">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-1 bg-gray-100 rounded-full text-xs font-medium uppercase text-gray-600">
                {market.category}
              </span>
              <ConfidenceBadge confidence={market.confidence} size="md" />
            </div>
            <h1 className="text-3xl font-semibold text-gray-900 mb-4">
              {market.title}
            </h1>
            {market.flaggedMoves.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-900">
                  {market.flaggedMoves[0].summary}
                </p>
              </div>
            )}
          </div>

          <div className="lg:text-right">
            <div className="text-sm text-gray-500 mb-2">Current Odds</div>
            <div className="text-5xl font-semibold text-gray-900 mb-2">
              {(market.currentOdds * 100).toFixed(0)}%
            </div>
            <div
              className={`inline-flex items-center gap-1 text-lg font-medium ${
                isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {isPositive ? (
                <TrendingUp className="h-5 w-5" />
              ) : (
                <TrendingDown className="h-5 w-5" />
              )}
              {isPositive ? "+" : ""}
              {(market.change * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-gray-200">
          <div>
            <div className="text-sm text-gray-500 mb-1">24h Volume</div>
            <div className="text-xl font-semibold text-gray-900">
              {formatVolume(market.volume24h)}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-1">Total Volume</div>
            <div className="text-xl font-semibold text-gray-900">
              {formatVolume(market.volumeProfile.totalVolume)}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-1">Unique Wallets</div>
            <div className="text-xl font-semibold text-gray-900">
              {market.volumeProfile.uniqueWallets}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-1">Liquidity</div>
            <div className="text-xl font-semibold text-gray-900">
              {formatVolume(market.liquidity)}
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      {market.chartData.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Odds Movement
            </h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={market.chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`${value}%`, "Odds"]}
                />
                <Line
                  type="monotone"
                  dataKey="odds"
                  stroke="#2563eb"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Volume Over Time
            </h2>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={market.chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
                <YAxis stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [formatVolume(value), "Volume"]}
                />
                <Bar dataKey="volume" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {market.chartData.length <= 1 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6 text-center">
          <p className="text-gray-500 text-sm">
            Chart data will appear as more snapshots are collected over time.
          </p>
        </div>
      )}

      {/* Wallet Breakdown */}
      {market.walletBreakdown.length > 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Top Wallets by Volume
            </h2>
          </div>
          <div className="space-y-3">
            {market.walletBreakdown.map((wallet, index) => (
              <div key={index} className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-gray-900">
                        {wallet.walletId}
                      </span>
                      <Link
                        href="/wallets"
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                      >
                        View profile
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      {wallet.accuracy !== null && (
                        <span className="text-gray-600">
                          Accuracy:{" "}
                          <span className="font-medium text-gray-900">
                            {wallet.accuracy}%
                          </span>
                        </span>
                      )}
                      <span className="text-gray-600">
                        Trades:{" "}
                        <span className="font-medium text-gray-900">
                          {wallet.tradeCount}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full"
                        style={{ width: `${wallet.percentage}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-gray-900 w-12 text-right">
                      {wallet.percentage}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Users className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Wallet Breakdown
            </h2>
          </div>
          <p className="text-gray-500 text-sm">
            No trade data collected for this market yet. Wallet breakdown will appear once trades are recorded.
          </p>
        </div>
      )}

      {/* Flagged Moves / Catalysts */}
      {market.catalysts.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Detected Catalysts
          </h2>
          <div className="space-y-3">
            {market.catalysts.map((catalyst, index) => (
              <div
                key={index}
                className="flex gap-4 p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex-shrink-0">
                  <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <AlertTriangle className="h-5 w-5 text-blue-600" />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900">
                      {catalyst.type}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(catalyst.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">
                    {catalyst.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flagged Moves Summary */}
      {market.flaggedMoves.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-gray-900">
              Flagged Moves
            </h2>
          </div>
          <div className="space-y-3">
            {market.flaggedMoves.map((move, index) => (
              <div
                key={index}
                className="p-4 border border-gray-200 rounded-lg"
              >
                <div className="flex items-center justify-between mb-2">
                  <span
                    className={`text-sm font-medium ${
                      move.direction === "BUY"
                        ? "text-green-600"
                        : "text-red-600"
                    }`}
                  >
                    {move.direction === "BUY" ? "Bullish" : "Bearish"} Signal
                  </span>
                  <span className="text-xs text-gray-500">
                    Confidence: {move.confidence}/100
                  </span>
                </div>
                <p className="text-sm text-gray-700">{move.summary}</p>
                <div className="mt-2 text-xs text-gray-500">
                  Price delta: {(move.priceDelta * 100).toFixed(1)}% |{" "}
                  {new Date(move.timestamp).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Market Info */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Market Info
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Category:</span>{" "}
            <span className="font-medium text-gray-900 capitalize">
              {market.category}
            </span>
          </div>
          <div>
            <span className="text-gray-500">Last Updated:</span>{" "}
            <span className="font-medium text-gray-900">
              {new Date(market.lastUpdated).toLocaleString()}
            </span>
          </div>
          {market.endDate && (
            <div>
              <span className="text-gray-500">End Date:</span>{" "}
              <span className="font-medium text-gray-900">
                {new Date(market.endDate).toLocaleDateString()}
              </span>
            </div>
          )}
          <div>
            <span className="text-gray-500">Top Wallet Concentration:</span>{" "}
            <span className="font-medium text-gray-900">
              {(market.volumeProfile.topWalletConcentration * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      {/* Pro Tier CTA */}
      <div className="mt-8 bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg p-6 text-white">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold mb-2">
              Get deeper insights with Clearline Pro
            </h3>
            <p className="text-blue-100">
              Access full wallet tracking, custom alerts, and historical
              accuracy data
            </p>
          </div>
          <button className="px-6 py-3 bg-white text-blue-600 font-medium rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap">
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}
