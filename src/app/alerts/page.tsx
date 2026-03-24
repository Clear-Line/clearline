"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Bell,
  Loader2,
  ArrowRight,
  TrendingUp,
  Zap,
  ShieldAlert,
  Target,
} from "lucide-react";

// ---- Types (mirrors API response) ----

type AlertType =
  | "VOLUME_EXPLOSION"
  | "SMART_MONEY_ENTRY"
  | "RANGE_BREAKOUT"
  | "MANIPULATION_WARNING";

interface AlertMetrics {
  price_current: number;
  price_previous: number;
  price_delta: number;
  volume_24h: number;
  volume_multiple?: number;
  wallet_count?: number;
  combined_volume_usdc?: number;
  avg_accuracy?: number;
  range_days?: number;
  breakout_magnitude?: number;
  concentration_top1?: number;
  cluster_score?: number;
  direction?: string;
}

interface Alert {
  id: string;
  type: AlertType;
  market_id: string;
  market_question: string;
  category: string;
  detected_at: string;
  signal_strength: number;
  summary: string;
  metrics: AlertMetrics;
}

// ---- Config ----

type FilterOption = "ALL" | AlertType;

const ALERT_CONFIG: Record<
  AlertType,
  { label: string; color: string; bgClass: string; textClass: string; borderColor: string }
> = {
  VOLUME_EXPLOSION: {
    label: "VOLUME EXPLOSION",
    color: "#ef4444",
    bgClass: "bg-[#ef4444]/10",
    textClass: "text-[#ef4444]",
    borderColor: "#ef4444",
  },
  SMART_MONEY_ENTRY: {
    label: "SMART MONEY ENTRY",
    color: "#f59e0b",
    bgClass: "bg-[#f59e0b]/10",
    textClass: "text-[#f59e0b]",
    borderColor: "#f59e0b",
  },
  RANGE_BREAKOUT: {
    label: "RANGE BREAKOUT",
    color: "#10b981",
    bgClass: "bg-[#10b981]/10",
    textClass: "text-[#10b981]",
    borderColor: "#10b981",
  },
  MANIPULATION_WARNING: {
    label: "MANIPULATION WARNING",
    color: "#f59e0b",
    bgClass: "bg-[#f59e0b]/10",
    textClass: "text-[#f59e0b]",
    borderColor: "#f59e0b",
  },
};

const FILTER_BUTTONS: { key: FilterOption; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "VOLUME_EXPLOSION", label: "Volume" },
  { key: "SMART_MONEY_ENTRY", label: "Smart Money" },
  { key: "RANGE_BREAKOUT", label: "Breakout" },
  { key: "MANIPULATION_WARNING", label: "Manipulation" },
];

// ---- Helpers ----

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

function formatScanTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function AlertIcon({ type }: { type: AlertType }) {
  const cls = "h-3.5 w-3.5";
  switch (type) {
    case "VOLUME_EXPLOSION":
      return <Zap className={cls} />;
    case "SMART_MONEY_ENTRY":
      return <Target className={cls} />;
    case "RANGE_BREAKOUT":
      return <TrendingUp className={cls} />;
    case "MANIPULATION_WARNING":
      return <ShieldAlert className={cls} />;
  }
}

// ---- Metric Pills ----

function MetricPill({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col items-center px-3 py-1.5">
      <span className="text-white font-bold font-mono text-sm leading-tight">
        {value}
      </span>
      <span className="text-[#64748b] text-[9px] tracking-[0.1em] uppercase mt-0.5">
        {label}
      </span>
    </div>
  );
}

function AlertMetricRow({ alert }: { alert: Alert }) {
  const m = alert.metrics;
  const pills: { value: string; label: string }[] = [];

  // Price move (all types)
  if (m.price_delta !== 0) {
    const pts = Math.round(m.price_delta * 100);
    pills.push({
      value: `${pts >= 0 ? "+" : ""}${pts}pts`,
      label: "Price Move",
    });
  }

  // Current price
  if (m.price_current > 0) {
    pills.push({
      value: `${(m.price_current * 100).toFixed(0)}c`,
      label: "Current",
    });
  }

  // Type-specific metrics
  switch (alert.type) {
    case "VOLUME_EXPLOSION":
      if (m.volume_multiple) {
        pills.push({ value: `${m.volume_multiple.toFixed(1)}x`, label: "Vol Multiple" });
      }
      if (m.volume_24h > 0) {
        pills.push({ value: formatVolume(m.volume_24h), label: "24h Volume" });
      }
      break;
    case "SMART_MONEY_ENTRY":
      if (m.wallet_count) {
        pills.push({ value: `${m.wallet_count}`, label: "Smart Wallets" });
      }
      if (m.combined_volume_usdc) {
        pills.push({ value: formatVolume(m.combined_volume_usdc), label: "Combined" });
      }
      if (m.avg_accuracy) {
        pills.push({ value: `${(m.avg_accuracy * 100).toFixed(0)}%`, label: "Avg Accuracy" });
      }
      break;
    case "RANGE_BREAKOUT":
      if (m.range_days) {
        pills.push({ value: `${m.range_days}d`, label: "Range" });
      }
      if (m.volume_multiple) {
        pills.push({ value: `${m.volume_multiple.toFixed(1)}x`, label: "Vol Multiple" });
      }
      break;
    case "MANIPULATION_WARNING":
      if (m.concentration_top1) {
        pills.push({ value: `${(m.concentration_top1 * 100).toFixed(0)}%`, label: "Top Wallet" });
      }
      if (m.wallet_count) {
        pills.push({ value: `${m.wallet_count}`, label: "Flagged" });
      }
      if (m.cluster_score) {
        pills.push({ value: `${m.cluster_score}`, label: "Cluster Score" });
      }
      break;
  }

  return (
    <div className="flex items-center gap-1 flex-wrap -mx-1">
      {pills.map((p, i) => (
        <MetricPill key={i} value={p.value} label={p.label} />
      ))}
    </div>
  );
}

