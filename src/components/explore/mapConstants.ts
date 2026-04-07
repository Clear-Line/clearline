import type { Category } from './mapTypes';

export const CATEGORY_COLORS: Record<Category, string> = {
  politics: '#3B82F6',
  crypto: '#A855F7',
  economics: '#F59E0B',
  geopolitics: '#EF4444',
  sports: '#10B981',
  culture: '#EC4899',
};

export const CATEGORY_LABELS: Record<Category, string> = {
  politics: 'Politics',
  crypto: 'Crypto',
  economics: 'Economics',
  geopolitics: 'Geopolitics',
  sports: 'Sports',
  culture: 'Culture',
};

export const ALL_CATEGORIES: Category[] = [
  'politics',
  'crypto',
  'economics',
  'geopolitics',
  'sports',
  'culture',
];

export const PHYSICS = {
  chargeStrength: -350,
  chargeDistanceMax: 700,
  linkDistance: 150,
  linkStrengthMultiplier: 0.3,
  centerStrength: 0.012,
  collisionPadding: 18,
  alphaDecay: 0.018,
  alphaMin: 0.001,
  velocityDecay: 0.35,
  reheatAlpha: 0.3,
  clusterStrength: 0.09,
};

export const RENDER = {
  minNodeRadius: 6,
  maxNodeRadius: 50,
  nodeGlowMultiplier: 2.5,
  nodeFillAlpha: 0.88,
  nodeGlowAlpha: 0.18,
  hoverGlowMultiplier: 3.5,
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

/** Hexagonal cluster target positions (fraction of canvas, centered at 0.5) */
export const CLUSTER_POSITIONS: Record<Category, { x: number; y: number }> = {
  politics: { x: 0.18, y: 0.18 },
  crypto: { x: 0.82, y: 0.18 },
  economics: { x: 0.5, y: 0.5 },
  geopolitics: { x: 0.15, y: 0.82 },
  sports: { x: 0.85, y: 0.82 },
  culture: { x: 0.92, y: 0.48 },
};

export function computeRadius(totalVolume: number): number {
  return Math.max(
    RENDER.minNodeRadius,
    Math.min(RENDER.maxNodeRadius, 5.5 * Math.log2(totalVolume / 2000 + 1)),
  );
}
