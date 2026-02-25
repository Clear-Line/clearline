"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Users,
  DollarSign,
  TrendingUp,
  ExternalLink,
} from "lucide-react";
import { mockMarkets, mockMarketMove } from "../../../data/mockData";
import { ConfidenceBadge } from "../../../components/ConfidenceBadge";
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

export default function MarketDetail() {
  const params = useParams();
  const id = params.id as string;
  const market = mockMarkets.find((m) => m.id === id);

  if (!market) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center">
          <p className="text-gray-500">Market not found</p>
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
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-900">{mockMarketMove.summary}</p>
            </div>
          </div>

          <div className="lg:text-right">
            <div className="text-sm text-gray-500 mb-2">Current Odds</div>
            <div className="text-5xl font-semibold text-gray-900 mb-2">
              {(market.currentOdds * 100).toFixed(0)}%
            </div>
            <div
              className={`inline-flex items-center gap-1 text-lg font-medium ${
                market.change > 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              <TrendingUp className="h-5 w-5" />
              {market.change > 0 ? "+" : ""}
              {(market.change * 100).toFixed(1)}% today
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-gray-200">
          <div>
            <div className="text-sm text-gray-500 mb-1">Total Volume</div>
            <div className="text-xl font-semibold text-gray-900">
              ${(mockMarketMove.volumeProfile.totalVolume / 1000).toFixed(0)}K
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-1">Unique Wallets</div>
            <div className="text-xl font-semibold text-gray-900">
              {mockMarketMove.volumeProfile.uniqueWallets}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-1">Top Wallet Share</div>
            <div className="text-xl font-semibold text-gray-900">
              {(
                mockMarketMove.volumeProfile.topWalletConcentration * 100
              ).toFixed(0)}
              %
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500 mb-1">Liquidity</div>
            <div className="text-xl font-semibold text-gray-900">
              ${(market.liquidity / 1000000).toFixed(1)}M
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Odds Movement
          </h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={mockMarketMove.chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "white",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                }}
              />
              <Line
                type="monotone"
                dataKey="odds"
                stroke="#2563eb"
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Trading Volume
          </h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={mockMarketMove.chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="time" stroke="#6b7280" fontSize={12} />
              <YAxis stroke="#6b7280" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "white",
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                }}
              />
              <Bar dataKey="volume" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Wallet Breakdown */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5 text-gray-600" />
          <h2 className="text-lg font-semibold text-gray-900">
            Wallet Breakdown
          </h2>
        </div>
        <div className="space-y-3">
          {mockMarketMove.walletBreakdown.map((wallet, index) => (
            <div key={index} className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-gray-900">
                      {wallet.walletId}
                    </span>
                    {index < 3 && (
                      <Link
                        href="/wallets"
                        className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                      >
                        View profile
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-600">
                      Accuracy:{" "}
                      <span className="font-medium text-gray-900">
                        {wallet.accuracy}%
                      </span>
                    </span>
                    <span className="text-gray-600">
                      Specialization:{" "}
                      <span className="font-medium text-gray-900">
                        {wallet.specialization}
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

      {/* External Catalysts */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          External Catalysts
        </h2>
        <div className="space-y-3">
          {mockMarketMove.externalCatalysts.map((catalyst, index) => (
            <div key={index} className="flex gap-4 p-3 bg-gray-50 rounded-lg">
              <div className="flex-shrink-0">
                <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900">
                    {catalyst.type}
                  </span>
                  <span className="text-xs text-gray-500">
                    {catalyst.timestamp.toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-sm text-gray-700">{catalyst.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Correlated Markets */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Correlated Market Movements
        </h2>
        <div className="space-y-3">
          {mockMarketMove.correlatedMarkets.map((correlated) => (
            <Link
              key={correlated.marketId}
              href={`/market/${correlated.marketId}`}
              className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all"
            >
              <span className="text-sm font-medium text-gray-900">
                {correlated.title}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Correlation:</span>
                <span className="text-sm font-semibold text-blue-600">
                  {(correlated.correlation * 100).toFixed(0)}%
                </span>
              </div>
            </Link>
          ))}
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
