'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import type {
  Category,
  MapNode,
  MapEdge,
  MapGraph,
  HoveredNode,
  HoveredBubble,
  MapViewState,
  OrbitBubble,
} from './mapTypes';
import { ALL_CATEGORIES, computeRadius } from './mapConstants';
import { MapCanvas } from './MapCanvas';
import { MapTopBar } from './MapTopBar';
import { MapBottomBar } from './MapBottomBar';
import { MapSidebar } from './MapSidebar';
import { MapTooltip } from './MapTooltip';
import { PortfolioHud } from './PortfolioHud';
import { LinkWalletModal } from './LinkWalletModal';
import { useOwnedPositions } from './useOwnedPositions';
import { useWatchlist } from './useWatchlist';
import { MarketWallet } from './lib/wallets';
import { useWalletBloom } from './useWalletBloom';

// Bubblemaps-style bloom caps the visible wallet count. Beyond ~30 the orbit
// packs too tight for the physics sim to read — sidebar still lists all 50.
const BLOOM_BUBBLE_CAP = 30;

// ─── API response types ───

interface ApiNode {
  id: string;
  title: string;
  category: string;
  price: number | null;
  volume: number;
  liquidity: number;
  endDate: string | null;
  priceChange: number;
  smartWalletCount: number;
  insiderCount: number;
  signal: string;
}

interface ApiEdge {
  source: string;
  target: string;
  weight: number;
  walletOverlap: number;
  sharedWallets: number;
  priceCorrelation: number | null;
  corrSamples: number | null;
}

interface ApiResponse {
  nodes: ApiNode[];
  edges: ApiEdge[];
  generatedAt: string;
}

// ─── Transform API → MapGraph ───

const VALID_CATEGORIES = new Set<Category>(ALL_CATEGORIES);

function toCategory(raw: string): Category {
  if (VALID_CATEGORIES.has(raw as Category)) return raw as Category;
  return 'economics'; // fallback for 'other' or unknown
}

function transformResponse(data: ApiResponse): MapGraph {
  const nodes: MapNode[] = data.nodes.map((n) => {
    const probability = n.price ?? 0;
    const volume24h = n.volume ?? 0;

    return {
      id: n.id,
      label: n.title.length > 42 ? n.title.slice(0, 42) + '...' : n.title,
      fullLabel: n.title,
      category: toCategory(n.category),
      probability,
      volume24h,
      totalVolume: volume24h,
      liquidity: n.liquidity ?? 0,
      change24h: n.priceChange ?? 0,
      smartWalletCount: n.smartWalletCount ?? 0,
      insiderCount: n.insiderCount ?? 0,
      signal: (n.signal ?? 'NEUTRAL') as 'BUY' | 'SELL' | 'NEUTRAL',
      endDate: n.endDate,
      radius: computeRadius(volume24h),
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));

  const edges: MapEdge[] = data.edges
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      type: e.priceCorrelation != null ? 'correlated' as const : 'shared-wallet' as const,
    }));

  return { nodes, edges };
}

// ─── Component ───

