'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import type { MapGraph, MapNode, MapViewState, HoveredNode, Category } from './mapTypes';
import { useForceSimulation } from './useForceSimulation';
import { useMapRenderer } from './useMapRenderer';
import { useMapInteraction } from './useMapInteraction';

interface MapCanvasProps {
  graph: MapGraph;
  activeCategories: Set<Category>;
  searchQuery: string;
  viewState: MapViewState;
  onViewStateChange: (vs: MapViewState) => void;
  onNodeHover: (h: HoveredNode | null) => void;
  onNodeClick: (n: MapNode | null) => void;
  selectedNodeId: string | null;
  heldMarketIds?: Set<string>;
  watchlistedMarketIds?: Set<string>;
}

export function MapCanvas({
  graph,
  activeCategories,
  searchQuery,
  viewState,
  onViewStateChange,
  onNodeHover,
  onNodeClick,
  selectedNodeId,
  heldMarketIds,
  watchlistedMarketIds,
}: MapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  const { render } = useMapRenderer();

  // Track hovered ID for renderer
  const handleHover = useCallback(
    (h: HoveredNode | null) => {
      hoveredIdRef.current = h?.node.id ?? null;
      onNodeHover(h);
    },
    [onNodeHover],
  );

  // Render loop
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    render(ctx, {
      nodes: graph.nodes,
      edges: graph.edges,
      activeCategories,
      searchQuery,
      selectedNodeId,
      hoveredNodeId: hoveredIdRef.current,
      viewState,
      heldMarketIds,
      watchlistedMarketIds,
    });

    rafRef.current = requestAnimationFrame(drawFrame);
  }, [
    graph,
    activeCategories,
    searchQuery,
    selectedNodeId,
    viewState,
    render,
    heldMarketIds,
    watchlistedMarketIds,
  ]);

  // Force simulation
  const onTick = useCallback(() => {
    // Simulation ticked — the drawFrame loop will pick up new positions
  }, []);

  const { pinNode, unpinNode } = useForceSimulation({
    nodes: graph.nodes,
    edges: graph.edges,
    width: dimensions.width,
    height: dimensions.height,
    activeCategories,
    onTick,
  });

  // Interaction handlers
  const {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleMouseLeave,
  } = useMapInteraction({
    nodes: graph.nodes,
    viewState,
    onViewStateChange,
    onNodeHover: handleHover,
    onNodeClick,
    pinNode,
    unpinNode,
  });

  // Resize handler
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      setDimensions({ width: w, height: h });
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Start/stop render loop
  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawFrame]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 cursor-crosshair"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      onMouseLeave={handleMouseLeave}
    />
  );
}
