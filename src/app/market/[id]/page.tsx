"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Users,
  TrendingUp,
  TrendingDown,
  Minus,
  ExternalLink,
  Loader2,
  Activity,
  BarChart3,
  ArrowUpCircle,
  ArrowDownCircle,
  MinusCircle,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
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
  Cell,
} from "recharts";

// ─── Types ───

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
  confidence: string;
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
  // Smart money signal
  signal: 'BUY' | 'SELL' | 'NEUTRAL';
  signalConfidence: number;
  smartBuyVolume: number;
  smartSellVolume: number;
  smartWalletCount: number;
  topSmartWallets: { address: string; accuracy: number; side: string; volume: number }[];
  // Insider signal (replaces smart-wallet historical accuracy)
  insiderCount: number;
  topInsiders: {
    address: string;
    side: 'BUY' | 'SELL';
    position: number;
    concentration: number;
    marketsTraded: number;
  }[];
}

// ─── Formatters ───

function formatVol(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

// ─── Stat Cell ───

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="px-3 py-2">
      <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase mb-0.5">{label}</div>
      <div className={`text-sm font-mono font-medium ${color || "text-white"}`}>{value}</div>
      {sub && <div className="text-[9px] text-[#475569] mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Section Header ───

function SectionHeader({ icon: Icon, title }: { icon: React.ComponentType<{ className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-3.5 w-3.5 text-[#00d4ff]" />
      <h2 className="text-[10px] font-bold text-[#00d4ff] tracking-[0.15em] uppercase">{title}</h2>
    </div>
  );
}

// ─── Chart Tooltip ───

function TerminalTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#151b27] border border-[rgba(255,255,255,0.15)] rounded px-3 py-2 text-xs">
      <div className="text-[#64748b] text-[10px] mb-1">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="text-white font-mono">
          {p.name === "odds" ? `${p.value}%` : formatVol(p.value)}
        </div>
      ))}
    </div>
  );
}

// ─── Signal Badge ───

