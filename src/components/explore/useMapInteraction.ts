import { useCallback, useRef } from 'react';
import type { MapNode, MapViewState, HoveredNode, OrbitBubble, HoveredBubble } from './mapTypes';
import { INTERACTION } from './mapConstants';

interface InteractionOpts {
  nodes: MapNode[];
  viewState: MapViewState;
  onViewStateChange: (vs: MapViewState) => void;
  onNodeHover: (h: HoveredNode | null) => void;
  onNodeClick: (n: MapNode | null) => void;
  pinNode: (node: MapNode, x: number, y: number) => void;
  unpinNode: (node: MapNode) => void;
  /** Live wallet orbit bubbles — hit-tested before nodes so they take priority. */
  getBubbles?: () => OrbitBubble[];
  onBubbleHover?: (h: HoveredBubble | null) => void;
  onSelectWallet?: (address: string) => void;
}

export function useMapInteraction({
  nodes,
  viewState,
  onViewStateChange,
  onNodeHover,
  onNodeClick,
  pinNode,
  unpinNode,
  getBubbles,
  onBubbleHover,
  onSelectWallet,
}: InteractionOpts) {
  const draggingRef = useRef<MapNode | null>(null);
  const clickedBubbleRef = useRef<OrbitBubble | null>(null);
  const panningRef = useRef(false);
  const mouseDownRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastViewRef = useRef(viewState);
  lastViewRef.current = viewState;

  const screenToWorld = useCallback(
    (sx: number, sy: number): { x: number; y: number } => {
      const vs = lastViewRef.current;
      return {
        x: (sx - vs.offsetX) / vs.scale,
        y: (sy - vs.offsetY) / vs.scale,
      };
    },
    [],
  );

  const hitTest = useCallback(
    (sx: number, sy: number): MapNode | null => {
      const world = screenToWorld(sx, sy);
      let closest: MapNode | null = null;
      let closestDist = Infinity;

      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
        const dx = node.x - world.x;
        const dy = node.y - world.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Add a small padding for easier clicking
        if (dist < node.radius + 4 && dist < closestDist) {
          closest = node;
          closestDist = dist;
        }
      }
      return closest;
    },
    [nodes, screenToWorld],
  );

  const hitTestBubble = useCallback(
    (sx: number, sy: number): OrbitBubble | null => {
      if (!getBubbles) return null;
      const bubbles = getBubbles();
      if (bubbles.length === 0) return null;
      const world = screenToWorld(sx, sy);
      let closest: OrbitBubble | null = null;
      let closestDist = Infinity;
      for (const b of bubbles) {
        if (b.radius < 1) continue;
        const dx = b.x - world.x;
        const dy = b.y - world.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < b.radius + 2 && dist < closestDist) {
          closest = b;
          closestDist = dist;
        }
      }
      return closest;
    },
    [getBubbles, screenToWorld],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      mouseDownRef.current = { x: sx, y: sy, time: Date.now() };

      // Bubbles render on top of nodes, so they should take hit-priority too.
      const bubble = hitTestBubble(sx, sy);
      if (bubble) {
        clickedBubbleRef.current = bubble;
        return;
      }

      const hit = hitTest(sx, sy);
      if (hit) {
        draggingRef.current = hit;
      } else {
        panningRef.current = true;
      }
    },
    [hitTest, hitTestBubble],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const vs = lastViewRef.current;

      if (draggingRef.current) {
        const world = screenToWorld(sx, sy);
        pinNode(draggingRef.current, world.x, world.y);
        return;
      }

      if (panningRef.current && mouseDownRef.current) {
        const dx = sx - mouseDownRef.current.x;
        const dy = sy - mouseDownRef.current.y;
        mouseDownRef.current = { x: sx, y: sy, time: mouseDownRef.current.time };
        onViewStateChange({
          ...vs,
          offsetX: vs.offsetX + dx,
          offsetY: vs.offsetY + dy,
        });
        return;
      }

      // Hover detection — bubbles win over nodes.
      const bubble = hitTestBubble(sx, sy);
      if (bubble) {
        onBubbleHover?.({ bubble, screenX: e.clientX, screenY: e.clientY });
        onNodeHover(null);
        return;
      }
      onBubbleHover?.(null);
      const hit = hitTest(sx, sy);
      if (hit) {
        onNodeHover({ node: hit, screenX: e.clientX, screenY: e.clientY });
      } else {
        onNodeHover(null);
      }
    },
    [hitTest, hitTestBubble, screenToWorld, onNodeHover, onBubbleHover, onViewStateChange, pinNode],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const down = mouseDownRef.current;

      if (clickedBubbleRef.current) {
        if (down) {
          const dist = Math.sqrt((sx - down.x) ** 2 + (sy - down.y) ** 2);
          const elapsed = Date.now() - down.time;
          if (dist < INTERACTION.clickThresholdPx && elapsed < INTERACTION.clickThresholdMs) {
            onSelectWallet?.(clickedBubbleRef.current.address);
          }
        }
        clickedBubbleRef.current = null;
        mouseDownRef.current = null;
        return;
      }

      if (draggingRef.current) {
        // Check if it was a click (not a drag)
        if (down) {
          const dist = Math.sqrt((sx - down.x) ** 2 + (sy - down.y) ** 2);
          const elapsed = Date.now() - down.time;
          if (dist < INTERACTION.clickThresholdPx && elapsed < INTERACTION.clickThresholdMs) {
            onNodeClick(draggingRef.current);
          }
        }
        unpinNode(draggingRef.current);
        draggingRef.current = null;
      } else if (panningRef.current) {
        // Check if it was a click on empty space
        if (down) {
          const dist = Math.sqrt((sx - down.x) ** 2 + (sy - down.y) ** 2);
          const elapsed = Date.now() - down.time;
          if (dist < INTERACTION.clickThresholdPx && elapsed < INTERACTION.clickThresholdMs) {
            onNodeClick(null);
          }
        }
        panningRef.current = false;
      }

      mouseDownRef.current = null;
    },
    [onNodeClick, unpinNode, onSelectWallet],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const vs = lastViewRef.current;
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = 1 - e.deltaY * INTERACTION.zoomSensitivity;
      const newScale = Math.max(INTERACTION.zoomMin, Math.min(INTERACTION.zoomMax, vs.scale * factor));

      // Zoom toward cursor
      const ratio = newScale / vs.scale;
      onViewStateChange({
        scale: newScale,
        offsetX: mx - (mx - vs.offsetX) * ratio,
        offsetY: my - (my - vs.offsetY) * ratio,
      });
    },
    [onViewStateChange],
  );

  const handleMouseLeave = useCallback(() => {
    onNodeHover(null);
    if (draggingRef.current) {
      unpinNode(draggingRef.current);
      draggingRef.current = null;
    }
    panningRef.current = false;
    mouseDownRef.current = null;
  }, [onNodeHover, unpinNode]);

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    handleMouseLeave,
  };
}
