import { useEffect, useRef } from 'react';
import {
  forceSimulation,
  forceManyBody,
  forceCollide,
  forceRadial,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force';
import type { MapNode, OrbitBubble } from './mapTypes';
import {
  MarketWallet,
  ORBIT,
  walletBubbleColor,
  walletBubbleRadius,
} from './lib/wallets';

/**
 * Drives the Bubblemaps-style wallet bloom around a selected market.
 *
 * Responsibilities:
 *   - Seed bubbles at the parent's center with radius 0 when a market expands.
 *   - Run a mini d3-force sim (repulsion + collide + radial ring) so bubbles
 *     settle into a loose orbit around the parent.
 *   - Animate each bubble's `radius` 0 → targetRadius on grow and → 0 on collapse.
 *   - Track a 0→1 bloom progress value for the renderer to drive the parent's
 *     radius scale (parent grows to ~2x during grow).
 *
 * The hook is entirely ref-based — it never triggers React re-renders. The
 * canvas draw loop reads `bubblesRef` and `bloomProgressRef` every frame.
 */

interface BloomOpts {
  expandedNodeId: string | null;
  parent: MapNode | null;
  wallets: MarketWallet[];
}

interface BloomResult {
  bubblesRef: React.MutableRefObject<OrbitBubble[]>;
  bloomProgressRef: React.MutableRefObject<number>;
}

const GROW_EASE = 0.15;
const COLLAPSE_EASE = 0.2;
const PROGRESS_EASE = 0.15;
const COLLAPSE_FLOOR = 0.05; // below this, snap to 0 and stop the sim

export function useWalletBloom({
  expandedNodeId,
  parent,
  wallets,
}: BloomOpts): BloomResult {
  const bubblesRef = useRef<OrbitBubble[]>([]);
  const bloomProgressRef = useRef(0);
  const simRef = useRef<Simulation<OrbitBubble, undefined> | null>(null);
  const rafRef = useRef<number>(0);
  const parentRef = useRef<MapNode | null>(parent);
  parentRef.current = parent;
  const collapsingRef = useRef(false);

  // Seed bubbles when the expansion target changes OR wallets load in.
  // Key: `${expandedNodeId}|${wallets.length}|${first address}` — re-seed only
  // when the underlying set actually changes, not on every parent-position tick.
  const seedKey = expandedNodeId && wallets.length > 0
    ? `${expandedNodeId}|${wallets.length}|${wallets[0]?.address ?? ''}`
    : null;

  useEffect(() => {
    if (!expandedNodeId || !parent || wallets.length === 0) {
      // Trigger collapse: keep bubbles alive but animate radius → 0 in the RAF loop.
      collapsingRef.current = bubblesRef.current.length > 0;
      return;
    }

    collapsingRef.current = false;

    const px = parent.x ?? 0;
    const py = parent.y ?? 0;
    const volumeMax = Math.max(1, ...wallets.map((w) => w.volume));

    const bubbles: OrbitBubble[] = wallets.map((w) => ({
      address: w.address,
      x: px + (Math.random() - 0.5) * 0.5, // tiny jitter so forces can resolve
      y: py + (Math.random() - 0.5) * 0.5,
      vx: 0,
      vy: 0,
      radius: 0,
      targetRadius: walletBubbleRadius({ volume: w.volume, volumeMax }),
      color: walletBubbleColor({
        side: w.side,
        outcome: w.outcome,
        accuracyScore: w.accuracyScore,
      }),
      side: w.side,
      outcome: w.outcome,
      volume: w.volume,
      accuracyScore: w.accuracyScore,
      totalMarketsTraded: w.totalMarketsTraded,
      username: w.username,
    }));

    bubblesRef.current = bubbles;

    const parentRadius = parent.radius;
    const orbitR = parentRadius * 2 + ORBIT.orbitGap + ORBIT.maxBubbleR;

    simRef.current?.stop();

    const sim = forceSimulation<OrbitBubble>(bubbles)
      .force('charge', forceManyBody<OrbitBubble>().strength(-30))
      .force(
        'collide',
        forceCollide<OrbitBubble>().radius((b) => b.radius + 2),
      )
      .force(
        'radial',
        forceRadial<OrbitBubble>(orbitR, px, py).strength(0.2),
      )
      .force('x', forceX<OrbitBubble>(px).strength(0.01))
      .force('y', forceY<OrbitBubble>(py).strength(0.01))
      .alphaDecay(0.02)
      .alphaMin(0.005)
      .velocityDecay(0.35);

    simRef.current = sim;

    return () => {
      // Don't stop on cleanup — we want to keep ticking while collapsing.
      // The next seed / unmount handler takes care of it.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  // Animation loop: ease radius + bloomProgress, keep the radial force pinned
  // to the (possibly drifting) parent position every tick.
  useEffect(() => {
    const tick = () => {
      const bubbles = bubblesRef.current;
      const p = parentRef.current;
      const active = !!(expandedNodeId && p && bubbles.length > 0);

      // Ease bloom progress 0↔1
      const progressTarget = active && !collapsingRef.current ? 1 : 0;
      bloomProgressRef.current +=
        (progressTarget - bloomProgressRef.current) * PROGRESS_EASE;
      if (progressTarget === 0 && bloomProgressRef.current < 0.01) {
        bloomProgressRef.current = 0;
      }

      if (bubbles.length > 0 && p) {
        const px = p.x ?? 0;
        const py = p.y ?? 0;

        // Retarget the radial/X/Y forces to the live parent position so bubbles
        // track the market node if it drifts in the main sim.
        const sim = simRef.current;
        if (sim) {
          const radial = sim.force('radial') as ReturnType<typeof forceRadial<OrbitBubble>> | undefined;
          radial?.x(px).y(py);
          const fx = sim.force('x') as ReturnType<typeof forceX<OrbitBubble>> | undefined;
          fx?.x(px);
          const fy = sim.force('y') as ReturnType<typeof forceY<OrbitBubble>> | undefined;
          fy?.y(py);
        }

        let anyAlive = false;
        for (const b of bubbles) {
          if (collapsingRef.current) {
            // Ease toward parent center as we shrink
            b.x += (px - b.x) * COLLAPSE_EASE;
            b.y += (py - b.y) * COLLAPSE_EASE;
            b.radius += (0 - b.radius) * COLLAPSE_EASE;
            if (b.radius > COLLAPSE_FLOOR) anyAlive = true;
          } else {
            b.radius += (b.targetRadius - b.radius) * GROW_EASE;
            anyAlive = true;
          }
        }

        if (collapsingRef.current && !anyAlive) {
          bubblesRef.current = [];
          simRef.current?.stop();
          simRef.current = null;
          collapsingRef.current = false;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [expandedNodeId]);

  return { bubblesRef, bloomProgressRef };
}
