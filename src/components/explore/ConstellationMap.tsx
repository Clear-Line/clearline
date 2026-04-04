'use client';

import { useState, useMemo, useCallback } from 'react';
import type { Category, MapNode, HoveredNode, MapViewState } from './mapTypes';
import { ALL_CATEGORIES } from './mapConstants';
import { getMockGraph } from './mockData';
import { MapCanvas } from './MapCanvas';
import { MapTopBar } from './MapTopBar';
import { MapBottomBar } from './MapBottomBar';
import { MapSidebar } from './MapSidebar';
import { MapTooltip } from './MapTooltip';

export function ConstellationMap() {
  const graph = useMemo(() => getMockGraph(), []);

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
