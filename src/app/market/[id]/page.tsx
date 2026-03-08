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
  AlertTriangle,
  Activity,
  BarChart3,
  BookOpen,
  Zap,
  Target,
  ArrowUpRight,
  ArrowDownRight,
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
  ReferenceLine,
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

type MetricStatus = 'computed' | 'insufficient_data' | 'stale_data' | 'no_data';

interface DataQuality {
  isPublishable: boolean;
  coverageScore: number;
  computedAt: string | null;
  missingDependencies: string[];
  coverageByMetric: Record<string, MetricStatus> | null;
}

interface Analytics {
  dataQuality: DataQuality | null;
  momentum: { "1h": number | null; "6h": number | null; "24h": number | null };
  volatility24h: number | null;
  convergenceSpeed: number | null;
  priceReversionRate: number | null;
  vwap24h: number | null;
  buySellRatio: number | null;
  smartMoneyFlow: number | null;
  bookImbalance: number | null;
  liquidityAsymmetry: number | null;
  spread: number | null;
  bookDepthBid: number | null;
  bookDepthAsk: number | null;
  costMoveUp5pct: number | null;
  costMoveDown5pct: number | null;
  volumeProfile: { priceRange: string; volume: number; buyPct: number; tradeCount: number }[];
  smartWalletActivity: {
    address: string;
    fullAddress: string;
    accuracy: number;
    netDirection: string;
    buyVolume: number;
    sellVolume: number;
    tradeCount: number;
  }[];
  positionDeltas: {
    wallet: string;
    fullAddress: string;
    currentSize: number;
    delta: number;
    outcome: string;
  }[];
}

// ─── Formatters ───

