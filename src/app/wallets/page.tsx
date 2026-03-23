"use client";

import { useState, useEffect } from "react";
import { Search, TrendingUp, Clock, Target, ExternalLink, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface WalletData {
  id: string;
  fullAddress: string;
  username: string | null;
  accuracy: number;
  sampleSize: number;
  totalTrades: number;
  compositeScore: number | null;
  recentActivity: {
    marketTitle: string;
    position: string;
    timestamp: string;
  }[];
}

export default function WalletTracker() {
  const [searchQuery, setSearchQuery] = useState("");
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWallets() {
      try {
        const res = await fetch("/api/wallets");
        if (!res.ok) throw new Error("API error");
        const json = await res.json();
        if (json.wallets && json.wallets.length > 0) {
          setWallets(json.wallets);
          setSelectedWallet(json.wallets[0]);
        }
      } catch {
        // Failed to load wallets
      } finally {
        setLoading(false);
      }
    }
    fetchWallets();
  }, []);

  const filteredWallets = wallets.filter(
    (wallet) =>
      wallet.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (wallet.username && wallet.username.toLowerCase().includes(searchQuery.toLowerCase())) ||
      wallet.fullAddress.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <span className="ml-2 text-sm text-gray-500">Loading wallets...</span>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">Wallet Tracker</h1>
          <p className="text-gray-600">Track high-accuracy prediction market traders and their positions</p>
        </div>
        <div className="text-center py-16">
          <p className="text-sm text-gray-500">No wallet data available yet. The pipeline needs to run to populate wallet accuracy scores.</p>
        </div>
      </div>
    );
  }

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
                key={wallet.fullAddress}
                onClick={() => setSelectedWallet(wallet)}
                className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                  selectedWallet?.fullAddress === wallet.fullAddress
                    ? "bg-blue-50 hover:bg-blue-50"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <span className="font-mono text-sm font-medium text-gray-900">
                      {wallet.id}
                    </span>
                    {wallet.username && (
                      <span className="ml-2 text-xs text-gray-500">({wallet.username})</span>
                    )}
                  </div>
                  <span
                    className={`text-lg font-semibold ${
                      wallet.accuracy >= 70
                        ? "text-green-600"
                        : wallet.accuracy >= 50
                          ? "text-yellow-600"
                          : "text-gray-600"
                    }`}
                  >
                    {wallet.accuracy}%
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{wallet.totalTrades} trades</span>
                  <span>·</span>
                  <span>{wallet.sampleSize} resolved</span>
                  {wallet.compositeScore !== null && (
                    <>
                      <span>·</span>
                      <span>Score: {wallet.compositeScore.toFixed(2)}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Wallet Detail */}
        {selectedWallet && (
          <div className="lg:col-span-2 space-y-6">
            {/* Wallet Overview */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-1">
                    {selectedWallet.id}
                  </h2>
                  {selectedWallet.username && (
                    <p className="text-gray-600">{selectedWallet.username}</p>
                  )}
                  <p className="text-xs text-gray-400 font-mono mt-1">{selectedWallet.fullAddress}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <Target className="h-4 w-4" />
                    <span className="text-xs">Accuracy</span>
                  </div>
                  <div className={`text-2xl font-semibold ${selectedWallet.accuracy >= 70 ? 'text-green-600' : selectedWallet.accuracy >= 50 ? 'text-yellow-600' : 'text-gray-600'}`}>
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
                    <span className="text-xs">Resolved Markets</span>
                  </div>
                  <div className="text-2xl font-semibold text-gray-900">
                    {selectedWallet.sampleSize}
                  </div>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <ExternalLink className="h-4 w-4" />
                    <span className="text-xs">Composite Score</span>
                  </div>
                  <div className="text-2xl font-semibold text-gray-900">
                    {selectedWallet.compositeScore !== null ? selectedWallet.compositeScore.toFixed(2) : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Recent Activity
              </h3>
              {selectedWallet.recentActivity.length > 0 ? (
                <div className="space-y-3">
                  {selectedWallet.recentActivity.map((activity, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 mb-1 line-clamp-1">
                          {activity.marketTitle}
                        </div>
                        <div className="text-sm text-gray-600">
                          {formatDistanceToNow(new Date(activity.timestamp), {
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
              ) : (
                <p className="text-sm text-gray-500">No recent trade activity found.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