export function ConstellationMap() {
  const [graph, setGraph] = useState<MapGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    () => new Set(ALL_CATEGORIES),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [viewState, setViewState] = useState<MapViewState>({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });

  // ─── Personal portfolio overlay ───
  const { isSignedIn } = useUser();
  const {
    wallets: linkedWallets,
    heldMap,
    heldSet,
    totals: portfolioTotals,
    refetch: refetchPositions,
  } = useOwnedPositions();
  const { watchlistedSet, toggle: toggleWatchlist } = useWatchlist();
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  // ─── Wallets for the selected market (drives sidebar rows + orbit bubbles) ───
  const [marketWallets, setMarketWallets] = useState<MarketWallet[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(false);

  useEffect(() => {
    if (!selectedNode) {
      setMarketWallets([]);
      setWalletsLoading(false);
      return;
    }
    const controller = new AbortController();
    setWalletsLoading(true);
    setMarketWallets([]);
    fetch(`/api/markets/${encodeURIComponent(selectedNode.id)}/wallets`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : { wallets: [] }))
      .then((j: { wallets?: MarketWallet[] }) => {
        setMarketWallets(j.wallets ?? []);
        setWalletsLoading(false);
      })
      .catch((err) => {
        if (err?.name !== 'AbortError') setWalletsLoading(false);
      });
    return () => controller.abort();
  }, [selectedNode]);

  // Bloom state — separate from selectedNode so collapse can unwind in two steps:
  // focused wallet unwinds first (Escape 1), then the bloom itself (Escape 2).
  const [focusedWallet, setFocusedWallet] = useState<string | null>(null);
  const [focusedBubble, setFocusedBubble] = useState<OrbitBubble | null>(null);
  const [walletPositionIds, setWalletPositionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [hoveredBubble, setHoveredBubble] = useState<HoveredBubble | null>(null);

  const bloomWallets = useMemo(
    () => marketWallets.slice(0, BLOOM_BUBBLE_CAP),
    [marketWallets],
  );
  const overflowCount = Math.max(0, marketWallets.length - BLOOM_BUBBLE_CAP);

  const { bubblesRef, bloomProgressRef } = useWalletBloom({
    expandedNodeId: selectedNode?.id ?? null,
    parent: selectedNode ?? null,
    wallets: bloomWallets,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/constellation');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiResponse = await res.json();
      setGraph(transformResponse(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load constellation data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleCategory = useCallback((cat: Category) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const handleNodeClick = useCallback((node: MapNode | null) => {
    setSelectedNode(node);
  }, []);

  const handleNodeHover = useCallback((hovered: HoveredNode | null) => {
    setHoveredNode(hovered);
  }, []);

  const clearFocusedWallet = useCallback(() => {
    setFocusedWallet(null);
    setFocusedBubble(null);
    setWalletPositionIds(new Set());
  }, []);

  const handleSidebarClose = useCallback(() => {
    setSelectedNode(null);
    clearFocusedWallet();
  }, [clearFocusedWallet]);

  const handleSelectWallet = useCallback(
    async (address: string) => {
      const bubble = bubblesRef.current.find((b) => b.address === address) ?? null;
      setFocusedWallet(address);
      setFocusedBubble(bubble);
      try {
        const res = await fetch(
          `/api/constellation/wallet/${encodeURIComponent(address)}`,
        );
        if (!res.ok) {
          setWalletPositionIds(new Set());
          return;
        }
        const data = (await res.json()) as { positions?: { marketId: string }[] };
        setWalletPositionIds(
          new Set((data.positions ?? []).map((p) => p.marketId)),
        );
      } catch {
        setWalletPositionIds(new Set());
      }
    },
    [bubblesRef],
  );

  // Escape unwinds in two steps: focused wallet first, then selected node.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (focusedWallet) {
        clearFocusedWallet();
      } else if (selectedNode) {
        setSelectedNode(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusedWallet, selectedNode, clearFocusedWallet]);

  // Loading state
  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#04040B] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 text-[#475569] animate-spin" />
          <span className="text-[#475569] text-xs">Loading constellation data...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="fixed inset-0 bg-[#04040B] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#EF4444] text-sm mb-2">Failed to load</p>
          <p className="text-[#475569] text-xs mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-1.5 text-xs text-[#94a3b8] border border-white/10 rounded hover:text-white transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="fixed inset-0 bg-[#04040B] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#94a3b8] text-sm">No market data available</p>
          <p className="text-[#475569] text-xs mt-1">The pipeline may not have run yet</p>
        </div>
      </div>
    );
  }

  const hasLinkedWallets = linkedWallets.length > 0;
  const selectedUserPosition = selectedNode ? heldMap.get(selectedNode.id) : undefined;

  return (
    <div className="fixed inset-0 bg-[#04040B] overflow-hidden">
      <MapCanvas
        graph={graph}
        activeCategories={activeCategories}
        searchQuery={searchQuery}
        viewState={viewState}
        onViewStateChange={setViewState}
        onNodeHover={handleNodeHover}
        onNodeClick={handleNodeClick}
        selectedNodeId={selectedNode?.id ?? null}
        heldMarketIds={heldSet}
        watchlistedMarketIds={watchlistedSet}
        bubblesRef={bubblesRef}
        bloomProgressRef={bloomProgressRef}
        expandedNodeId={selectedNode?.id ?? null}
        walletPositionIds={walletPositionIds}
        focusedBubble={focusedBubble}
        onBubbleHover={setHoveredBubble}
        onSelectWallet={handleSelectWallet}
      />

      <MapTopBar
        activeCategories={activeCategories}
        onToggleCategory={handleToggleCategory}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      <MapBottomBar
        nodeCount={graph.nodes.length}
        edgeCount={graph.edges.length}
        totalVolume={graph.nodes.reduce((s, n) => s + n.totalVolume, 0)}
      />

      <MapSidebar
        node={selectedNode}
        graph={graph}
        onClose={handleSidebarClose}
        onSelectNode={handleNodeClick}
        userPosition={selectedUserPosition}
        isWatchlisted={selectedNode ? watchlistedSet.has(selectedNode.id) : false}
        onToggleWatchlist={toggleWatchlist}
        canWatchlist={Boolean(isSignedIn)}
        wallets={marketWallets}
        walletsLoading={walletsLoading}
      />

      {hasLinkedWallets ? (
        <PortfolioHud
          totals={portfolioTotals}
          walletCount={linkedWallets.length}
          watchingCount={watchlistedSet.size}
          onClick={() => setWalletModalOpen(true)}
        />
      ) : isSignedIn ? (
        <button
          onClick={() => setWalletModalOpen(true)}
          className="fixed bottom-12 left-4 z-20 flex items-center gap-1.5 bg-[#04040B]/90 backdrop-blur-2xl border border-white/[0.08] hover:border-[#10B981]/40 rounded-xl px-3.5 py-2 text-[11px] font-medium text-[#94A3B8] hover:text-white transition-colors shadow-lg"
        >
          <Wallet className="h-3.5 w-3.5 text-[#10B981]" />
          Link Wallet
        </button>
      ) : null}

      <LinkWalletModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onChange={refetchPositions}
      />

      <MapTooltip hovered={hoveredBubble ?? hoveredNode} />

      {selectedNode && overflowCount > 0 && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-20 text-[10px] font-mono tracking-[0.14em] uppercase text-[#94A3B8] bg-[#04040B]/85 border border-white/[0.08] rounded-full px-3 py-1 pointer-events-none">
          +{overflowCount} more wallets in sidebar
        </div>
      )}
    </div>
  );
}
