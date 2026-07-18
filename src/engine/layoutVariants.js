/**
 * layoutVariants.js — Generates multiple distinct layout variants from the
 * same room specifications using different packing strategies.
 *
 * Each variant produces a valid, non-overlapping layout with walls, doors,
 * and windows — ready for the user to compare and select.
 */

import { WALL_THICKNESS_FT } from './constants.js';
import { generateWalls } from './geometry.js';
import { defaultFurnishings } from './furniture.js';

// ---------------------------------------------------------------------------
// Space-partition primitives
//
// Every variant is built from these helpers, which tile a rectangle *exactly*:
// each room gets a cell whose area is proportional to its target area, cells are
// flush (shared edges → clean merged interior walls) and — crucially — no room
// is ever dropped. This is what guarantees that every room the user selected
// actually shows up in the generated plan.
// ---------------------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10;

function computeBoundary(totalAreaFt, aspect) {
  const h = Math.sqrt(totalAreaFt / aspect);
  const w = totalAreaFt / h;
  return { width: round1(w), height: round1(h) };
}

function innerRect(boundary, pad) {
  return { x: pad, y: pad, w: boundary.width - pad * 2, h: boundary.height - pad * 2 };
}

function sortedRooms(roomSpecs) {
  return expandSpecs(roomSpecs).sort((a, b) => b.targetArea - a.targetArea);
}

// Cut positions along `span` (starting at `start`), split proportionally to
// `weights`. Returns weights.length + 1 positions; cell i spans [cuts[i],
// cuts[i+1]]. Consecutive cells share an exact edge — no gaps, no overlaps.
function cutPositions(start, span, weights) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const positions = [round1(start)];
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    positions.push(round1(start + (span * acc) / total));
  }
  return positions;
}

// Lay a set of rooms across a rectangle in a single line, sized by area.
//   dir 'row' → rooms side by side, widths ∝ area, each spanning the full height.
//   dir 'col' → rooms stacked,      heights ∝ area, each spanning the full width.
function fillLine(rooms, rect, dir) {
  const weights = rooms.map(r => r.targetArea);
  if (dir === 'row') {
    const xs = cutPositions(rect.x, rect.w, weights);
    return rooms.map((r, i) => ({
      ...r, x: xs[i], y: round1(rect.y), w: round1(xs[i + 1] - xs[i]), h: round1(rect.h),
    }));
  }
  const ys = cutPositions(rect.y, rect.h, weights);
  return rooms.map((r, i) => ({
    ...r, x: round1(rect.x), y: ys[i], w: round1(rect.w), h: round1(ys[i + 1] - ys[i]),
  }));
}

// Distribute rooms into `bandCount` groups balanced by area (longest-processing-
// time greedy) so bands come out a similar size. `rooms` should be largest-first.
// Empty bands are dropped, so this never returns more bands than rooms.
function balanceBands(rooms, bandCount) {
  const bands = Array.from({ length: Math.max(1, bandCount) }, () => ({ rooms: [], area: 0 }));
  rooms.forEach(room => {
    let target = bands[0];
    for (const b of bands) if (b.area < target.area) target = b;
    target.rooms.push(room);
    target.area += room.targetArea;
  });
  return bands.filter(b => b.rooms.length > 0);
}

// Fill a rectangle with rooms in `rowCount` stacked rows: each row's height is
// proportional to its rooms' area, and within a row rooms fill the full width.
function fillRows(rooms, rect, rowCount) {
  const bands = balanceBands(rooms, rowCount);
  const ys = cutPositions(rect.y, rect.h, bands.map(b => b.area));
  const placed = [];
  bands.forEach((band, i) => {
    const rowRooms = band.rooms.slice().sort((a, b) => b.targetArea - a.targetArea);
    placed.push(...fillLine(rowRooms, { x: rect.x, y: ys[i], w: rect.w, h: ys[i + 1] - ys[i] }, 'row'));
  });
  return placed;
}

// Fill a rectangle with rooms in `colCount` side-by-side columns: each column's
// width is proportional to its rooms' area, and within a column rooms fill the
// full height.
function fillColumns(rooms, rect, colCount) {
  const bands = balanceBands(rooms, colCount);
  const xs = cutPositions(rect.x, rect.w, bands.map(b => b.area));
  const placed = [];
  bands.forEach((band, i) => {
    const colRooms = band.rooms.slice().sort((a, b) => b.targetArea - a.targetArea);
    placed.push(...fillLine(colRooms, { x: xs[i], y: rect.y, w: xs[i + 1] - xs[i], h: rect.h }, 'col'));
  });
  return placed;
}

// ---------------------------------------------------------------------------
// Variant strategies — each tiles the whole footprint, so no room is dropped.
// ---------------------------------------------------------------------------

