'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, TrendingDown, DollarSign, Clock, Droplets, Users, Star } from 'lucide-react';
import type { MapNode, MapGraph, ConnectedMarket, UserPosition } from './mapTypes';
import { CATEGORY_COLORS, CATEGORY_LABELS } from './mapConstants';
import {
  MarketWallet,
  formatAccuracy,
  formatMarketsTraded,
} from './lib/wallets';

interface MapSidebarProps {
  node: MapNode | null;
  graph: MapGraph;
  onClose: () => void;
  onSelectNode: (node: MapNode | null) => void;
  /** Present iff the signed-in user holds this market across any linked wallet. */
  userPosition?: UserPosition;
  /** True iff the signed-in user has watchlisted this market. */
  isWatchlisted?: boolean;
  /** Toggles the watchlist state for the currently selected market. */
  onToggleWatchlist?: (marketId: string) => void;
  /** Hides the star button when the user is signed out or not subscribed. */
  canWatchlist?: boolean;
  /** Wallets active in the selected market. Loaded by the parent. */
  wallets: MarketWallet[];
  walletsLoading: boolean;
}

type Tab = 'wallets' | 'connected' | 'stats';

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

function formatMoney(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(abs < 10 ? 2 : 0)}`;
}

function formatSignedMoney(n: number): string {
  if (n === 0) return '$0';
  const sign = n > 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(n)).replace(/^-/, '')}`;
}

export function MapSidebar({
  node,
  graph,
  onClose,
  onSelectNode,
  userPosition,
  isWatchlisted,
  onToggleWatchlist,
  canWatchlist,
  wallets,
  walletsLoading,
}: MapSidebarProps) {
  const [tab, setTab] = useState<Tab>('wallets');

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
          className="fixed top-16 right-0 bottom-9 z-20 w-[320px] bg-[#04040B]/90 backdrop-blur-2xl border-l border-white/[0.06] flex flex-col"
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
              <div className="flex items-center gap-1">
                {canWatchlist && onToggleWatchlist && (
                  <button
                    onClick={() => onToggleWatchlist(node.id)}
                    className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${
                      isWatchlisted
                        ? 'text-[#FBBF24] hover:text-[#FBBF24]/80 hover:bg-[#FBBF24]/10'
                        : 'text-[#475569] hover:text-[#FBBF24] hover:bg-white/[0.06]'
                    }`}
                    aria-label={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                    title={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    <Star className={`h-4 w-4 ${isWatchlisted ? 'fill-current' : ''}`} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="h-7 w-7 flex items-center justify-center rounded-lg text-[#475569] hover:text-white hover:bg-white/[0.06] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
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
            {node.insiderCount > 0 ? (
              <Stat icon={<Users className="h-3 w-3 text-[#475569]" />} label="Insider Wallets" value={String(node.insiderCount)} />
            ) : (
              <Stat icon={<Clock className="h-3 w-3 text-[#475569]" />} label="Ends" value={formatDate(node.endDate)} />
            )}
          </div>

          {/* Your Position — only when the signed-in user holds this market */}
          {userPosition && <YourPositionBlock position={userPosition} />}

          {/* Tabs */}
          <div className="px-5 pt-3.5 shrink-0">
            <div className="flex gap-0.5 bg-white/[0.03] rounded-lg p-0.5">
              {(['wallets', 'connected', 'stats'] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-1.5 rounded-md text-[9px] font-medium tracking-[0.14em] uppercase text-center transition-colors ${
                    tab === t
                      ? 'bg-white/[0.06] text-[#E2E8F0]'
                      : 'text-[#475569] hover:text-[#64748b]'
                  }`}
                >
                  {t === 'wallets' ? 'Wallets' : t === 'connected' ? 'Connected' : 'Stats'}
                </button>
              ))}
            </div>
          </div>

          {/* Tab content */}
          <div className="px-5 pt-3 pb-5 flex-1 overflow-y-auto min-h-0">
            {tab === 'wallets' && (
              <WalletsTab wallets={wallets} loading={walletsLoading} />
            )}

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

function WalletsTab({ wallets, loading }: { wallets: MarketWallet[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2 py-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded bg-white/[0.02] animate-pulse" />
        ))}
      </div>
    );
  }

  if (wallets.length === 0) {
    return <p className="text-[#475569] text-xs py-4 text-center">No wallet activity yet</p>;
  }

  return (
    <div>
      {wallets.map((w) => (
        <div
          key={w.address}
          className="py-2.5 border-b border-white/[0.03] flex items-center justify-between gap-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-[#94A3B8] truncate">
                {w.username ?? w.addressShort}
              </span>
              <span
                className="text-[8px] font-mono font-semibold tracking-[0.14em]"
                style={{ color: w.side === 'BUY' ? '#10B981' : '#EF4444' }}
              >
                {w.side}
              </span>
            </div>
            <div className="text-[9px] text-[#475569] font-mono mt-0.5">
              {formatAccuracy(w.accuracyScore)} acc · {formatMarketsTraded(w.totalMarketsTraded)}
            </div>
          </div>
          <div className="text-[11px] font-mono text-[#E2E8F0] shrink-0">
            {formatVolume(w.volume)}
          </div>
        </div>
      ))}
    </div>
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

function YourPositionBlock({ position }: { position: UserPosition }) {
  const pnl = position.unrealizedPnl;
  const pnlPct = position.unrealizedPnlPct;
  const isUp = pnl >= 0;
  const color = isUp ? '#10B981' : '#EF4444';
  const sideColor = position.side === 'BUY' ? '#10B981' : '#EF4444';

  return (
    <div className="px-5 py-3.5 border-b border-white/[0.04] shrink-0 bg-[#10B981]/[0.03]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: '#10B981' }}
          />
          <span className="text-[9px] tracking-[0.16em] uppercase text-[#10B981] font-medium">
            Your Position
          </span>
        </div>
        <span
          className="text-[9px] tracking-[0.14em] uppercase font-mono font-semibold"
          style={{ color: sideColor }}
        >
          {position.side}
        </span>
      </div>

      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[18px] font-semibold text-white font-mono tracking-tight">
          {formatMoney(position.invested)}
        </span>
        <span className="text-[10px] text-[#64748b] font-mono">
          @ {position.avgPrice.toFixed(2)}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[#475569] font-mono">
          Now {position.currentPrice.toFixed(2)} → {formatMoney(position.currentValue)}
        </span>
        <span
          className="text-[11px] font-mono font-semibold flex items-center gap-0.5"
          style={{ color }}
        >
          {isUp ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          {formatSignedMoney(pnl)} ({isUp ? '+' : ''}
          {pnlPct.toFixed(1)}%)
        </span>
      </div>

      {position.wallets.length > 1 && (
        <div className="text-[9px] text-[#374151] font-mono mt-1.5">
          across {position.wallets.length} wallets • {position.trades} trades
        </div>
      )}
    </div>
  );
}
