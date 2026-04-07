import { useCallback, useRef } from 'react';
import type { MapNode, MapEdge, Category, MapViewState } from './mapTypes';
import {
  CATEGORY_COLORS,
  RENDER,
  HELD_RING_COLOR,
  HELD_RING_WIDTH_MIN,
  HELD_RING_GAP,
  WATCHLIST_MARKER_COLOR,
  WATCHLIST_MARKER_SIZE,
} from './mapConstants';

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
  /** Market ids the signed-in user currently holds. Drawn as green rings. */
  heldMarketIds?: Set<string>;
  /** Market ids the signed-in user has watchlisted. Drawn as star markers. */
  watchlistedMarketIds?: Set<string>;
}

export function useMapRenderer() {
  const connectedSetRef = useRef<Set<string>>(new Set());

  const render = useCallback(
    (ctx: CanvasRenderingContext2D, opts: RendererOpts) => {
      const {
        nodes,
        edges,
        activeCategories,
        searchQuery,
        selectedNodeId,
        hoveredNodeId,
        viewState,
        heldMarketIds,
        watchlistedMarketIds,
      } = opts;
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

        // ─── Personal portfolio overlay: green ring for held markets ───
        if (heldMarketIds && heldMarketIds.has(node.id)) {
          const ringWidth = Math.max(HELD_RING_WIDTH_MIN, radius * 0.25);
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + HELD_RING_GAP, 0, Math.PI * 2);
          ctx.strokeStyle = HELD_RING_COLOR;
          ctx.lineWidth = ringWidth / viewState.scale;
          ctx.stroke();
        }

        // ─── Watchlist marker: small star in the top-right quadrant ───
        if (watchlistedMarketIds && watchlistedMarketIds.has(node.id)) {
          const offsetAngle = -Math.PI / 4; // top-right
          const offsetR = radius + HELD_RING_GAP + 2;
          const cx = node.x + Math.cos(offsetAngle) * offsetR;
          const cy = node.y + Math.sin(offsetAngle) * offsetR;
          const size = WATCHLIST_MARKER_SIZE / viewState.scale;

          // 5-point star
          ctx.beginPath();
          for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? size : size * 0.45;
            const a = (Math.PI / 5) * i - Math.PI / 2;
            const px = cx + Math.cos(a) * r;
            const py = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = WATCHLIST_MARKER_COLOR;
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
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
