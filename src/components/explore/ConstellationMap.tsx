'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import type { Category, MapNode, MapEdge, MapGraph, HoveredNode, MapViewState } from './mapTypes';
import { ALL_CATEGORIES, computeRadius } from './mapConstants';
import { MapCanvas } from './MapCanvas';
import { MapTopBar } from './MapTopBar';
import { MapBottomBar } from './MapBottomBar';
import { MapSidebar } from './MapSidebar';
import { MapTooltip } from './MapTooltip';

// ─── API response types ───

interface ApiNode {
  id: string;
  title: string;
  category: string;
  price: number | null;
  volume: number;
  liquidity: number;
  endDate: string | null;
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
      change24h: 0,
      smartWalletCount: 0,
      signal: 'NEUTRAL' as const,
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

  const handleSidebarClose = useCallback(() => {
    setSelectedNode(null);
  }, []);

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
      />

      <MapTooltip hovered={hoveredNode} />
    </div>
  );
}
