import { useEffect, useRef, useCallback } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
} from 'd3-force';
import type { MapNode, MapEdge, Category } from './mapTypes';
import { PHYSICS, CLUSTER_POSITIONS } from './mapConstants';

interface UseForceSimulationOpts {
  nodes: MapNode[];
  edges: MapEdge[];
  width: number;
  height: number;
  activeCategories: Set<Category>;
  onTick: () => void;
}

interface SimLink extends SimulationLinkDatum<MapNode> {
  source: string | MapNode;
  target: string | MapNode;
  weight: number;
  crossCategory: boolean;
}

export function useForceSimulation({
  nodes,
  edges,
  width,
  height,
  activeCategories,
  onTick,
}: UseForceSimulationOpts) {
  const simRef = useRef<Simulation<MapNode, SimLink> | null>(null);
  const prevCategoriesRef = useRef<string>('');

  // Initialize simulation
  useEffect(() => {
    if (width === 0 || height === 0) return;

    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = edges.map((e) => {
      const src = nodeById.get(e.source);
      const tgt = nodeById.get(e.target);
      return {
        source: e.source,
        target: e.target,
        weight: e.weight,
        crossCategory: !!(src && tgt && src.category !== tgt.category),
      };
    });

    // Custom force: every tick, compute the centroid of each category and push
    // each node away from foreign centroids. This is the missing repulsion piece —
    // d3 gives us cluster *attraction* via clusterX/Y but no cluster *repulsion*,
    // which is why politics + geopolitics were drifting into the same blob.
    const sepMaxDistance = Math.min(width, height) * 0.6;
    const categorySeparationForce = (alpha: number) => {
      const centroids = new Map<Category, { x: number; y: number; n: number }>();
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
        const c = centroids.get(node.category) ?? { x: 0, y: 0, n: 0 };
        c.x += node.x;
        c.y += node.y;
        c.n += 1;
        centroids.set(node.category, c);
      }
      for (const c of centroids.values()) {
        if (c.n > 0) {
          c.x /= c.n;
          c.y /= c.n;
        }
      }

      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;
        for (const [cat, centroid] of centroids) {
          if (cat === node.category) continue;
          const dx = node.x - centroid.x;
          const dy = node.y - centroid.y;
          const dist = Math.sqrt(dx * dx + dy * dy) + 1;
          if (dist > sepMaxDistance) continue; // only nearby centroids push
          // 1/dist falloff (softer than gravity-style 1/dist²) so clusters can
          // touch at their edges without being hard-walled apart.
          const push = (PHYSICS.categorySeparationStrength * alpha * 100) / dist;
          node.vx = (node.vx ?? 0) + (dx / dist) * push;
          node.vy = (node.vy ?? 0) + (dy / dist) * push;
        }
      }
    };

    const sim = forceSimulation<MapNode, SimLink>(nodes)
      .force(
        'charge',
        forceManyBody<MapNode>()
          .strength(PHYSICS.chargeStrength)
          .distanceMax(PHYSICS.chargeDistanceMax),
      )
      .force(
        'link',
        forceLink<MapNode, SimLink>(links)
          .id((d) => d.id)
          .distance(PHYSICS.linkDistance)
          .strength((l) => {
            const link = l as SimLink;
            const mult = link.crossCategory
              ? PHYSICS.crossCategoryLinkMultiplier
              : PHYSICS.linkStrengthMultiplier;
            return link.weight * mult;
          }),
      )
      .force('center', forceCenter(width / 2, height / 2).strength(PHYSICS.centerStrength))
      .force(
        'collision',
        forceCollide<MapNode>().radius((d) => d.radius + PHYSICS.collisionPadding),
      )
      .force(
        'clusterX',
        forceX<MapNode>()
          .x((d) => CLUSTER_POSITIONS[d.category].x * width)
          .strength(PHYSICS.clusterStrength),
      )
      .force(
        'clusterY',
        forceY<MapNode>()
          .y((d) => CLUSTER_POSITIONS[d.category].y * height)
          .strength(PHYSICS.clusterStrength),
      )
      .force('categorySeparation', categorySeparationForce)
      .alphaDecay(PHYSICS.alphaDecay)
      .alphaMin(PHYSICS.alphaMin)
      .velocityDecay(PHYSICS.velocityDecay)
      .on('tick', onTick);

    simRef.current = sim;

    return () => {
      sim.stop();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, width, height]);

  // Reheat on category filter change
  useEffect(() => {
    const key = [...activeCategories].sort().join(',');
    if (key === prevCategoriesRef.current) return;
    prevCategoriesRef.current = key;
    if (simRef.current) {
      simRef.current.alpha(0.15).restart();
    }
  }, [activeCategories]);

  const reheat = useCallback((alpha = PHYSICS.reheatAlpha) => {
    simRef.current?.alpha(alpha).restart();
  }, []);

  const pinNode = useCallback((node: MapNode, x: number, y: number) => {
    node.fx = x;
    node.fy = y;
    simRef.current?.alpha(0.1).restart();
  }, []);

  const unpinNode = useCallback((node: MapNode) => {
    node.fx = null;
    node.fy = null;
  }, []);

  return { simRef, reheat, pinNode, unpinNode };
}
