'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, TrendingDown, DollarSign, Clock, Droplets } from 'lucide-react';
import type { MapNode, MapGraph, ConnectedMarket } from './mapTypes';
import { CATEGORY_COLORS, CATEGORY_LABELS } from './mapConstants';

interface MapSidebarProps {
  node: MapNode | null;
  graph: MapGraph;
  onClose: () => void;
  onSelectNode: (node: MapNode | null) => void;
}

type Tab = 'connected' | 'stats';

function formatVolume(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getConnected(nodeId: string, graph: MapGraph): ConnectedMarket[] {
  const connected: ConnectedMarket[] = [];
  for (const edge of graph.edges) {
    const otherId = edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : null;
    if (!otherId) continue;
    const other = graph.nodes.find((n) => n.id === otherId);
    if (!other) continue;
    connected.push({
      id: other.id,
      label: other.fullLabel,
      category: other.category,
      probability: other.probability,
      overlapStrength: edge.weight,
    });
  }
  return connected.sort((a, b) => b.overlapStrength - a.overlapStrength).slice(0, 15);
}

export function MapSidebar({ node, graph, onClose, onSelectNode }: MapSidebarProps) {
  const [tab, setTab] = useState<Tab>('connected');

  const connected = useMemo(() => (node ? getConnected(node.id, graph) : []), [node, graph]);

  return (
    <AnimatePresence>
      {node && (
        <motion.div
          key={node.id}
          initial={{ x: 320 }}
          animate={{ x: 0 }}
          exit={{ x: 320 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          className="fixed top-12 right-0 bottom-9 z-20 w-[320px] bg-[#04040B]/90 backdrop-blur-2xl border-l border-white/[0.06] flex flex-col"
        >
          {/* Header */}
          <div className="px-5 pt-5 pb-4 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[node.category] }}
                />
                <span className="text-[9px] tracking-[0.16em] uppercase text-[#475569]">
                  {CATEGORY_LABELS[node.category]}
                </span>
              </div>
              <button
                onClick={onClose}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-[#475569] hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-[15px] font-medium text-white leading-[1.4] mt-3 line-clamp-3">
              {node.fullLabel}
            </p>

            <div className="flex items-baseline gap-2 mt-2">
              <span className="text-[28px] font-semibold text-white font-mono tracking-tight">
                {Math.round(node.probability * 100)}%
              </span>
              {node.change24h !== 0 && (
                <span
                  className={`text-[13px] font-medium font-mono flex items-center gap-0.5 ${
                    node.change24h >= 0 ? 'text-[#10B981]' : 'text-[#EF4444]'
                  }`}
                >
                  {node.change24h >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" />
                  )}
                  {node.change24h >= 0 ? '+' : ''}{(node.change24h * 100).toFixed(1)}%
                </span>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="flex gap-5 px-5 py-3.5 border-y border-white/[0.04] shrink-0">
            <Stat icon={<DollarSign className="h-3 w-3 text-[#475569]" />} label="Volume" value={formatVolume(node.volume24h)} />
            <Stat icon={<Droplets className="h-3 w-3 text-[#475569]" />} label="Liquidity" value={formatVolume(node.liquidity)} />
            <Stat icon={<Clock className="h-3 w-3 text-[#475569]" />} label="Ends" value={formatDate(node.endDate)} />
          </div>

          {/* Tabs */}
          <div className="px-5 pt-3.5 shrink-0">
            <div className="flex gap-0.5 bg-white/[0.03] rounded-lg p-0.5">
              {(['connected', 'stats'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-1.5 rounded-md text-[9px] font-medium tracking-[0.14em] uppercase text-center transition-colors ${
                    tab === t
                      ? 'bg-white/[0.06] text-[#E2E8F0]'
                      : 'text-[#475569] hover:text-[#64748b]'
                  }`}
                >
                  {t === 'connected' ? 'Connected' : 'Stats'}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="px-5 pt-3 pb-5 flex-1 overflow-y-auto min-h-0">
            {tab === 'connected' && (
              <div>
                {connected.length === 0 ? (
                  <p className="text-[#475569] text-xs py-4 text-center">No connected markets yet</p>
                ) : (
                  connected.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        const n = graph.nodes.find((n) => n.id === c.id);
                        if (n) onSelectNode(n);
                      }}
                      className="w-full py-2.5 border-b border-white/[0.03] text-left hover:bg-white/[0.02] transition-colors"
                    >
                      <p className="text-[12px] text-[#94A3B8] line-clamp-1">{c.label}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className="w-1 h-1 rounded-full"
                          style={{ backgroundColor: CATEGORY_COLORS[c.category] }}
                        />
                        <span className="text-[10px] font-mono text-[#475569]">
                          {Math.round(c.probability * 100)}%
                        </span>
                        <span className="text-[10px] font-mono text-[#475569]">
                          {Math.round(c.overlapStrength * 100)}% overlap
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {tab === 'stats' && (
              <div className="grid grid-cols-2 gap-3">
                <StatCell label="24h Volume" value={formatVolume(node.volume24h)} />
                <StatCell label="Total Volume" value={formatVolume(node.totalVolume)} />
                <StatCell label="Liquidity" value={formatVolume(node.liquidity)} />
                <StatCell
                  label="Ends"
                  value={formatDate(node.endDate)}
                />
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {icon}
        <span className="text-[8px] tracking-[0.18em] uppercase text-[#374151]">{label}</span>
      </div>
      <span className="text-[13px] text-[#94A3B8] font-mono">{value}</span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[8px] tracking-[0.18em] uppercase text-[#374151] mb-1">{label}</div>
      <div className="text-[14px] text-[#E2E8F0] font-mono">{value}</div>
    </div>
  );
}
