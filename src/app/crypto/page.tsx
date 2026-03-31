"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";

// ─── Types ───

interface SignalValue {
  value: number;
  raw: number | null;
  label: string;
  direction: "bullish" | "bearish";
}

interface SentimentSignal {
  asset: string;
  timeframe: string;
  polymarketProb: number;
  polymarketQuestion: string;
  polymarketMarketId: string;
  derivativesProb: number;
  sds: number;
  sdsDirection: string;
  signalBreakdown: {
    fundingRate: SignalValue | null;
    cvd: SignalValue | null;
    optionsSkew: SignalValue | null;
    openInterest: SignalValue | null;
    liquidations: SignalValue | null;
  };
  signalsActive: number;
  signalsAgreeing: number;
  agreementScore: number;
  confidence: string;
  spotPrice: number;
  windowEnd: string;
  computedAt: string;
}

interface DerivativesData {
  asset: string;
  fundingRate: number;
  spotPrice: number;
  cvd1h: number;
  cvd4h: number;
  buyVol: number;
  sellVol: number;
  optionsSkew: number | null;
  oiChangePct: number | null;
  fetchedAt: string;
}

interface SentimentResponse {
  signals: SentimentSignal[];
  derivatives: DerivativesData | null;
  meta: {
    phase: number;
    activeSignals: string[];
    totalSignals: number;
  };
}

// ─── Helpers ───

