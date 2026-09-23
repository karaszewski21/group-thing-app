/**
 * Pure positioning math for the group visualization (`TermPage.tsx`).
 *
 * All positions are expressed as `{ x, y }` percentages of a 0-100 square,
 * usable directly as CSS `%` (via `left`/`top`) or as SVG `viewBox="0 0 100 100"`
 * coordinates. No React or DOM dependencies.
 */

export interface LayoutPosition {
  x: number;
  y: number;
}

/** Radius (in % of container) used by the CIRCLE layout — matches the pre-refactor `pos()`. */
const CIRCLE_RADIUS = 38;

/** Ellipse radii (in % of container) used by the TABLE layout. */
const TABLE_RADIUS_X = 42;
const TABLE_RADIUS_Y = 34;

/** Vertical/horizontal bounds (in % of container) used by the PITCH layout. */
const PITCH_ROW_MIN = 25;
const PITCH_ROW_MAX = 85;
const PITCH_COL_MIN = 15;
const PITCH_COL_MAX = 85;

/**
 * Position for `index` (0-based) of `total` items evenly spaced around a circle,
 * starting at the top and going clockwise. Single source of truth for the CIRCLE
 * layout's angle/radius math — replaces the former `pos()` helper and the
 * duplicated inline SVG-line-mapper formula in `TermPage.tsx`.
 */
export function getCirclePosition(index: number, total: number): LayoutPosition {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return {
    x: 50 + CIRCLE_RADIUS * Math.cos(angle),
    y: 50 + CIRCLE_RADIUS * Math.sin(angle),
  };
}

/**
 * Position for `index` (0-based) of `total` items distributed along the
 * perimeter of an ellipse (TABLE layout), analogous to `getCirclePosition`
 * but with independent x/y radii.
 */
export function getTablePosition(index: number, total: number): LayoutPosition {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return {
    x: 50 + TABLE_RADIUS_X * Math.cos(angle),
    y: 50 + TABLE_RADIUS_Y * Math.sin(angle),
  };
}

/** Number of columns per row used to lay out `total` items in a roughly square grid. */
function computeRowSize(total: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(total)));
}

/**
 * Evenly spaces `count` values across the inclusive range `[min, max]`.
 * A single value is centered. Used by `getPitchPosition` for both the row
 * (vertical) and column (horizontal) axes.
 */
export function distributeEvenly(count: number, min: number, max: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(min + max) / 2];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}

export interface RowLocation {
  row: number;
  col: number;
  rows: number;
  itemsInRow: number;
}

/**
 * Locates `index` (0-based) of `total` items within a grid of rows of at most
 * `rowSize` items each (last row may be partial). Pure helper for `getPitchPosition`.
 */
export function locateInRows(index: number, total: number, rowSize: number): RowLocation {
  const rows = Math.ceil(total / rowSize);
  const row = Math.floor(index / rowSize);
  const itemsInRow = Math.min(rowSize, total - row * rowSize);
  const col = index % rowSize;
  return { row, col, rows, itemsInRow };
}

/**
 * Position for `index` (0-based) of `total` items distributed in evenly spaced
 * rows (PITCH layout) — `Math.ceil(total / rowSize)` rows, each row's items
 * evenly spread horizontally and rows evenly spread vertically.
 */
export function getPitchPosition(index: number, total: number): LayoutPosition {
  const rowSize = computeRowSize(total);
  const { row, col, rows, itemsInRow } = locateInRows(index, total, rowSize);
  const rowYs = distributeEvenly(rows, PITCH_ROW_MIN, PITCH_ROW_MAX);
  const colXs = distributeEvenly(itemsInRow, PITCH_COL_MIN, PITCH_COL_MAX);
  return { x: colXs[col], y: rowYs[row] };
}

/** 32-bit FNV-1a hash of a string, used to seed the deterministic slot shuffle. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG — deterministic given the same seed. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic family→slot shuffle for the PITCH/TABLE layouts, seeded by
 * `groupId` — the same `(groupId, familyIds)` pair always yields the same
 * order, while different groups shuffle differently. CIRCLE keeps the
 * natural `families` order and does not use this function.
 */
export function getStableSlotOrder(groupId: number | string, familyIds: number[]): number[] {
  const rng = mulberry32(hashString(String(groupId)));
  const order = [...familyIds];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}
