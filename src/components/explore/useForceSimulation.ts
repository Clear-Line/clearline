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

    const links: SimLink[] = edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
    }));

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
          .strength((l) => (l as SimLink).weight * PHYSICS.linkStrengthMultiplier),
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