function SignalBadge({ signal, confidence }: { signal: string; confidence: number }) {
  const config = signal === 'BUY'
    ? { color: 'text-[#10b981]', bg: 'bg-[#10b981]/10 border-[#10b981]/30', Icon: ArrowUpCircle }
    : signal === 'SELL'
    ? { color: 'text-[#ef4444]', bg: 'bg-[#ef4444]/10 border-[#ef4444]/30', Icon: ArrowDownCircle }
    : { color: 'text-[#64748b]', bg: 'bg-[#64748b]/10 border-[#64748b]/30', Icon: MinusCircle };

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${config.bg}`}>
      <config.Icon className={`h-5 w-5 ${config.color}`} />
      <div>
        <div className={`text-sm font-bold tracking-wider ${config.color}`}>{signal}</div>
        {confidence > 0 && (
          <div className="text-[9px] text-[#64748b]">{Math.round(confidence * 100)}% confidence</div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───

export default function MarketDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [market, setMarket] = useState<MarketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/markets/${id}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Market not found" : "Failed to load market data");
          return;
        }
        setMarket(await res.json());
      } catch {
        setError("Failed to load market data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[#00d4ff]" />
        <span className="ml-2 text-sm text-[#64748b]">Loading market...</span>
      </div>
    );
  }

  if (error || !market) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <p className="text-[#64748b]">{error || "Market not found"}</p>
        <Link href="/explore" className="text-[#00d4ff] hover:underline text-sm">Return to explore</Link>
      </div>
    );
  }

  const isPositive = market.change > 0;
  const isNegative = market.change < 0;
  const changeColor = isPositive ? "text-[#10b981]" : isNegative ? "text-[#ef4444]" : "text-[#64748b]";

  return (
    <div className="min-h-screen">
      {/* Top Bar */}
      <div className="border-b border-[rgba(255,255,255,0.06)] bg-[#0a0e17]">
        <div className="max-w-[1600px] mx-auto px-4 flex items-center h-8 text-[11px] gap-4">
          <Link href="/explore" className="flex items-center gap-1.5 text-[#64748b] hover:text-white transition-colors">
            <ArrowLeft className="h-3 w-3" />
            <span className="tracking-wide uppercase">Explore</span>
          </Link>
          <span className="text-[rgba(255,255,255,0.15)]">|</span>
          <span className="text-[#00d4ff] font-medium tracking-wide uppercase">{market.category}</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[#475569]">
              Updated {new Date(market.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-4">
        {/* Market Title + Price + Signal */}
        <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 mb-3">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-white leading-snug mb-3">{market.title}</h1>
              <SignalBadge signal={market.signal} confidence={market.signalConfidence} />
            </div>
            <div className="flex items-baseline gap-4 shrink-0">
              <div>
                <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase">YES Price</div>
                <div className="text-4xl font-bold text-white font-mono tabular-nums">
                  {(market.currentOdds * 100).toFixed(1)}<span className="text-xl text-[#64748b]">%</span>
                </div>
              </div>
              <div className={`flex items-center gap-1 text-base font-mono font-medium ${changeColor}`}>
                {isPositive ? <TrendingUp className="h-4 w-4" /> : isNegative ? <TrendingDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                {isPositive ? "+" : ""}{(market.change * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Key Stats Row */}
          <div className="flex flex-wrap items-center gap-0 mt-3 pt-3 border-t border-[rgba(255,255,255,0.06)] -mx-3">
            <Stat label="24H Volume" value={formatVol(market.volume24h)} />
            <Stat label="Total Volume" value={formatVol(market.volumeProfile.totalVolume)} />
            <Stat label="Liquidity" value={formatVol(market.liquidity)} />
            <Stat label="Wallets" value={market.volumeProfile.uniqueWallets.toString()} />
            {market.endDate && (
              <Stat label="End Date" value={new Date(market.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
            )}
          </div>
        </div>

        {/* Insider Wallets Panel — behavioral, replaces historical smart-money */}
        {market.insiderCount > 0 && (
          <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 mb-3">
            <SectionHeader icon={Activity} title="Insider Wallet Activity" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div>
                <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase mb-1">Insider Wallets</div>
                <div className="text-2xl font-bold text-white font-mono">{market.insiderCount}</div>
              </div>
              <div>
                <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase mb-1">Top Position</div>
                <div className="text-2xl font-bold text-white font-mono">
                  {market.topInsiders[0] ? formatVol(market.topInsiders[0].position) : '—'}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase mb-1">Top Concentration</div>
                <div className="text-2xl font-bold text-[#f59e0b] font-mono">
                  {market.topInsiders[0] ? `${market.topInsiders[0].concentration}%` : '—'}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase mb-1">Markets Traded</div>
                <div className="text-2xl font-bold text-white font-mono">
                  {market.topInsiders[0] ? market.topInsiders[0].marketsTraded : '—'}
                </div>
              </div>
            </div>

            {/* Top Insider Wallets Table */}
            {market.topInsiders.length > 0 && (
              <div>
                <div className="flex items-center gap-2 text-[9px] text-[#475569] tracking-wider uppercase px-1 pb-2 border-b border-[rgba(255,255,255,0.04)]">
                  <span className="w-28">Wallet</span>
                  <span className="w-20 text-right">Position</span>
                  <span className="flex-1 text-right">Concentration</span>
                  <span className="w-20 text-right">Markets</span>
                  <span className="w-16 text-right">Side</span>
                </div>
                {market.topInsiders.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono px-1 py-1.5 border-b border-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.02)]">
                    <span className="text-[#94a3b8] w-28 truncate">{w.address}</span>
                    <span className="text-white w-20 text-right">{formatVol(w.position)}</span>
                    <span className="text-[#f59e0b] flex-1 text-right">{w.concentration}% of wallet</span>
                    <span className="text-[#94a3b8] w-20 text-right">{w.marketsTraded} mkts</span>
                    <span className={`w-16 text-right font-bold ${w.side === "BUY" ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                      {w.side === "BUY" ? (
                        <span className="flex items-center justify-end gap-0.5"><ArrowUpRight className="h-3 w-3" />BUY</span>
                      ) : (
                        <span className="flex items-center justify-end gap-0.5"><ArrowDownRight className="h-3 w-3" />SELL</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-3">
          <div className="xl:col-span-8 space-y-3">
            {/* Price Chart */}
            {market.chartData.length > 1 ? (
              <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4">
                <SectionHeader icon={Activity} title="Price Action" />
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={market.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                    <YAxis stroke="#475569" fontSize={10} domain={[0, 100]} tickLine={false} />
                    <Tooltip content={<TerminalTooltip />} />
                    <Line type="monotone" dataKey="odds" stroke="#00d4ff" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 text-center">
                <p className="text-[#475569] text-xs">Chart data will appear as snapshots are collected.</p>
              </div>
            )}

            {/* Volume Chart */}
            {market.chartData.length > 1 && (
              <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4">
                <SectionHeader icon={BarChart3} title="Volume" />
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={market.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} />
                    <YAxis stroke="#475569" fontSize={10} tickLine={false} />
                    <Tooltip content={<TerminalTooltip />} />
                    <Bar dataKey="volume" radius={[2, 2, 0, 0]}>
                      {market.chartData.map((_, i) => (
                        <Cell key={i} fill={i === market.chartData.length - 1 ? "#00d4ff" : "rgba(0,212,255,0.3)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Right: Top Wallets */}
          <div className="xl:col-span-4">
            <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4">
              <SectionHeader icon={Users} title="Top Wallets by Volume" />
              {market.walletBreakdown.length > 0 ? (
                <div className="space-y-2">
                  {market.walletBreakdown.map((wallet, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-[10px] font-mono text-[#475569] w-4">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-white">{wallet.walletId}</span>
                            <Link href={`/wallets/${wallet.fullAddress}`} className="text-[9px] text-[#00d4ff] hover:underline flex items-center gap-0.5">
                              profile <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          </div>
                          <div className="flex items-center gap-3 text-[10px]">
                            {wallet.accuracy !== null && (
                              <span className="text-[#64748b]">
                                acc <span className={`font-mono ${wallet.accuracy >= 70 ? "text-[#10b981]" : wallet.accuracy >= 50 ? "text-[#f59e0b]" : "text-[#ef4444]"}`}>{wallet.accuracy}%</span>
                              </span>
                            )}
                            <span className="text-[#475569] font-mono">{wallet.tradeCount} trades</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-[#151b27] rounded-full overflow-hidden">
                            <div className="h-full bg-[#00d4ff] rounded-full" style={{ width: `${wallet.percentage}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-white w-10 text-right">{wallet.percentage}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[#475569] text-xs">No trade data collected yet.</p>
              )}
            </div>
          </div>
        </div>

        {/* Polymarket Link */}
        <div className="text-center py-4">
          <a
            href={`https://polymarket.com/event/${market.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-[#64748b] hover:text-[#00d4ff] transition-colors"
          >
            View on Polymarket <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