function formatVol(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function formatPct(v: number | null, decimals = 1): string {
  if (v === null || v === undefined) return "\u2014";
  return `${(v * 100).toFixed(decimals)}%`;
}

function formatNum(v: number | null, decimals = 2): string {
  if (v === null || v === undefined) return "\u2014";
  return v.toFixed(decimals);
}

function signColor(v: number | null): string {
  if (v === null) return "text-[#64748b]";
  if (v > 0) return "text-[#10b981]";
  if (v < 0) return "text-[#ef4444]";
  return "text-[#64748b]";
}

function signPrefix(v: number | null): string {
  if (v === null) return "";
  if (v > 0) return "+";
  return "";
}

// ─── Metric Status Helper ───

function metricLabel(status: MetricStatus | undefined): string | null {
  if (!status || status === 'computed') return null;
  if (status === 'insufficient_data') return 'low data';
  if (status === 'stale_data') return 'stale';
  if (status === 'no_data') return 'no data';
  return null;
}

// ─── Data Quality Badge ───

function DataQualityBadge({ dq }: { dq: DataQuality | null }) {
  if (!dq) return null;
  const score = dq.coverageScore;
  const color = score >= 60 ? "text-[#10b981] border-[#10b981]/30" :
    score >= 30 ? "text-[#f59e0b] border-[#f59e0b]/30" :
    "text-[#ef4444] border-[#ef4444]/30";
  const bg = score >= 60 ? "bg-[#10b981]/10" :
    score >= 30 ? "bg-[#f59e0b]/10" :
    "bg-[#ef4444]/10";
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-mono border ${color} ${bg}`}>
      <span className="tracking-wider uppercase">Coverage</span>
      <span className="font-bold">{score}</span>
    </div>
  );
}

// ─── Stat Cell ───

function Stat({ label, value, sub, color, metricStatus }: { label: string; value: string; sub?: string; color?: string; metricStatus?: MetricStatus }) {
  const statusLabel = metricLabel(metricStatus);
  const isInsufficient = metricStatus && metricStatus !== 'computed';
  return (
    <div className="px-3 py-2">
      <div className="text-[9px] text-[#64748b] tracking-[0.15em] uppercase mb-0.5">{label}</div>
      {isInsufficient && value === "\u2014" ? (
        <div className="text-[10px] font-mono text-[#475569] italic">{statusLabel}</div>
      ) : (
        <div className={`text-sm font-mono font-medium ${color || "text-white"}`}>{value}</div>
      )}
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

// ─── Main Page ───

export default function MarketDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [market, setMarket] = useState<MarketDetail | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [marketRes, analyticsRes] = await Promise.all([
          fetch(`/api/markets/${id}`),
          fetch(`/api/markets/${id}/analytics`),
        ]);

        if (!marketRes.ok) {
          setError(marketRes.status === 404 ? "Market not found" : "Failed to load market data");
          return;
        }

        const marketData = await marketRes.json();
        setMarket(marketData);

        if (analyticsRes.ok) {
          const analyticsData = await analyticsRes.json();
          setAnalytics(analyticsData);
        }
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
        <Link href="/" className="text-[#00d4ff] hover:underline text-sm">Return to terminal</Link>
      </div>
    );
  }

  const isPositive = market.change > 0;
  const isNegative = market.change < 0;
  const changeColor = isPositive ? "text-[#10b981]" : isNegative ? "text-[#ef4444]" : "text-[#64748b]";
  const vwap = analytics?.vwap24h;
  const ms = analytics?.dataQuality?.coverageByMetric;
  const mst = (key: string): MetricStatus | undefined => ms?.[key] as MetricStatus | undefined;

  return (
    <div className="min-h-screen">
      {/* Top Bar */}
      <div className="border-b border-[rgba(255,255,255,0.06)] bg-[#0a0e17]">
        <div className="max-w-[1600px] mx-auto px-4 flex items-center h-8 text-[11px] gap-4">
          <Link href="/" className="flex items-center gap-1.5 text-[#64748b] hover:text-white transition-colors">
            <ArrowLeft className="h-3 w-3" />
            <span className="tracking-wide uppercase">Terminal</span>
          </Link>
          <span className="text-[rgba(255,255,255,0.15)]">|</span>
          <span className="text-[#00d4ff] font-medium tracking-wide uppercase">{market.category}</span>
          <span className="text-[rgba(255,255,255,0.15)]">|</span>
          <span className="text-[#64748b] truncate max-w-[300px] font-mono">{market.id.slice(0, 10)}...{market.id.slice(-6)}</span>
          <div className="ml-auto flex items-center gap-3">
            <DataQualityBadge dq={analytics?.dataQuality ?? null} />
            <ConfidenceBadge confidence={market.confidence} size="sm" />
            <span className="text-[#475569]">
              Updated {new Date(market.lastUpdated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-4 py-4">
        {/* Market Title + Price */}
        <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 mb-3">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-semibold text-white leading-snug mb-2">{market.title}</h1>
              {market.flaggedMoves.length > 0 && (
                <div className="flex items-center gap-2 text-[11px] text-[#f59e0b]">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span className="truncate">{market.flaggedMoves[0].summary}</span>
                </div>
              )}
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
            <Stat label="Top Wallet %" value={`${(market.volumeProfile.topWalletConcentration * 100).toFixed(0)}%`} />
            {market.endDate && (
              <Stat label="End Date" value={new Date(market.endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} />
            )}
          </div>
        </div>

        {/* Main Grid: Charts + Analytics */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 mb-3">
          {/* Left: Charts */}
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
                    {vwap && (
                      <ReferenceLine
                        y={vwap * 100}
                        stroke="#f59e0b"
                        strokeDasharray="5 5"
                        label={{ value: `VWAP ${(vwap * 100).toFixed(1)}`, fill: "#f59e0b", fontSize: 9, position: "right" }}
                      />
                    )}
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

            {/* Volume Profile */}
            {analytics?.volumeProfile && analytics.volumeProfile.length > 0 && (
              <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4">
                <SectionHeader icon={BarChart3} title="Volume Profile" />
                <div className="space-y-1">
                  {analytics.volumeProfile.map((bucket, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono text-[#64748b] w-16 shrink-0">{bucket.priceRange}</span>
                      <div className="flex-1 h-4 bg-[#151b27] rounded overflow-hidden flex">
                        <div className="h-full bg-[#10b981]" style={{ width: `${bucket.buyPct}%` }} />
                        <div className="h-full bg-[#ef4444]" style={{ width: `${100 - bucket.buyPct}%` }} />
                      </div>
                      <span className="font-mono text-white w-16 text-right">{formatVol(bucket.volume)}</span>
                      <span className="font-mono text-[#475569] w-8 text-right">{bucket.tradeCount}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 mt-2 text-[9px] text-[#64748b]">
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#10b981]" />BUY</span>
                    <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#ef4444]" />SELL</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Analytics Panel */}
          <div className="xl:col-span-4 space-y-3">
            {/* Momentum & Price Behavior */}
            <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4">
              <SectionHeader icon={TrendingUp} title="Price Behavior" />
              <div className="grid grid-cols-3 gap-0 -mx-3">
                <Stat label="Mom 1H" value={`${signPrefix(analytics?.momentum?.["1h"] ?? null)}${formatPct(analytics?.momentum?.["1h"] ?? null)}`} color={signColor(analytics?.momentum?.["1h"] ?? null)} metricStatus={mst("momentum_1h")} />
                <Stat label="Mom 6H" value={`${signPrefix(analytics?.momentum?.["6h"] ?? null)}${formatPct(analytics?.momentum?.["6h"] ?? null)}`} color={signColor(analytics?.momentum?.["6h"] ?? null)} metricStatus={mst("momentum_6h")} />
                <Stat label="Mom 24H" value={`${signPrefix(analytics?.momentum?.["24h"] ?? null)}${formatPct(analytics?.momentum?.["24h"] ?? null)}`} color={signColor(analytics?.momentum?.["24h"] ?? null)} metricStatus={mst("momentum_24h")} />
              </div>
              <div className="grid grid-cols-2 gap-0 -mx-3 mt-1 pt-2 border-t border-[rgba(255,255,255,0.04)]">
                <Stat label="Volatility (VIX)" value={formatNum(analytics?.volatility24h)} sub="24h annualized" metricStatus={mst("volatility_24h")} />
                <Stat label="Convergence" value={formatNum(analytics?.convergenceSpeed)} sub="speed to certainty" metricStatus={mst("convergence_speed")} />
              </div>
              <div className="-mx-3 pt-2 border-t border-[rgba(255,255,255,0.04)]">
                <Stat label="Reversion Rate" value={formatPct(analytics?.priceReversionRate ?? null)} sub="% of 2%+ moves that retrace" metricStatus={mst("price_reversion_rate")} />
              </div>
            </div>

            {/* Volume & Flow */}
            <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4">
              <SectionHeader icon={Zap} title="Volume & Flow" />
              <div className="grid grid-cols-2 gap-0 -mx-3">
                <Stat label="VWAP 24H" value={analytics?.vwap24h ? `${(analytics.vwap24h * 100).toFixed(1)}%` : "\u2014"} metricStatus={mst("vwap_24h")} />
                <Stat
                  label="Buy/Sell"
                  value={formatNum(analytics?.buySellRatio)}
                  color={analytics?.buySellRatio ? (analytics.buySellRatio > 1 ? "text-[#10b981]" : "text-[#ef4444]") : undefined}
                  sub={analytics?.buySellRatio ? (analytics.buySellRatio > 1 ? "buy pressure" : "sell pressure") : undefined}
                  metricStatus={mst("buy_sell_ratio")}
                />
              </div>
              <div className="-mx-3 pt-2 border-t border-[rgba(255,255,255,0.04)]">
                <Stat
                  label="Smart Money Flow"
                  value={analytics?.smartMoneyFlow !== null && analytics?.smartMoneyFlow !== undefined ? formatVol(Math.abs(analytics.smartMoneyFlow)) : "\u2014"}
                  color={signColor(analytics?.smartMoneyFlow ?? null)}
                  sub={analytics?.smartMoneyFlow ? (analytics.smartMoneyFlow > 0 ? "net buying (accuracy >60%)" : "net selling (accuracy >60%)") : "wallets with >60% accuracy"}
                  metricStatus={mst("smart_money_flow")}
                />
              </div>
            </div>

            {/* Order Book */}
            <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4">
              <SectionHeader icon={BookOpen} title="Order Book" />
              <div className="grid grid-cols-2 gap-0 -mx-3">
                <Stat label="Spread" value={analytics?.spread ? `${(analytics.spread * 100).toFixed(2)}c` : "\u2014"} />
                <Stat
                  label="Imbalance"
                  value={analytics?.bookImbalance ? formatPct(analytics.bookImbalance, 0) : "\u2014"}
                  color={analytics?.bookImbalance ? (analytics.bookImbalance > 0.5 ? "text-[#10b981]" : "text-[#ef4444]") : undefined}
                  sub={analytics?.bookImbalance ? (analytics.bookImbalance > 0.5 ? "bid heavy" : "ask heavy") : undefined}
                  metricStatus={mst("book_imbalance")}
                />
              </div>
              <div className="grid grid-cols-2 gap-0 -mx-3 pt-2 border-t border-[rgba(255,255,255,0.04)]">
                <Stat label="Bid Depth 5c" value={analytics?.bookDepthBid ? formatVol(analytics.bookDepthBid) : "\u2014"} />
                <Stat label="Ask Depth 5c" value={analytics?.bookDepthAsk ? formatVol(analytics.bookDepthAsk) : "\u2014"} />
              </div>
              {(analytics?.costMoveUp5pct || analytics?.costMoveDown5pct) && (
                <div className="grid grid-cols-2 gap-0 -mx-3 pt-2 border-t border-[rgba(255,255,255,0.04)]">
                  <Stat label="Cost +5%" value={analytics?.costMoveUp5pct ? formatVol(analytics.costMoveUp5pct) : "\u2014"} />
                  <Stat label="Cost -5%" value={analytics?.costMoveDown5pct ? formatVol(analytics.costMoveDown5pct) : "\u2014"} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom: Wallets + Smart Activity */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
          {/* Top Wallets */}
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
                          <Link href="/wallets" className="text-[9px] text-[#00d4ff] hover:underline flex items-center gap-0.5">
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

          {/* Smart Wallet Activity */}
          <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4">
            <SectionHeader icon={Target} title="Smart Wallet Activity" />
            {analytics?.smartWalletActivity && analytics.smartWalletActivity.length > 0 ? (
              <div className="space-y-0">
                <div className="flex items-center gap-2 text-[9px] text-[#475569] tracking-wider uppercase px-1 pb-2 border-b border-[rgba(255,255,255,0.04)]">
                  <span className="w-20">Wallet</span>
                  <span className="w-10 text-right">Acc</span>
                  <span className="flex-1 text-right">Buy</span>
                  <span className="flex-1 text-right">Sell</span>
                  <span className="w-12 text-right">Signal</span>
                </div>
                {analytics.smartWalletActivity.slice(0, 10).map((w, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] font-mono px-1 py-1.5 border-b border-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.02)]">
                    <span className="text-[#94a3b8] w-20 truncate">{w.address}</span>
                    <span className={`w-10 text-right ${w.accuracy >= 0.7 ? "text-[#10b981]" : "text-[#f59e0b]"}`}>
                      {(w.accuracy * 100).toFixed(0)}%
                    </span>
                    <span className="flex-1 text-right text-[#10b981]">{formatVol(w.buyVolume)}</span>
                    <span className="flex-1 text-right text-[#ef4444]">{formatVol(w.sellVolume)}</span>
                    <span className={`w-12 text-right font-bold ${w.netDirection === "BUY" ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                      {w.netDirection === "BUY" ? (
                        <span className="flex items-center justify-end gap-0.5"><ArrowUpRight className="h-3 w-3" />BUY</span>
                      ) : (
                        <span className="flex items-center justify-end gap-0.5"><ArrowDownRight className="h-3 w-3" />SELL</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#475569] text-xs">No smart wallet trades detected for this market.</p>
            )}
          </div>
        </div>

        {/* Flagged Moves */}
        {market.flaggedMoves.length > 0 && (
          <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 mb-3">
            <SectionHeader icon={AlertTriangle} title="Flagged Moves" />
            <div className="space-y-2">
              {market.flaggedMoves.map((move, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.04)] rounded-lg">
                  <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${move.direction === "BUY" ? "bg-[#10b981]" : "bg-[#ef4444]"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className={`text-[10px] font-bold tracking-wider uppercase ${move.direction === "BUY" ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                        {move.direction === "BUY" ? "Bullish" : "Bearish"}
                      </span>
                      <span className="text-[10px] text-[#64748b] font-mono">conf {move.confidence}/100</span>
                      <span className="text-[10px] text-[#475569]">
                        {new Date(move.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <p className="text-xs text-[#94a3b8] leading-relaxed">{move.summary}</p>
                    <div className="mt-1 text-[10px] font-mono text-[#475569]">
                      price delta: {signPrefix(move.priceDelta)}{(move.priceDelta * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Position Deltas */}
        {analytics?.positionDeltas && analytics.positionDeltas.length > 0 && (
          <div className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 mb-3">
            <SectionHeader icon={Activity} title="Position Changes (Flagged Wallets)" />
            <div className="space-y-0">
              <div className="flex items-center gap-2 text-[9px] text-[#475569] tracking-wider uppercase px-1 pb-2 border-b border-[rgba(255,255,255,0.04)]">
                <span className="w-24">Wallet</span>
                <span className="w-14 text-right">Outcome</span>
                <span className="flex-1 text-right">Position</span>
                <span className="w-20 text-right">Delta</span>
              </div>
              {analytics.positionDeltas.slice(0, 10).map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] font-mono px-1 py-1.5 border-b border-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.02)]">
                  <span className="text-[#94a3b8] w-24 truncate">{p.wallet}</span>
                  <span className="text-[#64748b] w-14 text-right">{p.outcome}</span>
                  <span className="text-white flex-1 text-right">{p.currentSize.toFixed(1)}</span>
                  <span className={`w-20 text-right font-medium ${signColor(p.delta)}`}>
                    {signPrefix(p.delta)}{p.delta.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