/**
 * Variant 1: Shelf Layout — rooms in horizontal rows, each stretched to fill
 * the full width.
 */
function shelfVariant(totalAreaFt, roomSpecs) {
  const boundary = computeBoundary(totalAreaFt, 1.35);
  const rooms = sortedRooms(roomSpecs);
  const rowCount = Math.max(1, Math.round(Math.sqrt(rooms.length)));
  return { boundary, rooms: fillRows(rooms, innerRect(boundary, 0.3), rowCount) };
}

/**
 * Variant 2: Grid Layout — a compact two-column grid.
 */
function gridVariant(totalAreaFt, roomSpecs) {
  const boundary = computeBoundary(totalAreaFt, 1.2);
  const rooms = sortedRooms(roomSpecs);
  const colCount = rooms.length <= 1 ? 1 : 2;
  return { boundary, rooms: fillColumns(rooms, innerRect(boundary, 0.5), colCount) };
}

/**
 * Variant 3: Corridor Plan — rooms on two sides of a central hallway.
 */
function corridorVariant(totalAreaFt, roomSpecs) {
  const boundary = computeBoundary(totalAreaFt, 1.5);
  const rooms = sortedRooms(roomSpecs);
  const rect = innerRect(boundary, 0.4);

  // A lone room doesn't need a corridor.
  if (rooms.length < 2) {
    return { boundary, rooms: fillColumns(rooms, rect, 1) };
  }

  const bands = balanceBands(rooms, 2);
  const corridorWidth = Math.min(4, rect.w * 0.12);
  const sideWidth = (rect.w - corridorWidth) / 2;
  const placed = [];

  const left = bands[0].rooms.slice().sort((a, b) => b.targetArea - a.targetArea);
  placed.push(...fillLine(left, { x: rect.x, y: rect.y, w: sideWidth, h: rect.h }, 'col'));

  if (bands[1]) {
    const right = bands[1].rooms.slice().sort((a, b) => b.targetArea - a.targetArea);
    placed.push(...fillLine(right, { x: rect.x + sideWidth + corridorWidth, y: rect.y, w: sideWidth, h: rect.h }, 'col'));
  }

  return { boundary, rooms: placed };
}

/**
 * Variant 4: Open Plan — living/dining/kitchen share a wide open band along the
 * bottom; the private rooms (bedrooms, bath, etc.) run along the top.
 */
function openPlanVariant(totalAreaFt, roomSpecs) {
  const boundary = computeBoundary(totalAreaFt, 1.3);
  const rect = innerRect(boundary, 0.4);
  const expanded = sortedRooms(roomSpecs);

  const publicTypes = new Set(['living', 'dining', 'kitchen']);
  const publicRooms = expanded.filter(r => publicTypes.has(r.type));
  const privateRooms = expanded.filter(r => !publicTypes.has(r.type));

  // If the split is one-sided there's no "open vs private" story to tell — fall
  // back to plain rows so the whole footprint is still used.
  if (publicRooms.length === 0 || privateRooms.length === 0) {
    const rowCount = Math.max(1, Math.round(Math.sqrt(expanded.length)));
    return { boundary, rooms: fillRows(expanded, rect, rowCount) };
  }

  const publicArea = publicRooms.reduce((s, r) => s + r.targetArea, 0);
  const totalArea = expanded.reduce((s, r) => s + r.targetArea, 0) || 1;
  const publicFrac = Math.max(0.35, Math.min(0.6, publicArea / totalArea));
  const publicH = rect.h * publicFrac;
  const topH = rect.h - publicH;

  const placed = [];
  // Private rooms across the top (two rows when there are several, to keep them
  // from becoming thin slivers).
  const privRows = privateRooms.length >= 4 ? 2 : 1;
  placed.push(...fillRows(privateRooms, { x: rect.x, y: rect.y, w: rect.w, h: topH }, privRows));
  // Public rooms across the bottom, open and wide.
  placed.push(...fillLine(publicRooms, { x: rect.x, y: rect.y + topH, w: rect.w, h: publicH }, 'row'));

  return { boundary, rooms: placed };
}

/**
 * Custom: a clean grid that gives every room its own cell so nothing is
 * dropped, and — crucially — leaves no empty space. Rooms are laid out in rows
 * of uniform height; the last row usually holds fewer rooms than a full row, so
 * its cells are sized by how many rooms it actually contains, stretching them to
 * fill the full width. Without this, a 7-room plan on a 3×3 grid would leave two
 * blank cells trailing the final row. It's a clean starting canvas — the user
 * then builds their own layout by dragging, resizing, swapping and rotating
 * rooms in the editor.
 */
