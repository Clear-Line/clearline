import { useCallback, useRef } from 'react';
import type { MapNode, MapEdge, Category, MapViewState } from './mapTypes';
import { CATEGORY_COLORS, RENDER } from './mapConstants';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface RendererOpts {
  nodes: MapNode[];
  edges: MapEdge[];
  activeCategories: Set<Category>;
  searchQuery: string;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  viewState: MapViewState;
}

export function useMapRenderer() {
  const connectedSetRef = useRef<Set<string>>(new Set());

  const render = useCallback(
    (ctx: CanvasRenderingContext2D, opts: RendererOpts) => {
      const { nodes, edges, activeCategories, searchQuery, selectedNodeId, hoveredNodeId, viewState } = opts;
      const { width, height } = ctx.canvas;
      const dpr = window.devicePixelRatio || 1;
      const w = width / dpr;
      const h = height / dpr;

      // Build connected set for selected/hovered node
      const focusId = selectedNodeId || hoveredNodeId;
      const connectedSet = connectedSetRef.current;
      connectedSet.clear();
      if (focusId) {
        connectedSet.add(focusId);
        for (const e of edges) {
          const srcId = typeof e.source === 'string' ? e.source : (e.source as MapNode).id;
          const tgtId = typeof e.target === 'string' ? e.target : (e.target as MapNode).id;
          if (srcId === focusId) connectedSet.add(tgtId);
          if (tgtId === focusId) connectedSet.add(srcId);
        }
      }

      // Search filter
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch = (node: MapNode) =>
        !query || node.fullLabel.toLowerCase().includes(query);

      const isActive = (node: MapNode) =>
        activeCategories.has(node.category) && matchesSearch(node);

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.translate(viewState.offsetX, viewState.offsetY);
      ctx.scale(viewState.scale, viewState.scale);

      // ─── Edges ───
      for (const edge of edges) {
        const src = typeof edge.source === 'object' ? (edge.source as MapNode) : nodes.find((n) => n.id === edge.source);
        const tgt = typeof edge.target === 'object' ? (edge.target as MapNode) : nodes.find((n) => n.id === edge.target);
        if (!src || !tgt || src.x == null || src.y == null || tgt.x == null || tgt.y == null) continue;

        const srcActive = isActive(src);
        const tgtActive = isActive(tgt);
        if (!srcActive && !tgtActive) continue;

        const srcId = src.id;
        const tgtId = tgt.id;
        const isConnected = focusId && (connectedSet.has(srcId) && connectedSet.has(tgtId));

        let alpha: number;
        let lineWidth: number;

        if (isConnected) {
          alpha = RENDER.edgeHighlightAlpha;
          lineWidth = Math.max(1, edge.weight * RENDER.edgeHighlightWeightMultiplier);
        } else if (src.category === tgt.category) {
          alpha = RENDER.edgeIntraCategoryAlpha;
          lineWidth = Math.max(RENDER.edgeMinWidth, edge.weight * RENDER.edgeWeightMultiplier);
        } else {
          alpha = RENDER.edgeCrossCategoryAlpha;
          lineWidth = RENDER.edgeMinWidth;
        }

        // Use source category color for same-category, white for cross
        let edgeColor: string;
        if (src.category === tgt.category) {
          const [r, g, b] = hexToRgb(CATEGORY_COLORS[src.category]);
          edgeColor = `rgba(${r},${g},${b},${alpha})`;
        } else {
          edgeColor = `rgba(255,255,255,${alpha})`;
        }

        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = lineWidth / viewState.scale; // consistent visual width
        ctx.stroke();
      }

      // ─── Nodes ───
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;

        const active = isActive(node);
        const isHovered = node.id === hoveredNodeId;
        const isSelected = node.id === selectedNodeId;
        const isConnectedToFocus = focusId ? connectedSet.has(node.id) : false;

        const baseAlpha = active
          ? isHovered || isSelected
            ? 1.0
            : isConnectedToFocus
              ? 0.95
              : focusId
                ? 0.3
                : RENDER.nodeFillAlpha
          : RENDER.filteredOutAlpha;

        const [r, g, b] = hexToRgb(CATEGORY_COLORS[node.category]);
        const radius = node.radius;

        // Glow halo (skip for filtered-out nodes)
        if (active && baseAlpha > 0.15) {
          const glowRadius = isHovered
            ? radius * RENDER.hoverGlowMultiplier
            : isSelected
              ? radius * (RENDER.breatheMin + (RENDER.breatheMax - RENDER.breatheMin) * (0.5 + 0.5 * Math.sin(Date.now() * RENDER.breatheSpeed)))
              : radius * RENDER.nodeGlowMultiplier;

          const gradient = ctx.createRadialGradient(node.x, node.y, radius * 0.3, node.x, node.y, glowRadius);
          gradient.addColorStop(0, `rgba(${r},${g},${b},${RENDER.nodeGlowAlpha * (isHovered ? 1.5 : 1)})`);
          gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        // Fill circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${baseAlpha})`;
        ctx.fill();

        // Selected ring
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
          ctx.strokeStyle = RENDER.selectedStrokeColor;
          ctx.lineWidth = RENDER.selectedStrokeWidth / viewState.scale;
          ctx.stroke();
        }

        // Labels — only on larger bubbles to avoid clutter
        if (active && viewState.scale > RENDER.labelMinScale && radius > RENDER.labelMinRadius) {
          const fontSize = Math.max(RENDER.labelFontMin, Math.min(RENDER.labelFontMax, radius * 0.55));
          ctx.font = `500 ${fontSize / viewState.scale}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = `rgba(226,232,240,${RENDER.labelAlpha})`;

          // Scale max characters to bubble size — bigger bubbles get more text
          const maxLen = Math.min(24, Math.max(12, Math.floor(radius * 0.7)));
          const text = node.label.length > maxLen ? node.label.slice(0, maxLen) + '...' : node.label;
          ctx.fillText(text, node.x, node.y + radius + 10 / viewState.scale);
        }
      }

      ctx.restore();
    },
    [],
  );

  return { render };
}
