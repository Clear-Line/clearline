"use client";

import { useState } from "react";
import { Search, TrendingUp, Clock, Target, ExternalLink } from "lucide-react";
import { mockWallets } from "../../data/mockData";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatDistanceToNow } from "date-fns";

export default function WalletTracker() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWallet, setSelectedWallet] = useState(mockWallets[0]);

  const filteredWallets = mockWallets.filter(
    (wallet) =>
      wallet.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wallet.specialization.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Wallet Tracker
        </h1>
        <p className="text-gray-600">
          Track high-accuracy prediction market traders and their positions
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Wallet List */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search wallets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-200 max-h-[600px] overflow-y-auto">
            {filteredWallets.map((wallet) => (
              <button
                key={wallet.id}
                onClick={() => setSelectedWallet(wallet)}
                className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                  selectedWallet.id === wallet.id
                    ? "bg-blue-50 hover:bg-blue-50"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="font-mono text-sm font-medium text-gray-900">
                    {wallet.id}
                  </span>
                  <span
                    className={`text-lg font-semibold ${
                      wallet.accuracy >= 70
                        ? "text-green-600"
                        : "text-yellow-600"
                    }`}
                  >
                    {wallet.accuracy}%
                  </span>
                </div>
                <div className="text-xs text-gray-600 mb-1">
                  {wallet.specialization}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{wallet.totalTrades} trades</span>
                  <span>·</span>
                  <span>{wallet.avgLeadTime}h lead time</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Wallet Detail */}
        <div className="lg:col-span-2 space-y-6">
          {/* Wallet Overview */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                  {selectedWallet.id}
                </h2>
                <p className="text-gray-600">{selectedWallet.specialization}</p>
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
                Follow Wallet
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 text-gray-600 mb-1">
                  <Target className="h-4 w-4" />
                  <span className="text-xs">Accuracy</span>
                </div>
                <div className="text-2xl font-semibold text-green-600">
                  {selectedWallet.accuracy}%
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 text-gray-600 mb-1">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-xs">Total Trades</span>
                </div>
                <div className="text-2xl font-semibold text-gray-900">
                  {selectedWallet.totalTrades}
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 text-gray-600 mb-1">
                  <Clock className="h-4 w-4" />
                  <span className="text-xs">Avg Lead Time</span>
                </div>
                <div className="text-2xl font-semibold text-gray-900">
                  {selectedWallet.avgLeadTime}h
                </div>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2 text-gray-600 mb-1">
                  <ExternalLink className="h-4 w-4" />
                  <span className="text-xs">Specialization</span>
                </div>
                <div className="text-sm font-medium text-gray-900 line-clamp-2">
                  {selectedWallet.specialization}
                </div>
              </div>
            </div>
          </div>

          {/* Performance History Chart */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Performance History
            </h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={selectedWallet.performanceHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" stroke="#6b7280" fontSize={12} />
                <YAxis domain={[60, 80]} stroke="#6b7280" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="accuracy"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 4, fill: "#10b981" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Recent Activity */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Recent Activity
            </h3>
            <div className="space-y-3">
              {selectedWallet.recentActivity.map((activity, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 mb-1">
                      {activity.marketTitle}
                    </div>
                    <div className="text-sm text-gray-600">
                      {formatDistanceToNow(activity.timestamp, {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-blue-600">
                      {activity.position}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pro Features Hint */}
          <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <div className="mb-3">
              <div className="inline-flex items-center justify-center h-12 w-12 bg-blue-100 rounded-full mb-3">
                <TrendingUp className="h-6 w-6 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Get alerts for wallet activity
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Upgrade to Pro to follow wallets and receive instant
                notifications when they enter new positions
              </p>
              <button className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors">
                Upgrade to Pro
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