function customVariant(totalAreaFt, roomSpecs) {
  const boundary = computeBoundary(totalAreaFt, 1.3);
  const wallGap = WALL_THICKNESS_FT;
  const pad = 0.5;

  const expanded = expandSpecs(roomSpecs);
  const n = expanded.length;
  if (n === 0) return { boundary, rooms: [] };

  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);

  const cellH = (boundary.height - pad * 2 - (rows - 1) * wallGap) / rows;

  const placed = expanded.map((room, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // How many rooms actually live in this row — the last row may be short, so
    // its cells widen to fill the footprint instead of leaving a gap.
    const roomsInRow = Math.min(cols, n - row * cols);
    const cellW = (boundary.width - pad * 2 - (roomsInRow - 1) * wallGap) / roomsInRow;
    return {
      ...room,
      x: round1(pad + col * (cellW + wallGap)),
      y: round1(pad + row * (cellH + wallGap)),
      w: round1(cellW),
      h: round1(cellH),
    };
  });

  return { boundary, rooms: placed };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expandSpecs(roomSpecs) {
  const expanded = [];
  roomSpecs.forEach(spec => {
    for (let i = 0; i < spec.count; i++) {
      expanded.push({
        id: `${spec.type}_${i + 1}`,
        type: spec.type,
        label: spec.count > 1 ? `${spec.label} ${i + 1}` : spec.label,
        targetArea: spec.area,
        color: spec.color,
        aspectTarget: spec.aspectTarget || 1.2,
      });
    }
  });
  return expanded;
}

function finalizeLayout(variant, boundary) {
  const { walls, doors, windows } = generateWalls(
    variant.rooms.map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, type: r.type })),
    boundary,
  );
  const furnishings = defaultFurnishings(variant.rooms);
  return { boundary, rooms: variant.rooms, walls, doors, windows, furnishings };
}

// ---------------------------------------------------------------------------
// Variant metadata
// ---------------------------------------------------------------------------

export const VARIANT_INFO = [
  {
    id: 'shelf',
    name: 'Shelf Layout',
    desc: 'Rows of rooms stretched to fill the width',
    strategy: shelfVariant,
  },
  {
    id: 'grid',
    name: 'Grid Layout',
    desc: 'Two-column grid, compact and organized',
    strategy: gridVariant,
  },
  {
    id: 'corridor',
    name: 'Corridor Plan',
    desc: 'Rooms on both sides of a central hallway',
    strategy: corridorVariant,
  },
  {
    id: 'open',
    name: 'Open Plan',
    desc: 'Large open living area, private bedrooms',
    strategy: openPlanVariant,
  },
];

/**
 * Generate multiple layout variants from room specifications.
 * Returns an array of complete layout objects, each with a different arrangement.
 */
export function generateVariants(totalAreaFt, roomSpecs) {
  const results = [];

  VARIANT_INFO.forEach(({ id, name, desc, strategy }) => {
    try {
      const variant = strategy(totalAreaFt, roomSpecs);
      if (variant.rooms.length === 0) return;

      const layout = finalizeLayout(variant, variant.boundary);
      const totalRoomArea = layout.rooms.reduce((s, r) => s + r.w * r.h, 0);
      const boundaryArea = layout.boundary.width * layout.boundary.height;

      results.push({
        id,
        name,
        desc,
        layout,
        stats: {
          roomCount: layout.rooms.length,
          dimensions: `${layout.boundary.width.toFixed(0)} × ${layout.boundary.height.toFixed(0)}`,
          efficiency: Math.round((totalRoomArea / boundaryArea) * 100),
        },
      });
    } catch (e) {
      console.warn(`Variant "${id}" failed:`, e);
    }
  });

  // Append a "custom" starting layout the user arranges themselves.
  try {
    const variant = customVariant(totalAreaFt, roomSpecs);
    if (variant.rooms.length > 0) {
      const layout = finalizeLayout(variant, variant.boundary);
      // Tag the layout so the final view can tell it's user-arranged and hide
      // Re-layout (regenerating would discard the custom arrangement).
      layout.isCustom = true;
      const totalRoomArea = layout.rooms.reduce((s, r) => s + r.w * r.h, 0);
      const boundaryArea = layout.boundary.width * layout.boundary.height;
      results.push({
        id: 'custom',
        name: 'Custom Layout',
        desc: 'Start from a grid, then arrange rooms yourself',
        isCustom: true,
        layout,
        stats: {
          roomCount: layout.rooms.length,
          dimensions: `${layout.boundary.width.toFixed(0)} × ${layout.boundary.height.toFixed(0)}`,
          efficiency: Math.round((totalRoomArea / boundaryArea) * 100),
        },
      });
    }
  } catch (e) {
    console.warn('Variant "custom" failed:', e);
  }

  return results;
}
