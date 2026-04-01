"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import Link from "next/link";

interface WalletRow {
  rank: number;
  address: string;
  displayName: string;
  username: string | null;
  totalPositions: number;
  activePositions: number;
  wins: number;
  losses: number;
  winRate: number;
  totalVolume: number;
  pnl: number;
  totalTrades: number;
}

type SortKey = "pnl" | "winRate" | "volume" | "trades";

export default function WalletTracker() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("pnl");
  const [page, setPage] = useState(1);
  const limit = 25;

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        sort: sortBy,
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/wallets?${params}`);
      if (!res.ok) throw new Error("API error");
      const json = await res.json();
      setWallets(json.wallets ?? []);
      setTotal(json.total ?? 0);
    } catch {
      setWallets([]);
    } finally {
      setLoading(false);
    }
  }, [page, sortBy, search]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  // Debounced search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const toggleSort = (key: SortKey) => {
    setSortBy(key);
    setPage(1);
  };

  const totalPages = Math.ceil(total / limit);

  const SortHeader = ({ label, sortKey, className = "" }: { label: string; sortKey: SortKey; className?: string }) => (
    <button
      onClick={() => toggleSort(sortKey)}
      className={`flex items-center gap-1 text-[10px] tracking-[0.14em] uppercase hover:text-white transition-colors ${
        sortBy === sortKey ? "text-[#00d4ff]" : "text-[#64748b]"
      } ${className}`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  );

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <p className="text-[#00d4ff] text-xs tracking-[0.2em] uppercase font-medium mb-2">
            Wallet Intelligence
          </p>
          <h1 className="text-3xl font-semibold text-white mb-2">
            Wallet Leaderboard
          </h1>
          <p className="text-[#94a3b8] max-w-2xl">
            Track high-accuracy prediction market traders. Click any wallet to see their positions, trades, and performance breakdown.
          </p>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#475569]" />
            <input
              type="text"
              placeholder="Search by address or username..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-[rgba(255,255,255,0.08)] bg-[#0d1117] rounded-xl text-sm text-white placeholder:text-[#475569] focus:outline-none focus:ring-2 focus:ring-[#00d4ff]/30 focus:border-[#00d4ff]/30"
            />
          </div>
        </div>

        {/* Table */}
        <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.06)]">
                  <th className="text-left px-4 py-3">
                    <span className="text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Rank</span>
                  </th>
                  <th className="text-left px-4 py-3">
                    <span className="text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Trader</span>
                  </th>
                  <th className="text-right px-4 py-3">
                    <SortHeader label="Trades" sortKey="trades" className="justify-end" />
                  </th>
                  <th className="text-right px-4 py-3">
                    <span className="text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Markets</span>
                  </th>
                  <th className="text-right px-4 py-3">
                    <span className="text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Wins</span>
                  </th>
                  <th className="text-right px-4 py-3">
                    <span className="text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Losses</span>
                  </th>
                  <th className="text-right px-4 py-3">
                    <SortHeader label="Win Rate" sortKey="winRate" className="justify-end" />
                  </th>
                  <th className="text-right px-4 py-3">
                    <SortHeader label="Volume" sortKey="volume" className="justify-end" />
                  </th>
                  <th className="text-right px-4 py-3">
                    <SortHeader label="PnL" sortKey="pnl" className="justify-end" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-[#00d4ff]" />
                        <span className="text-sm text-[#64748b]">Loading wallets...</span>
                      </div>
                    </td>
                  </tr>
                ) : wallets.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="text-center py-16">
                      <p className="text-sm text-[#64748b]">
                        {search ? "No wallets match your search." : "No wallet data available yet."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  wallets.map((w) => (
                    <Link
                      key={w.address}
                      href={`/wallets/${w.address}`}
                      className="contents"
                    >
                      <tr className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(0,212,255,0.04)] transition-colors cursor-pointer group">
                        <td className="px-4 py-3.5">
                          <span className="text-sm text-[#64748b] font-mono">{w.rank}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00d4ff]/20 to-[#00d4ff]/5 border border-[#00d4ff]/20 flex items-center justify-center">
                              <span className="text-xs font-semibold text-[#00d4ff]">
                                {(w.displayName[0] || "?").toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <div className="text-sm font-medium text-white group-hover:text-[#00d4ff] transition-colors">
                                {w.displayName}
                              </div>
                              {w.username && w.username !== w.displayName && (
                                <div className="text-xs text-[#475569] font-mono">
                                  {w.address.slice(0, 6)}...{w.address.slice(-4)}
                                </div>
                              )}
                              {!w.username && (
                                <div className="text-xs text-[#475569] font-mono">
                                  {w.address.slice(0, 10)}...
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="text-sm text-white">{w.totalTrades}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="text-sm text-white">{w.totalPositions}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="text-sm text-[#10b981]">{w.wins}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="text-sm text-[#ef4444]">{w.losses}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <WinRateBadge rate={w.winRate} />
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <span className="text-sm text-white font-mono">
                            ${w.totalVolume.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <PnlCell value={w.pnl} />
                        </td>
                      </tr>
                    </Link>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[rgba(255,255,255,0.06)]">
              <span className="text-xs text-[#64748b]">
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="p-1.5 rounded-lg border border-[rgba(255,255,255,0.08)] text-[#64748b] hover:text-white hover:border-[rgba(255,255,255,0.15)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-[#94a3b8] min-w-[60px] text-center">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="p-1.5 rounded-lg border border-[rgba(255,255,255,0.08)] text-[#64748b] hover:text-white hover:border-[rgba(255,255,255,0.15)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WinRateBadge({ rate }: { rate: number }) {
  const color = rate >= 70 ? "text-[#10b981]" : rate >= 50 ? "text-[#f59e0b]" : "text-[#ef4444]";
  const bg = rate >= 70 ? "bg-[#10b981]/10" : rate >= 50 ? "bg-[#f59e0b]/10" : "bg-[#ef4444]/10";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${color} ${bg}`}>
      {rate}%
    </span>
  );
}

function PnlCell({ value }: { value: number }) {
  if (value === 0) return <span className="text-sm text-[#64748b] font-mono">$0</span>;
  const isPositive = value > 0;
  return (
    <div className="flex items-center justify-end gap-1">
      {isPositive ? (
        <TrendingUp className="h-3.5 w-3.5 text-[#10b981]" />
      ) : (
        <TrendingDown className="h-3.5 w-3.5 text-[#ef4444]" />
      )}
      <span className={`text-sm font-semibold font-mono ${isPositive ? "text-[#10b981]" : "text-[#ef4444]"}`}>
        {isPositive ? "+" : ""}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
      </span>
    </div>
  );
}