function formatVol(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function formatPrice(v: number): string {
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function timeRemaining(windowEnd: string): string {
  const diff = new Date(windowEnd).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h ${rem}m left`;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const SIGNAL_EXPLANATIONS: Record<string, string> = {
  "Funding Rate": "Fees longs pay shorts every 8h. Positive means traders are paying to bet up.",
  "Spot CVD": "Net buying vs selling pressure in USD. Positive means more buying.",
  "Options Skew": "Put vs call demand on Deribit. More puts means hedging against drops.",
  "Open Interest": "Change in open futures contracts. Rising means new money entering.",
  "Liquidations": "Long vs short liquidation ratio. More long liquidations means longs getting wiped.",
};

// ─── Main Page ───

export default function CryptoPage() {
  const [data, setData] = useState<SentimentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/crypto/sentiment");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#080b12] flex items-center justify-center">
        <Loader2 className="h-6 w-6 text-[#94a3b8] animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#080b12] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#ef4444] text-sm mb-2">Failed to load</p>
          <p className="text-[#64748b] text-xs mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-1.5 text-xs text-[#94a3b8] border border-[rgba(255,255,255,0.1)] rounded hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const deriv = data?.derivatives;
  const signals = data?.signals?.sort((a, b) => {
    return new Date(a.windowEnd).getTime() - new Date(b.windowEnd).getTime();
  }) ?? [];

  return (
    <div className="min-h-screen bg-[#080b12]">
      <div className="max-w-[960px] mx-auto px-4 sm:px-6 py-8">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Crypto Sentiment</h1>
          <p className="text-[#64748b] text-sm mt-1">
            Derivatives consensus vs Polymarket probability
          </p>
          <p className="text-[#475569] text-xs mt-2 max-w-[640px]">
            Compares what futures and options traders are doing against what Polymarket bettors think will happen. When they disagree, it may signal a mispricing.
          </p>
        </div>

        {/* Live data bar */}
        {deriv && (
          <div className="bg-[#0d1117] rounded-lg border border-[rgba(255,255,255,0.06)] mb-6 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.06)]">
                  <th className="text-left text-[#64748b] text-xs font-medium px-4 py-2">BTC Price</th>
                  <th className="text-left text-[#64748b] text-xs font-medium px-4 py-2">Funding (8h)</th>
                  <th className="text-left text-[#64748b] text-xs font-medium px-4 py-2">Buy/Sell Delta 1h</th>
                  <th className="text-left text-[#64748b] text-xs font-medium px-4 py-2">Buy/Sell Delta 4h</th>
                  <th className="text-left text-[#64748b] text-xs font-medium px-4 py-2">Options Skew</th>
                  <th className="text-left text-[#64748b] text-xs font-medium px-4 py-2">OI Change</th>
                  <th className="text-right text-[#64748b] text-xs font-medium px-4 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-4 py-3 text-white font-mono">{formatPrice(deriv.spotPrice)}</td>
                  <td className={`px-4 py-3 font-mono ${deriv.fundingRate >= 0 ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                    {deriv.fundingRate >= 0 ? "+" : ""}{(deriv.fundingRate * 100).toFixed(4)}%
                  </td>
                  <td className={`px-4 py-3 font-mono ${deriv.cvd1h >= 0 ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                    {formatVol(deriv.cvd1h)}
                  </td>
                  <td className={`px-4 py-3 font-mono ${deriv.cvd4h >= 0 ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                    {formatVol(deriv.cvd4h)}
                  </td>
                  <td className={`px-4 py-3 font-mono ${deriv.optionsSkew != null ? (deriv.optionsSkew <= 0 ? "text-[#10b981]" : "text-[#ef4444]") : "text-[#64748b]"}`}>
                    {deriv.optionsSkew != null ? `${deriv.optionsSkew > 0 ? "+" : ""}${(deriv.optionsSkew * 100).toFixed(1)}%` : "-"}
                  </td>
                  <td className={`px-4 py-3 font-mono ${deriv.oiChangePct != null ? (deriv.oiChangePct >= 0 ? "text-[#10b981]" : "text-[#ef4444]") : "text-[#64748b]"}`}>
                    {deriv.oiChangePct != null ? `${deriv.oiChangePct >= 0 ? "+" : ""}${deriv.oiChangePct.toFixed(2)}%` : "-"}
                  </td>
                  <td className="px-4 py-3 text-right text-[#64748b] text-xs">{timeAgo(deriv.fetchedAt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Signal cards */}
        {signals.length > 0 ? (
          <div className="space-y-6">
            {signals.map((sig) => {
              const polyPct = Math.round(sig.polymarketProb * 100);
              const derivPct = Math.round(sig.derivativesProb * 100);
              const sdsSign = sig.sds >= 0 ? "+" : "";

              const activeSignals = [
                sig.signalBreakdown.fundingRate,
                sig.signalBreakdown.cvd,
                sig.signalBreakdown.optionsSkew,
                sig.signalBreakdown.openInterest,
                sig.signalBreakdown.liquidations,
              ].filter(Boolean) as SignalValue[];

              return (
                <div key={sig.timeframe} className="bg-[#0d1117] rounded-lg border border-[rgba(255,255,255,0.06)] overflow-hidden">

                  {/* Card header */}
                  <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
                    <div>
                      <span className="text-white font-medium text-sm">
                        BTC {sig.timeframe.toUpperCase()} Window
                      </span>
                      <span className="text-[#64748b] text-xs ml-3">
                        {sig.polymarketQuestion}
                      </span>
                    </div>
                    <span className="text-[#64748b] text-xs">{timeRemaining(sig.windowEnd)}</span>
                  </div>

                  {/* Probability comparison */}
                  <div className="px-4 py-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left text-[#64748b] text-xs font-medium pb-2 w-1/4">Source</th>
                          <th className="text-left text-[#64748b] text-xs font-medium pb-2 w-1/4">Prob (Up)</th>
                          <th className="text-left text-[#64748b] text-xs font-medium pb-2 w-1/4">Divergence</th>
                          <th className="text-left text-[#64748b] text-xs font-medium pb-2 w-1/4">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="py-1 text-[#94a3b8]">Polymarket</td>
                          <td className="py-1 text-white font-mono">{polyPct}%</td>
                          <td rowSpan={2} className={`py-1 font-mono text-lg font-semibold ${
                            Math.abs(sig.sds) > 15 ? "text-[#00d4ff]" :
                            Math.abs(sig.sds) > 8 ? "text-[#f59e0b]" :
                            "text-[#94a3b8]"
                          }`}>
                            {sdsSign}{sig.sds.toFixed(1)} pts
                          </td>
                          <td rowSpan={2} className="py-1 text-[#94a3b8] text-xs">
                            {sig.confidence} ({sig.signalsAgreeing}/{sig.signalsActive} agree)
                          </td>
                        </tr>
                        <tr>
                          <td className="py-1 text-[#94a3b8]">Derivatives</td>
                          <td className="py-1 text-white font-mono">{derivPct}%</td>
                        </tr>
                      </tbody>
                    </table>

                    {Math.abs(sig.sds) > 5 && (
                      <p className="text-[#64748b] text-xs mt-2">
                        {sig.sdsDirection === "DERIVATIVES_BULLISH"
                          ? "Derivatives market is more bullish than Polymarket"
                          : sig.sdsDirection === "DERIVATIVES_BEARISH"
                          ? "Derivatives market is more bearish than Polymarket"
                          : "Both venues agree"}
                      </p>
                    )}
                  </div>

                  {/* Signal breakdown */}
                  <div className="px-4 pb-4">
                    <div className="text-[#64748b] text-xs font-medium mb-2">Signals</div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[#64748b]">
                          <th className="text-left font-medium pb-1 w-2/5">Name</th>
                          <th className="text-left font-medium pb-1 w-1/5">Direction</th>
                          <th className="text-right font-medium pb-1 w-1/5">Normalized</th>
                          <th className="text-right font-medium pb-1 w-1/5">Raw</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeSignals.map((s) => (
                          <tr key={s.label}>
                            <td className="py-1.5">
                              <span className="text-[#94a3b8]">{s.label}</span>
                              <span className="block text-[#475569] text-[10px] leading-tight mt-0.5">
                                {SIGNAL_EXPLANATIONS[s.label] ?? ""}
                              </span>
                            </td>
                            <td className={`py-1.5 ${s.direction === "bullish" ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                              {s.direction}
                            </td>
                            <td className={`py-1.5 text-right font-mono ${s.direction === "bullish" ? "text-[#10b981]" : "text-[#ef4444]"}`}>
                              {s.value > 0 ? "+" : ""}{s.value.toFixed(3)}
                            </td>
                            <td className="py-1.5 text-right text-[#64748b] font-mono">
                              {s.label === "Funding Rate" && s.raw != null
                                ? `${(s.raw * 100).toFixed(4)}%`
                                : s.label === "Spot CVD" && s.raw != null
                                ? formatVol(s.raw)
                                : s.label === "Options Skew" && s.raw != null
                                ? `${s.raw > 0 ? "+" : ""}${(s.raw * 100).toFixed(1)}%`
                                : s.label === "Open Interest" && s.raw != null
                                ? `${s.raw >= 0 ? "+" : ""}${s.raw.toFixed(2)}%`
                                : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer */}
                  <div className="px-4 py-2 border-t border-[rgba(255,255,255,0.06)] text-[#64748b] text-xs flex justify-between">
                    <span>Updated {timeAgo(sig.computedAt)}</span>
                    <span>{data?.meta.activeSignals.length ?? 0} of {data?.meta.totalSignals ?? 5} signals active</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-[#0d1117] rounded-lg border border-[rgba(255,255,255,0.06)] px-6 py-10 text-center">
            <p className="text-[#94a3b8] text-sm">No active BTC prediction markets found</p>
            <p className="text-[#64748b] text-xs mt-1">
              Signals appear when Polymarket has active Bitcoin up/down markets
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