// ---- Signal Strength Bar ----

function SignalBar({ strength, color }: { strength: number; color: string }) {
  return (
    <div className="flex items-center gap-2 flex-1">
      <span className="text-[9px] text-[#64748b] tracking-[0.1em] uppercase whitespace-nowrap">
        Signal
      </span>
      <div className="flex-1 h-1 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(strength, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-mono text-[#94a3b8]">{strength}</span>
    </div>
  );
}

// ---- Alert Card ----

function AlertCard({ alert }: { alert: Alert }) {
  const config = ALERT_CONFIG[alert.type];

  return (
    <div
      className="bg-[#0d1117] border border-[rgba(255,255,255,0.06)] rounded-2xl p-5 border-l-[3px]"
      style={{ borderLeftColor: config.borderColor }}
    >
      {/* Row 1: Type badge + timestamp */}
      <div className="flex items-center justify-between mb-3">
        <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase ${config.bgClass} ${config.textClass}`}>
          <AlertIcon type={alert.type} />
          {config.label}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#475569] tracking-wide uppercase">
            {formatTimeAgo(alert.detected_at)}
          </span>
        </div>
      </div>

      {/* Row 2: Market question */}
      <h3 className="text-white font-medium text-sm mb-3 leading-snug">
        {alert.market_question}
      </h3>

      {/* Row 3: Key metrics */}
      <div className="mb-3 border border-[rgba(255,255,255,0.04)] rounded-xl bg-[#080b12]/50 py-1 px-1">
        <AlertMetricRow alert={alert} />
      </div>

      {/* Row 4: Summary */}
      <p className="text-[#94a3b8] text-sm leading-relaxed mb-4">
        {alert.summary}
      </p>

      {/* Row 5: Signal strength + View link */}
      <div className="flex items-center justify-between gap-4">
        <SignalBar strength={alert.signal_strength} color={config.color} />
        <Link
          href={`/market/${alert.market_id}`}
          className="flex items-center gap-1 text-[#00d4ff] text-[10px] font-medium tracking-[0.1em] uppercase hover:text-[#00bde0] transition-colors whitespace-nowrap shrink-0"
        >
          View Analysis
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

// ---- Page ----

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [scanTime, setScanTime] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterOption>("ALL");

  useEffect(() => {
    async function fetchAlerts() {
      try {
        const res = await fetch("/api/alerts/feed");
        if (!res.ok) throw new Error("API error");
        const json = await res.json();
        setAlerts(json.alerts ?? []);
        setScanTime(json.scan_time ?? "");
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchAlerts();
  }, []);

  const filtered =
    activeFilter === "ALL"
      ? alerts
      : alerts.filter((a) => a.type === activeFilter);

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
              <h1 className="text-2xl font-bold text-white tracking-tight">
                SIGNAL FEED
              </h1>
              <p className="text-[#00d4ff] text-xs tracking-[0.2em] uppercase font-medium">
                Curated Market Alerts
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {!loading && (
              <span className="text-[10px] text-[#64748b] tracking-wide uppercase">
                {alerts.length} active signal{alerts.length !== 1 ? "s" : ""}
              </span>
            )}
            {scanTime && (
              <span className="text-[10px] text-[#475569] font-mono">
                Last scan: {formatScanTime(scanTime)} EST
              </span>
            )}
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-1 flex-wrap mb-6">
          {FILTER_BUTTONS.map(({ key, label }) => (
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
            <span className="ml-2 text-sm text-[#64748b]">
              Scanning for signals...
            </span>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <p className="text-sm text-[#94a3b8] mb-2">
              Unable to connect to the signal scanner.
            </p>
            <p className="text-xs text-[#64748b]">
              The pipeline may still be initializing. Try refreshing in a few
              minutes.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center h-14 w-14 rounded-xl bg-[#0d1117] border border-[rgba(255,255,255,0.06)] mb-4">
              <Bell className="h-6 w-6 text-[#475569]" />
            </div>
            <p className="text-sm text-[#94a3b8] mb-2">
              {activeFilter === "ALL"
                ? "No active signals detected"
                : `No ${FILTER_BUTTONS.find((f) => f.key === activeFilter)?.label.toLowerCase()} signals detected`}
            </p>
            <p className="text-xs text-[#64748b]">
              The scanner runs every 2 hours. Check back soon.
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
