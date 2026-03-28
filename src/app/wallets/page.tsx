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
      <div className="min-h-screen flex items-center justify-center py-32">
        <Loader2 className="h-5 w-5 animate-spin text-[#00d4ff]" />
        <span className="ml-2 text-sm text-[#64748b]">Loading wallets...</span>
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-white mb-2">Wallet Tracker</h1>
          <p className="text-[#94a3b8]">Track high-accuracy prediction market traders and their positions</p>
        </div>
        <div className="text-center py-16">
          <p className="text-sm text-[#94a3b8]">No wallet data available yet. The pipeline needs to run to populate wallet accuracy scores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[#00d4ff] text-xs tracking-[0.2em] uppercase font-medium mb-2">
              Wallet Intelligence
            </p>
            <h1 className="text-3xl font-semibold text-white mb-2">
              Follow the traders behind the flow
            </h1>
            <p className="max-w-2xl text-[#94a3b8]">
              Search high-accuracy wallets, inspect resolved sample sizes, and use recent activity as context before entering a market.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[#0d1117] px-4 py-3">
              <div className="text-[10px] tracking-[0.16em] uppercase text-[#64748b]">Tracked</div>
              <div className="mt-2 text-xl font-semibold text-white">{wallets.length}</div>
            </div>
            <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[#0d1117] px-4 py-3">
              <div className="text-[10px] tracking-[0.16em] uppercase text-[#64748b]">Avg Accuracy</div>
              <div className="mt-2 text-xl font-semibold text-[#10b981]">
                {Math.round(wallets.reduce((sum, wallet) => sum + wallet.accuracy, 0) / wallets.length)}%
              </div>
            </div>
            <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[#0d1117] px-4 py-3">
              <div className="text-[10px] tracking-[0.16em] uppercase text-[#64748b]">Recent Trades</div>
              <div className="mt-2 text-xl font-semibold text-[#00d4ff]">
                {wallets.reduce((sum, wallet) => sum + wallet.totalTrades, 0)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] p-4 mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#475569]" />
                <input
                  type="text"
                  placeholder="Search wallets..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-[rgba(255,255,255,0.08)] bg-[#080b12] rounded-xl text-sm text-white placeholder:text-[#475569] focus:outline-none focus:ring-2 focus:ring-[#00d4ff]/30 focus:border-[#00d4ff]/30"
                />
              </div>
            </div>

            <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] divide-y divide-[rgba(255,255,255,0.06)] max-h-[640px] overflow-y-auto">
              {filteredWallets.map((wallet) => (
                <button
                  key={wallet.fullAddress}
                  onClick={() => setSelectedWallet(wallet)}
                  className={`w-full p-4 text-left transition-colors ${
                    selectedWallet?.fullAddress === wallet.fullAddress
                      ? "bg-[#00d4ff]/10"
                      : "hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2 gap-3">
                    <div>
                      <span className="font-mono text-sm font-medium text-white">
                        {wallet.id}
                      </span>
                      {wallet.username && (
                        <span className="ml-2 text-xs text-[#64748b]">({wallet.username})</span>
                      )}
                    </div>
                    <span
                      className={`text-lg font-semibold ${
                        wallet.accuracy >= 70
                          ? "text-[#10b981]"
                          : wallet.accuracy >= 50
                            ? "text-[#f59e0b]"
                            : "text-[#94a3b8]"
                      }`}
                    >
                      {wallet.accuracy}%
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748b]">
                    <span>{wallet.totalTrades} trades</span>
                    <span className="text-[#334155]">•</span>
                    <span>{wallet.sampleSize} resolved</span>
                    {wallet.compositeScore !== null && (
                      <>
                        <span className="text-[#334155]">•</span>
                        <span>Score: {wallet.compositeScore.toFixed(2)}</span>
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedWallet && (
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] p-6">
                <div className="flex items-start justify-between mb-6 gap-4">
                  <div>
                    <h2 className="text-2xl font-semibold text-white mb-1">
                      {selectedWallet.id}
                    </h2>
                    {selectedWallet.username && (
                      <p className="text-[#94a3b8]">{selectedWallet.username}</p>
                    )}
                    <p className="text-xs text-[#475569] font-mono mt-2">{selectedWallet.fullAddress}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-[#080b12] rounded-2xl border border-[rgba(255,255,255,0.05)]">
                    <div className="flex items-center gap-2 text-[#64748b] mb-1">
                      <Target className="h-4 w-4" />
                      <span className="text-xs uppercase tracking-[0.14em]">Accuracy</span>
                    </div>
                    <div className={`text-2xl font-semibold ${selectedWallet.accuracy >= 70 ? 'text-[#10b981]' : selectedWallet.accuracy >= 50 ? 'text-[#f59e0b]' : 'text-[#94a3b8]'}`}>
                      {selectedWallet.accuracy}%
                    </div>
                  </div>
                  <div className="p-4 bg-[#080b12] rounded-2xl border border-[rgba(255,255,255,0.05)]">
                    <div className="flex items-center gap-2 text-[#64748b] mb-1">
                      <TrendingUp className="h-4 w-4" />
                      <span className="text-xs uppercase tracking-[0.14em]">Total Trades</span>
                    </div>
                    <div className="text-2xl font-semibold text-white">
                      {selectedWallet.totalTrades}
                    </div>
                  </div>
                  <div className="p-4 bg-[#080b12] rounded-2xl border border-[rgba(255,255,255,0.05)]">
                    <div className="flex items-center gap-2 text-[#64748b] mb-1">
                      <Clock className="h-4 w-4" />
                      <span className="text-xs uppercase tracking-[0.14em]">Resolved</span>
                    </div>
                    <div className="text-2xl font-semibold text-white">
                      {selectedWallet.sampleSize}
                    </div>
                  </div>
                  <div className="p-4 bg-[#080b12] rounded-2xl border border-[rgba(255,255,255,0.05)]">
                    <div className="flex items-center gap-2 text-[#64748b] mb-1">
                      <ExternalLink className="h-4 w-4" />
                      <span className="text-xs uppercase tracking-[0.14em]">Composite</span>
                    </div>
                    <div className="text-2xl font-semibold text-white">
                      {selectedWallet.compositeScore !== null ? selectedWallet.compositeScore.toFixed(2) : '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] p-6">
                <h3 className="text-lg font-semibold text-white mb-4">
                  Recent Activity
                </h3>
                {selectedWallet.recentActivity.length > 0 ? (
                  <div className="space-y-3">
                    {selectedWallet.recentActivity.map((activity, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-[rgba(255,255,255,0.05)] bg-[#080b12] p-4"
                      >
                        <div className="flex-1">
                          <div className="font-medium text-white mb-1 line-clamp-1">
                            {activity.marketTitle}
                          </div>
                          <div className="text-sm text-[#64748b]">
                            {formatDistanceToNow(new Date(activity.timestamp), {
                              addSuffix: true,
                            })}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-[#00d4ff]">
                            {activity.position}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#64748b]">No recent trade activity found.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
