"use client";

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import { CATEGORY_COLORS } from '@/components/explore/mapConstants';
import type { CaseStudyDetail, CaseStudyMarket, CaseStudySeriesPoint } from './caseStudyTypes';

interface ChartPoint {
  // hours from trigger (can be negative)
  hoursFromTrigger: number;
  // dynamic: one key per market id containing normalized price delta
  [marketId: string]: number | null;
}

interface Props {
  study: CaseStudyDetail;
  /** Market IDs to render. If omitted, renders trigger + all affected. */
  selectedMarketIds?: Set<string>;
  /** Optional: market id currently highlighted (from row hover/click). */
  highlightedMarketId?: string | null;
}

/**
 * Overlay line chart for a case study.
 *
 * X axis: hours from trigger (negative = before, positive = after).
 * Y axis: normalized price delta — each series is rebased so price_at_trigger = 0.
 * A vertical reference line marks the trigger event at x=0.
 */
export function CaseStudyChart({ study, selectedMarketIds, highlightedMarketId }: Props) {
  const { data, marketList } = useMemo(() => {
    return buildChartData(study, selectedMarketIds);
  }, [study, selectedMarketIds]);

  if (data.length === 0) {
    return (
      <div className="border border-[rgba(255,255,255,0.06)] rounded-2xl bg-[#0d1117] p-8 text-center">
        <p className="text-sm text-[#64748b]">No series data available for this case study.</p>
      </div>
    );
  }

  return (
    <div className="border border-[rgba(255,255,255,0.06)] rounded-2xl bg-[#0d1117] p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-white text-sm font-semibold tracking-wide uppercase">
            Market Response
          </h2>
          <p className="text-[10px] text-[#64748b] tracking-[0.1em] uppercase mt-0.5">
            Normalized price delta · hours from trigger
          </p>
        </div>
      </div>
      <div className="h-[420px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 10 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4" />
            <XAxis
              dataKey="hoursFromTrigger"
              type="number"
              domain={['dataMin', 'dataMax']}
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
              tickFormatter={(v: number) => (v === 0 ? '0' : v > 0 ? `+${v}h` : `${v}h`)}
              stroke="rgba(255,255,255,0.08)"
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }}
              tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`}
              stroke="rgba(255,255,255,0.08)"
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0d1117',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 11,
              }}
              labelStyle={{ color: '#94a3b8', fontFamily: 'monospace' }}
              formatter={(value: number, name: string) => {
                const m = marketList.find((x) => x.marketId === name);
                return [
                  `${value > 0 ? '+' : ''}${(value * 100).toFixed(2)}%`,
                  m?.marketTitle ?? name,
                ];
              }}
              labelFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}h from trigger`}
            />
            <ReferenceLine
              x={0}
              stroke="#00d4ff"
              strokeDasharray="3 3"
              strokeWidth={1.5}
              label={{ value: 'TRIGGER', position: 'top', fill: '#00d4ff', fontSize: 9, fontFamily: 'monospace' }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
            {marketList.map((m) => {
              const color = colorForMarket(m, study.triggerMarketId);
              const isHighlighted = highlightedMarketId === m.marketId;
              const isDimmed = highlightedMarketId != null && !isHighlighted;
              return (
                <Line
                  key={m.marketId}
                  type="monotone"
                  dataKey={m.marketId}
                  stroke={color}
                  strokeWidth={
                    m.role === 'trigger'
                      ? 2.5
                      : isHighlighted
                        ? 3
                        : 1.5
                  }
                  strokeOpacity={isDimmed ? 0.2 : m.role === 'trigger' ? 1 : 0.85}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              );
            })}
            <Legend
              wrapperStyle={{ fontSize: 10, color: '#94a3b8' }}
              formatter={(_value, entry) => {
                const m = marketList.find((x) => x.marketId === entry.dataKey);
                const label = m?.marketTitle ?? entry.dataKey;
                return <span style={{ color: '#94a3b8' }}>{truncate(label as string, 40)}</span>;
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Data transform ───

function buildChartData(
  study: CaseStudyDetail,
  selectedMarketIds?: Set<string>,
): { data: ChartPoint[]; marketList: CaseStudyMarket[] } {
  const triggerMs = new Date(study.triggerTimestamp).getTime();

  // Pick which markets to show: trigger + top-ranked affected (or the user-specified set)
  const defaultLimit = 8;
  const marketList = selectedMarketIds
    ? study.markets.filter((m) => selectedMarketIds.has(m.marketId))
    : [
        ...study.markets.filter((m) => m.role === 'trigger'),
        ...study.markets.filter((m) => m.role !== 'trigger').slice(0, defaultLimit),
      ];

  if (marketList.length === 0) return { data: [], marketList: [] };

  const marketIds = new Set(marketList.map((m) => m.marketId));

  // Group series by market
  const byMarket = new Map<string, CaseStudySeriesPoint[]>();
  for (const p of study.series) {
    if (!marketIds.has(p.marketId)) continue;
    const arr = byMarket.get(p.marketId) ?? [];
    arr.push(p);
    byMarket.set(p.marketId, arr);
  }

  // Compute each market's baseline price (closest-to-trigger snapshot)
  const baseline = new Map<string, number>();
  for (const [mid, rows] of byMarket) {
    let best: { diff: number; price: number } | null = null;
    for (const r of rows) {
      if (r.yesPrice == null) continue;
      const diff = Math.abs(new Date(r.timestamp).getTime() - triggerMs);
      if (!best || diff < best.diff) best = { diff, price: r.yesPrice };
    }
    if (best) baseline.set(mid, best.price);
  }

  // Bucket by hour-from-trigger and compute normalized delta
  const bucketMap = new Map<number, ChartPoint>();
  const hourMs = 60 * 60 * 1000;
  for (const [mid, rows] of byMarket) {
    const base = baseline.get(mid);
    if (base == null) continue;
    for (const r of rows) {
      if (r.yesPrice == null) continue;
      const hours = Math.round((new Date(r.timestamp).getTime() - triggerMs) / hourMs);
      const point = bucketMap.get(hours) ?? { hoursFromTrigger: hours };
      point[mid] = r.yesPrice - base;
      bucketMap.set(hours, point);
    }
  }

  const data = Array.from(bucketMap.values()).sort(
    (a, b) => a.hoursFromTrigger - b.hoursFromTrigger,
  );

  return { data, marketList };
}

function colorForMarket(m: CaseStudyMarket, triggerMarketId: string | null): string {
  if (m.role === 'trigger' || m.marketId === triggerMarketId) return '#00d4ff';
  const cat = m.category as keyof typeof CATEGORY_COLORS;
  return CATEGORY_COLORS[cat] ?? '#94a3b8';
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
