import type { Category } from './mapTypes';

export const CATEGORY_COLORS: Record<Category, string> = {
  politics: '#3B82F6',
  crypto: '#A855F7',
  economics: '#F59E0B',
  geopolitics: '#EF4444',
  culture: '#EC4899',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  politics: 'Politics',
  crypto: 'Crypto',
  economics: 'Economics',
  geopolitics: 'Geopolitics',
  culture: 'Culture',
};

export const ALL_CATEGORIES: Category[] = [
  'politics',
  'crypto',
  'economics',
  'geopolitics',
  'culture',
];

export const PHYSICS = {
  chargeStrength: -480,
  chargeDistanceMax: 700,
  linkDistance: 130,
  linkStrengthMultiplier: 0.22,
  centerStrength: 0.012,
  collisionPadding: 18,
  alphaDecay: 0.018,
  alphaMin: 0.001,
  velocityDecay: 0.35,
  reheatAlpha: 0.3,
  clusterStrength: 0.22,
  // Per-category centroid repulsion (custom force in useForceSimulation.ts).
  // d3 gives us cluster *attraction* but no cluster *repulsion* — this is the missing piece.
  categorySeparationStrength: 0.6,
  // Cross-category edges pull ~3.6x weaker than intra-category — prevents
  // politics/geopolitics from collapsing into one blob while still rendering.
  crossCategoryLinkMultiplier: 0.06,
};

export const RENDER = {
  minNodeRadius: 5,
  maxNodeRadius: 90,
  nodeGlowMultiplier: 2.5,
  nodeFillAlpha: 0.88,
  nodeGlowAlpha: 0.18,
  hoverGlowMultiplier: 3.5,
  // Conviction-driven fill saturation. At 50/50 the fill is mostly neutral grey
  // (mix = convictionMixFloor); at 0% or 100% it's the full category color
  // (mix = convictionMixCeiling). "Decided vs contested" readable at a glance.
  convictionMixFloor: 0.4,
  convictionMixCeiling: 1.0,
  neutralGrey: 90,
  // Activity ring — encodes |change24h|. Markets that just moved get a thick
  // bright ring; quiet markets get nothing. Drawn as the same shape primitive
  // as the node body, inflated by activityRingGap.
  activityRingMaxWidth: 3.5,
  activityRingAlphaFloor: 0.15,
  activityRingChangeAtMax: 0.08,
  activityRingGap: 2,
  edgeIntraCategoryAlpha: 0.25,
  edgeCrossCategoryAlpha: 0.15,
  edgeHighlightAlpha: 0.6,
  edgeMinWidth: 0.8,
  edgeWeightMultiplier: 3,
  edgeHighlightWeightMultiplier: 4,
  labelMinScale: 0.6,
  labelMinRadius: 20,
  labelFontMin: 9,
  labelFontMax: 11,
  labelAlpha: 0.45,
  filteredOutAlpha: 0.08,
  selectedStrokeWidth: 2,
  selectedStrokeColor: '#00D4FF',
  breatheMin: 2.5,
  breatheMax: 3,
  breatheSpeed: 0.003,
};

export const INTERACTION = {
  zoomMin: 0.15,
  zoomMax: 4.0,
  zoomSensitivity: 0.001,
  clickThresholdPx: 5,
  clickThresholdMs: 200,
  tooltipOffsetX: 14,
  tooltipOffsetY: 14,
};

export const BG_COLOR = '#04040B';

// ─── Personal portfolio overlay ───
/** Green ring drawn around nodes the signed-in user holds. */
export const HELD_RING_COLOR = '#10B981';
export const HELD_RING_WIDTH_MIN = 2;
export const HELD_RING_GAP = 4;

/** Star marker drawn on nodes the signed-in user has watchlisted. */
export const WATCHLIST_MARKER_COLOR = '#FBBF24';
export const WATCHLIST_MARKER_SIZE = 7;

/** Cluster target positions (fraction of canvas). Politics upper-left,
 *  geopolitics lower-right = maximum diagonal separation. See fix #7. */
export const CLUSTER_POSITIONS: Record<Category, { x: number; y: number }> = {
  politics:    { x: 0.15, y: 0.20 },
  crypto:      { x: 0.85, y: 0.20 },
  economics:   { x: 0.50, y: 0.50 },
  geopolitics: { x: 0.85, y: 0.80 },
  culture:     { x: 0.15, y: 0.80 },
};

// ─── Per-category shape primitives ───
// Each category renders as a distinct geometric form so the map breaks the
// "every node is a circle" monotony. Shape is redundant with color (accessibility
// win) and at zoomed-out scales each cluster has a recognizable silhouette.

export type NodeShape = 'circle' | 'hexagon' | 'diamond' | 'triangle' | 'pentagon';

export const CATEGORY_SHAPES: Record<Category, NodeShape> = {
  politics: 'circle',
  crypto: 'hexagon',
  economics: 'diamond',
  geopolitics: 'triangle',
  culture: 'pentagon',
};

// Multiply node.radius by this when drawing a polygon so the polygon's area
// equals the equivalent circle's area (π·r²). Keeps cross-category size
// comparisons honest — a triangle with the same "radius" as a circle would
// otherwise have ~36% less area and look smaller than its volume warrants.
export const SHAPE_AREA_SCALE: Record<NodeShape, number> = {
  circle: 1.0,
  hexagon: 1.099, // sqrt(π / ((6/2)·sin(60°)))
  diamond: 1.253, // sqrt(π / 2)
  pentagon: 1.149, // sqrt(π / ((5/2)·sin(72°)))
  triangle: 1.555, // sqrt(π / ((3/2)·sin(120°)))
};

// Sqrt-family scale: a node with 4× the volume looks 2× as wide. Anchored so
// $2K ≈ 5px and $50M ≈ 90px (capped). The previous log scale compressed the
// $500K vs $50M difference into nothing — Iran-tier markets now visibly dominate.
export function computeRadius(totalVolume: number): number {
  const v = Math.max(0, totalVolume);
  const r = 4 + 0.024 * Math.sqrt(v);
  return Math.max(RENDER.minNodeRadius, Math.min(RENDER.maxNodeRadius, r));
}
