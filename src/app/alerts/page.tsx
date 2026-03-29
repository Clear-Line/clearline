"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Bell,
  Loader2,
  ArrowRight,
  ArrowUpCircle,
  ArrowDownCircle,
  Users,
} from "lucide-react";

// ─── Types ───

interface SmartMoneyAlert {
  id: string;
  type: string;
  market_id: string;
  market_question: string;
  category: string;
  detected_at: string;
  signal: 'BUY' | 'SELL';
  signal_confidence: number;
  smart_buy_volume: number;
  smart_sell_volume: number;
  smart_wallet_count: number;
  current_price: number;
  price_change: number;
  volume_24h: number;
  top_wallets: { address: string; accuracy: number; falcon_score?: number | null; side: string; volume: number }[];
  volume_divergence: number | null;
  spread_ratio: number | null;
  depth_ratio: number | null;
  liquidity_vacuum: boolean;
  badges: string[];
}

type FilterOption = "ALL" | "BUY" | "SELL";

// ─── Helpers ───

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Alert Card ───

function AlertCard({ alert }: { alert: SmartMoneyAlert }) {
  const isBuy = alert.signal === 'BUY';
  const signalColor = isBuy ? 'text-[#10b981]' : 'text-[#ef4444]';
  const signalBg = isBuy ? 'bg-[#10b981]/10' : 'bg-[#ef4444]/10';
  const borderColor = isBuy ? '#10b981' : '#ef4444';
  const SignalIcon = isBuy ? ArrowUpCircle : ArrowDownCircle;

  return (
    <div
      className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-2xl p-5 border-l-[3px]"
      style={{ borderLeftColor: borderColor }}
    >
      {/* Row 1: Signal badge + timestamp */}
      <div className="flex items-center justify-between mb-3">
        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase ${signalBg} ${signalColor}`}>
          <SignalIcon className="h-3.5 w-3.5" />
          SMART MONEY {alert.signal}
        </div>
        <span className="text-[10px] text-[#475569] tracking-wide uppercase">
          {formatTimeAgo(alert.detected_at)}
        </span>
      </div>

      {/* Edge signal badges */}
      {alert.badges && alert.badges.length > 0 && (
        <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
          {alert.badges.includes('HIGH_CONVICTION') && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase bg-[#f59e0b]/15 text-[#f59e0b] border border-[#f59e0b]/20">
              High Conviction
            </span>
          )}
          {alert.badges.includes('VOLUME_ACCUMULATION') && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase bg-[#8b5cf6]/15 text-[#8b5cf6] border border-[#8b5cf6]/20">
              Volume Accumulation
            </span>
          )}
          {alert.badges.includes('LIQUIDITY_WARNING') && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider uppercase bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/20">
              Liquidity Warning
            </span>
          )}
        </div>
      )}

      {/* Row 2: Market question */}
      <h3 className="text-white font-medium text-sm mb-3 leading-snug">
        {alert.market_question}
      </h3>

      {/* Row 3: Key metrics */}
      <div className="mb-3 border border-[rgba(255,255,255,0.04)] rounded-xl bg-[#080b12]/50 py-2 px-2">
        <div className="flex items-center gap-1 flex-wrap">
          <div className="flex flex-col items-center px-3 py-1.5">
            <span className="text-white font-bold font-mono text-sm">{(alert.current_price * 100).toFixed(0)}%</span>
            <span className="text-[#64748b] text-[9px] tracking-[0.1em] uppercase mt-0.5">Price</span>
          </div>
          <div className="flex flex-col items-center px-3 py-1.5">
            <span className={`font-bold font-mono text-sm ${alert.price_change >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}`}>
              {alert.price_change >= 0 ? '+' : ''}{(alert.price_change * 100).toFixed(1)}%
            </span>
            <span className="text-[#64748b] text-[9px] tracking-[0.1em] uppercase mt-0.5">24h Change</span>
          </div>
          <div className="flex flex-col items-center px-3 py-1.5">
            <span className="text-white font-bold font-mono text-sm">{alert.smart_wallet_count}</span>
            <span className="text-[#64748b] text-[9px] tracking-[0.1em] uppercase mt-0.5">Smart Wallets</span>
          </div>
          <div className="flex flex-col items-center px-3 py-1.5">
            <span className="text-[#10b981] font-bold font-mono text-sm">{formatVolume(alert.smart_buy_volume)}</span>
            <span className="text-[#64748b] text-[9px] tracking-[0.1em] uppercase mt-0.5">Buy Vol</span>
          </div>
          <div className="flex flex-col items-center px-3 py-1.5">
            <span className="text-[#ef4444] font-bold font-mono text-sm">{formatVolume(alert.smart_sell_volume)}</span>
            <span className="text-[#64748b] text-[9px] tracking-[0.1em] uppercase mt-0.5">Sell Vol</span>
          </div>
          <div className="flex flex-col items-center px-3 py-1.5">
            <span className="text-white font-bold font-mono text-sm">{formatVolume(alert.volume_24h)}</span>
            <span className="text-[#64748b] text-[9px] tracking-[0.1em] uppercase mt-0.5">24h Volume</span>
          </div>
        </div>
      </div>

      {/* Row 4: Confidence + View link */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-[9px] text-[#64748b] tracking-[0.1em] uppercase whitespace-nowrap">Confidence</span>
          <div className="flex-1 h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(alert.signal_confidence * 100, 100)}%`, backgroundColor: borderColor }}
            />
          </div>
          <span className="text-[10px] font-mono text-[#94a3b8]">{Math.round(alert.signal_confidence * 100)}%</span>
        </div>
        <Link
          href={`/market/${alert.market_id}`}
          className="flex items-center gap-1 text-[#00d4ff] text-[10px] font-medium tracking-[0.1em] uppercase hover:text-[#00bde0] transition-colors whitespace-nowrap shrink-0"
        >
          View Market
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

