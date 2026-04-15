"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Target, TrendingUp, TrendingDown,
  DollarSign, BarChart3, Clock, ExternalLink, Copy, Check,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface WalletProfile {
  address: string;
  displayName: string;
  username: string | null;
  winRate: number;
  totalTrades: number;
  totalVolume: number;
  totalMarkets: number;
  pnl: number;
  credibilityScore: number | null;
  firstSeen: string | null;
  sampleSize: number;
}

interface ActivePosition {
  marketId: string;
  title: string;
  category: string;
  endDate: string | null;
  side: string;
  invested: number;
  currentPrice: number;
  avgPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  trades: number;
}

interface ResolvedPosition {
  marketId: string;
  title: string;
  category: string;
  side: string;
  invested: number;
  pnl: number;
  result: "WIN" | "LOSS";
  resolution: string;
}

interface CategoryPerf {
  category: string;
  pnl: number;
}

interface Trade {
  marketId: string;
  title: string;
  category: string;
  side: string;
  outcome: string;
  price: number;
  sizeUsdc: number;
  timestamp: string;
  txHash: string;
}

type Tab = "overview" | "positions" | "trades";

export default function WalletDetailPage() {
  const params = useParams();
  const router = useRouter();
  const address = params.address as string;

  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<WalletProfile | null>(null);
  const [activePositions, setActivePositions] = useState<ActivePosition[]>([]);
  const [resolvedPositions, setResolvedPositions] = useState<ResolvedPosition[]>([]);
  const [categoryPerformance, setCategoryPerformance] = useState<CategoryPerf[]>([]);
  const [tradeHistory, setTradeHistory] = useState<Trade[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    async function fetchWallet() {
      try {
        const res = await fetch(`/api/wallets/${address}`);
        if (!res.ok) throw new Error("Not found");
        const json = await res.json();
        setWallet(json.wallet);
        setActivePositions(json.activePositions ?? []);
        setResolvedPositions(json.resolvedPositions ?? []);
        setCategoryPerformance(json.categoryPerformance ?? []);
        setTradeHistory(json.tradeHistory ?? []);
      } catch {
        setWallet(null);
      } finally {
        setLoading(false);
      }
    }
    fetchWallet();
  }, [address]);

  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[#00d4ff]" />
        <span className="ml-2 text-sm text-[#64748b]">Loading wallet...</span>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-[#64748b] hover:text-white mb-8 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <p className="text-[#94a3b8]">Wallet not found.</p>
      </div>
    );
  }

  const wins = resolvedPositions.filter((p) => p.result === "WIN").length;
  const losses = resolvedPositions.filter((p) => p.result === "LOSS").length;

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back */}
        <Link href="/explore" className="inline-flex items-center gap-2 text-sm text-[#64748b] hover:text-white mb-6 transition-colors">
          <ArrowLeft className="h-4 w-4" /> Back to Explore
        </Link>

        {/* Profile header */}
        <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] p-6 mb-6">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#00d4ff]/20 to-[#00d4ff]/5 border border-[#00d4ff]/20 flex items-center justify-center">
                <span className="text-xl font-bold text-[#00d4ff]">
                  {(wallet.displayName[0] || "?").toUpperCase()}
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white">{wallet.displayName}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-[#475569] font-mono">{address}</span>
                  <button onClick={copyAddress} className="text-[#475569] hover:text-[#00d4ff] transition-colors">
                    {copied ? <Check className="h-3.5 w-3.5 text-[#10b981]" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {wallet.firstSeen && (
                  <p className="text-xs text-[#475569] mt-1">
                    First seen {formatDistanceToNow(new Date(wallet.firstSeen), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>
            <a
              href={`https://polymarket.com/profile/${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 text-sm border border-[rgba(255,255,255,0.1)] rounded-xl text-[#94a3b8] hover:text-white hover:border-[rgba(255,255,255,0.2)] transition-colors"
            >
              <ExternalLink className="h-4 w-4" /> View on Polymarket
            </a>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard icon={<Target className="h-4 w-4" />} label="Win Rate" value={`${wallet.winRate}%`}
              color={wallet.winRate >= 70 ? "text-[#10b981]" : wallet.winRate >= 50 ? "text-[#f59e0b]" : "text-[#ef4444]"} />
            <StatCard icon={<DollarSign className="h-4 w-4" />} label="Overall PnL"
              value={`${wallet.pnl >= 0 ? "+" : ""}$${Math.abs(wallet.pnl).toLocaleString()}`}
              color={wallet.pnl >= 0 ? "text-[#10b981]" : "text-[#ef4444]"} />
            <StatCard icon={<BarChart3 className="h-4 w-4" />} label="Volume" value={`$${wallet.totalVolume.toLocaleString()}`} />
            <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Markets" value={String(wallet.totalMarkets)} />
            <StatCard label="Wins" value={String(wins)} color="text-[#10b981]" />
            <StatCard label="Losses" value={String(losses)} color="text-[#ef4444]" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-[rgba(255,255,255,0.06)]">
          {(["overview", "positions", "trades"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                tab === t
                  ? "text-[#00d4ff] border-[#00d4ff]"
                  : "text-[#64748b] border-transparent hover:text-white"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "overview" && (
          <OverviewTab
            activePositions={activePositions}
            resolvedPositions={resolvedPositions}
            categoryPerformance={categoryPerformance}
          />
        )}
        {tab === "positions" && (
          <PositionsTab active={activePositions} resolved={resolvedPositions} />
        )}
        {tab === "trades" && <TradesTab trades={tradeHistory} />}
      </div>
    </div>
  );
}

/* ─── Stat Card ─── */
function StatCard({ icon, label, value, color = "text-white" }: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="p-3 bg-[#080b12] rounded-xl border border-[rgba(255,255,255,0.05)]">
      <div className="flex items-center gap-1.5 text-[#64748b] mb-1">
        {icon}
        <span className="text-[10px] tracking-[0.14em] uppercase">{label}</span>
      </div>
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}

/* ─── Overview Tab ─── */
function OverviewTab({
  activePositions,
  resolvedPositions,
  categoryPerformance,
}: {
  activePositions: ActivePosition[];
  resolvedPositions: ResolvedPosition[];
  categoryPerformance: CategoryPerf[];
}) {
  const biggestWins = resolvedPositions.filter((p) => p.pnl > 0).slice(0, 5);
  const biggestLosses = [...resolvedPositions].filter((p) => p.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Current Positions */}
      <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] p-5">
        <h3 className="text-sm font-semibold text-white mb-1">Current Positions</h3>
        <p className="text-xs text-[#475569] mb-4">Active positions by value</p>
        {activePositions.length === 0 ? (
          <p className="text-sm text-[#475569] py-4">No active positions</p>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {activePositions.slice(0, 10).map((p, i) => (
              <Link key={p.marketId} href={`/market/${p.marketId}`}
                className="block p-3 rounded-xl bg-[#080b12] border border-[rgba(255,255,255,0.05)] hover:border-[rgba(0,212,255,0.2)] transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-xs text-[#64748b]">#{i + 1}</span>
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                    p.side === "BUY" ? "bg-[#10b981]/10 text-[#10b981]" : "bg-[#ef4444]/10 text-[#ef4444]"
                  }`}>
                    {p.side}
                  </span>
                </div>
                <p className="text-sm text-white line-clamp-2 mb-2">{p.title}</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#64748b]">${p.invested.toLocaleString()} invested</span>
                  <span className={p.unrealizedPnl >= 0 ? "text-[#10b981]" : "text-[#ef4444]"}>
                    {p.unrealizedPnl >= 0 ? "+" : ""}${p.unrealizedPnl.toLocaleString()}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Market Performance */}
      <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] p-5">
        <h3 className="text-sm font-semibold text-white mb-1">Market Performance</h3>
        <p className="text-xs text-[#475569] mb-4">Biggest wins and losses by market</p>

        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-3.5 w-3.5 text-[#10b981]" />
            <span className="text-xs font-medium text-[#10b981]">Biggest Wins</span>
          </div>
          {biggestWins.length === 0 ? (
            <p className="text-xs text-[#475569]">No wins yet</p>
          ) : (
            <div className="space-y-2">
              {biggestWins.map((p, i) => (
                <div key={p.marketId} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-[#475569]">#{i + 1}</span>
                    <Link href={`/market/${p.marketId}`} className="text-xs text-white truncate hover:text-[#00d4ff] transition-colors">
                      {p.title}
                    </Link>
                  </div>
                  <span className="text-xs font-semibold text-[#10b981] whitespace-nowrap">
                    +${p.pnl.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="h-3.5 w-3.5 text-[#ef4444]" />
            <span className="text-xs font-medium text-[#ef4444]">Biggest Losses</span>
          </div>
          {biggestLosses.length === 0 ? (
            <p className="text-xs text-[#475569]">No losses yet</p>
          ) : (
            <div className="space-y-2">
              {biggestLosses.map((p, i) => (
                <div key={p.marketId} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-[#475569]">#{i + 1}</span>
                    <Link href={`/market/${p.marketId}`} className="text-xs text-white truncate hover:text-[#00d4ff] transition-colors">
                      {p.title}
                    </Link>
                  </div>
                  <span className="text-xs font-semibold text-[#ef4444] whitespace-nowrap">
                    -${Math.abs(p.pnl).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category Performance */}
      <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] p-5">
        <h3 className="text-sm font-semibold text-white mb-1">Category Performance</h3>
        <p className="text-xs text-[#475569] mb-4">PnL by market category</p>
        {categoryPerformance.length === 0 ? (
          <p className="text-sm text-[#475569] py-4">No resolved positions yet</p>
        ) : (
          <div className="space-y-2.5">
            {categoryPerformance.map((c, i) => (
              <div key={c.category} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#475569]">#{i + 1}</span>
                  <span className="text-sm text-white capitalize">{c.category}</span>
                </div>
                <span className={`text-sm font-semibold ${c.pnl >= 0 ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                  {c.pnl >= 0 ? "+" : ""}${Math.abs(c.pnl).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Positions Tab ─── */
function PositionsTab({ active, resolved }: { active: ActivePosition[]; resolved: ResolvedPosition[] }) {
  const [showResolved, setShowResolved] = useState(false);

  return (
    <div>
      {/* Toggle */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setShowResolved(false)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            !showResolved ? "bg-[#00d4ff]/10 text-[#00d4ff]" : "text-[#64748b] hover:text-white"
          }`}
        >
          Active ({active.length})
        </button>
        <button
          onClick={() => setShowResolved(true)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            showResolved ? "bg-[#00d4ff]/10 text-[#00d4ff]" : "text-[#64748b] hover:text-white"
          }`}
        >
          Resolved ({resolved.length})
        </button>
      </div>

      <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
        {!showResolved ? (
          active.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#475569]">No active positions</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.06)]">
                  <th className="text-left px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Market</th>
                  <th className="text-center px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Side</th>
                  <th className="text-right px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Avg Price</th>
                  <th className="text-right px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Current</th>
                  <th className="text-right px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Invested</th>
                  <th className="text-right px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Unrealized PnL</th>
                </tr>
              </thead>
              <tbody>
                {active.map((p) => (
                  <tr key={p.marketId} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(0,212,255,0.04)] transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/market/${p.marketId}`} className="text-sm text-white hover:text-[#00d4ff] transition-colors line-clamp-1">
                        {p.title}
                      </Link>
                      <div className="text-xs text-[#475569] capitalize mt-0.5">{p.category}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        p.side === "BUY" ? "bg-[#10b981]/10 text-[#10b981]" : "bg-[#ef4444]/10 text-[#ef4444]"
                      }`}>{p.side}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white font-mono">{p.avgPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-sm text-[#00d4ff] font-mono">{p.currentPrice.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right text-sm text-white font-mono">${p.invested.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-semibold font-mono ${p.unrealizedPnl >= 0 ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                        {p.unrealizedPnl >= 0 ? "+" : ""}${Math.abs(p.unrealizedPnl).toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          resolved.length === 0 ? (
            <div className="py-12 text-center text-sm text-[#475569]">No resolved positions</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.06)]">
                  <th className="text-left px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Market</th>
                  <th className="text-center px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Side</th>
                  <th className="text-center px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Result</th>
                  <th className="text-right px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Invested</th>
                  <th className="text-right px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">PnL</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((p) => (
                  <tr key={p.marketId} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(0,212,255,0.04)] transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/market/${p.marketId}`} className="text-sm text-white hover:text-[#00d4ff] transition-colors line-clamp-1">
                        {p.title}
                      </Link>
                      <div className="text-xs text-[#475569] capitalize mt-0.5">{p.category} &middot; Resolved: {p.resolution}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        p.side === "BUY" ? "bg-[#10b981]/10 text-[#10b981]" : "bg-[#ef4444]/10 text-[#ef4444]"
                      }`}>{p.side}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        p.result === "WIN" ? "bg-[#10b981]/10 text-[#10b981]" : "bg-[#ef4444]/10 text-[#ef4444]"
                      }`}>{p.result}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-white font-mono">${p.invested.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-sm font-semibold font-mono ${p.pnl >= 0 ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                        {p.pnl >= 0 ? "+" : ""}${Math.abs(p.pnl).toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}

/* ─── Trades Tab ─── */
function TradesTab({ trades }: { trades: Trade[] }) {
  if (trades.length === 0) {
    return (
      <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] py-12 text-center text-sm text-[#475569]">
        No recent trades found
      </div>
    );
  }

  return (
    <div className="bg-[#0d1117] rounded-2xl border border-[rgba(255,255,255,0.06)] overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-[rgba(255,255,255,0.06)]">
            <th className="text-left px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Market</th>
            <th className="text-center px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Side</th>
            <th className="text-right px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Price</th>
            <th className="text-right px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Size</th>
            <th className="text-right px-4 py-3 text-[10px] tracking-[0.14em] uppercase text-[#64748b]">Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={`${t.txHash}-${i}`} className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(0,212,255,0.04)] transition-colors">
              <td className="px-4 py-3">
                <Link href={`/market/${t.marketId}`} className="text-sm text-white hover:text-[#00d4ff] transition-colors line-clamp-1">
                  {t.title}
                </Link>
                <div className="text-xs text-[#475569] capitalize mt-0.5">{t.category} &middot; {t.outcome}</div>
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                  t.side === "BUY" ? "bg-[#10b981]/10 text-[#10b981]" : "bg-[#ef4444]/10 text-[#ef4444]"
                }`}>{t.side}</span>
              </td>
              <td className="px-4 py-3 text-right text-sm text-white font-mono">{t.price.toFixed(2)}</td>
              <td className="px-4 py-3 text-right text-sm text-white font-mono">${t.sizeUsdc.toLocaleString()}</td>
              <td className="px-4 py-3 text-right">
                <div className="flex items-center justify-end gap-1.5 text-xs text-[#64748b]">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(t.timestamp), { addSuffix: true })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