// ─── Page ───

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<SmartMoneyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [scanTime, setScanTime] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterOption>("ALL");

  useEffect(() => {
    async function fetchAlerts() {
      try {
        const res = await fetch("/api/alerts/feed");
        const json = await res.json();
        if (!res.ok) {
          throw new Error(
            typeof json?.error === "string" && json.error.length > 0
              ? json.error
              : "Signal feed request failed.",
          );
        }
        setAlerts(json.alerts ?? []);
        setScanTime(json.scan_time ?? "");
      } catch (err) {
        setError(true);
        setErrorMessage(err instanceof Error ? err.message : "Signal feed request failed.");
      } finally {
        setLoading(false);
      }
    }
    fetchAlerts();
  }, []);

  const filtered = activeFilter === "ALL"
    ? alerts
    : alerts.filter((a) => a.signal === activeFilter);

  const buyCount = alerts.filter(a => a.signal === 'BUY').length;
  const sellCount = alerts.filter(a => a.signal === 'SELL').length;

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-[#00d4ff] to-[#0088aa] flex items-center justify-center">
              <Bell className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">SMART MONEY SIGNALS</h1>
              <p className="text-[#00d4ff] text-xs tracking-[0.2em] uppercase font-medium">
                High-Accuracy Wallet Activity
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {!loading && (
              <div className="flex items-center gap-3 text-[10px] tracking-wide uppercase">
                <span className="text-[#10b981]">{buyCount} buys</span>
                <span className="text-[#475569]">|</span>
                <span className="text-[#ef4444]">{sellCount} sells</span>
              </div>
            )}
            {scanTime && (
              <span className="text-[10px] text-[#475569] font-mono">
                Computed {scanTime}
              </span>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-1 flex-wrap mb-6">
          {([
            { key: "ALL" as FilterOption, label: "All Signals" },
            { key: "BUY" as FilterOption, label: "Buy Signals" },
            { key: "SELL" as FilterOption, label: "Sell Signals" },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveFilter(key)}
              className={`px-3 py-1 rounded-lg text-[10px] font-medium tracking-wider uppercase transition-colors ${
                activeFilter === key
                  ? "bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/30"
                  : "text-[#64748b] border border-transparent hover:text-white hover:bg-[rgba(255,255,255,0.04)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-[#00d4ff]" />
            <span className="ml-2 text-sm text-[#64748b]">Scanning for signals...</span>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-sm text-[#94a3b8] mb-2">Unable to connect to the signal scanner.</p>
            <p className="text-xs text-[#64748b]">The pipeline may still be initializing. Try refreshing in a few minutes.</p>
            {process.env.NODE_ENV !== "production" && errorMessage ? (
              <p className="mt-3 text-xs text-[#475569] font-mono">{errorMessage}</p>
            ) : null}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-[#0d1117] border border-[rgba(255,255,255,0.06)] mb-4">
              <Users className="h-6 w-6 text-[#475569]" />
            </div>
            <p className="text-sm text-[#94a3b8] mb-2">
              {activeFilter === "ALL"
                ? "No smart money signals detected yet"
                : `No ${activeFilter.toLowerCase()} signals detected`}
            </p>
            <p className="text-xs text-[#64748b]">
              Signals appear when high-accuracy wallets make concentrated trades. The scanner updates every 10 minutes.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
