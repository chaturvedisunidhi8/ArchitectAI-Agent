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
// Variant strategies
// ---------------------------------------------------------------------------

function computeBoundary(totalAreaFt, aspect) {
  const h = Math.sqrt(totalAreaFt / aspect);
  const w = totalAreaFt / h;
  return { width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10 };
}

/**
 * Variant 1: Shelf Packing (existing algorithm)
 * Rooms packed in rows, stretched to fill width.
 */
function shelfVariant(totalAreaFt, roomSpecs) {
  const boundary = computeBoundary(totalAreaFt, 1.35);
  const wallGap = WALL_THICKNESS_FT;
  const pad = 0.3;

  const expanded = expandSpecs(roomSpecs);
  expanded.sort((a, b) => b.targetArea - a.targetArea);

  const totalRoomArea = expanded.reduce((s, r) => s + r.targetArea, 0);
  const wallAreaEstimate = (boundary.width + boundary.height) * wallGap * 2;
  const usableArea = (boundary.width * boundary.height) - wallAreaEstimate;
  const areaScale = Math.min(1.1, Math.sqrt(Math.max(0.5, usableArea / totalRoomArea)));

  const placed = [];
  let shelfY = pad;
  let shelfHeight = 0;
  let cursorX = pad;
  let shelfRow = [];
  const maxW = boundary.width - pad * 2;
  const maxH = boundary.height - pad * 2;

  function flushShelf() {
    if (shelfRow.length === 0) return;
    const rowWidth = boundary.width - pad * 2;
    const actualUsed = shelfRow.reduce((s, r) => s + r.w, 0) + (shelfRow.length - 1) * wallGap;
    const slack = rowWidth - actualUsed;
    if (slack > 0.5 && shelfRow.length > 1) {
      const stretchFactor = rowWidth / actualUsed;
      let ex = pad;
      shelfRow.forEach(r => {
        const newW = r.w * stretchFactor;
        const stretch = newW / r.w;
        const newH = r.h * stretch;
        if (shelfY + newH <= maxH + pad) {
          r.w = Math.round(newW * 10) / 10;
          r.h = Math.round(Math.min(newH, maxH - shelfY + pad) * 10) / 10;
        }
        r.x = Math.round(ex * 10) / 10;
        ex += r.w + wallGap;
      });
    }
    shelfRow = [];
  }

  expanded.forEach((room) => {
    const scaledArea = room.targetArea * areaScale;
    const aspect = room.aspectTarget;
    let rw, rh;
    if (scaledArea >= 120) {
      rh = Math.sqrt(scaledArea / aspect);
      rw = scaledArea / rh;
      rh = Math.max(7, Math.min(16, rh));
      rw = Math.max(6, Math.min(maxW * 0.6, rw));
    } else if (scaledArea >= 40) {
      rh = Math.sqrt(scaledArea / aspect);
      rw = scaledArea / rh;
      rh = Math.max(4, Math.min(10, rh));
      rw = Math.max(4, Math.min(maxW * 0.5, rw));
    } else {
      rh = Math.sqrt(scaledArea / 1.0);
      rw = scaledArea / rh;
      rh = Math.max(3, Math.min(6, rh));
      rw = Math.max(3, Math.min(maxW * 0.4, rw));
    }
    if (cursorX + rw > maxW + 0.5) {
      flushShelf();
      cursorX = pad;
      shelfY += shelfHeight + wallGap;
      shelfHeight = 0;
    }
    if (shelfY + rh > maxH + pad) {
      rh = maxH + pad - shelfY;
      rw = scaledArea / rh;
      if (rw < 2 || rh < 2) return;
    }
    const roomObj = {
      ...room,
      x: Math.round(cursorX * 10) / 10,
      y: Math.round(shelfY * 10) / 10,
      w: Math.round(rw * 10) / 10,
      h: Math.round(rh * 10) / 10,
    };
    placed.push(roomObj);
    shelfRow.push(roomObj);
    cursorX += rw + wallGap;
    shelfHeight = Math.max(shelfHeight, rh);
  });
  flushShelf();

  return { boundary, rooms: placed };
}

/**
 * Variant 2: Grid Layout
 * Rooms arranged in a 2-column grid, like a corridor plan.
 */
function gridVariant(totalAreaFt, roomSpecs) {
  const boundary = computeBoundary(totalAreaFt, 1.2);
  const wallGap = WALL_THICKNESS_FT;
  const pad = 0.5;

  const expanded = expandSpecs(roomSpecs);
  expanded.sort((a, b) => b.targetArea - a.targetArea);

  const totalRoomArea = expanded.reduce((s, r) => s + r.targetArea, 0);
  const usableArea = (boundary.width - pad * 2) * (boundary.height - pad * 2);
  const areaScale = Math.min(1.05, Math.sqrt(Math.max(0.5, usableArea / totalRoomArea)));

  // Split into two columns
  const mid = Math.ceil(expanded.length / 2);
  const leftCol = expanded.slice(0, mid);
  const rightCol = expanded.slice(mid);

  const colWidth = (boundary.width - pad * 2 - wallGap) / 2;
  const placed = [];

  function placeColumn(col, startX) {
    let cursorY = pad;
    col.forEach(room => {
      const scaledArea = room.targetArea * areaScale;
      const rw = Math.min(colWidth, Math.max(4, scaledArea / 6));
      const rh = Math.max(3, Math.min(14, scaledArea / rw));
      if (cursorY + rh > boundary.height - pad) return;
      placed.push({
        ...room,
        x: Math.round(startX * 10) / 10,
        y: Math.round(cursorY * 10) / 10,
        w: Math.round(rw * 10) / 10,
        h: Math.round(rh * 10) / 10,
      });
      cursorY += rh + wallGap;
    });
  }

  placeColumn(leftCol, pad);
  placeColumn(rightCol, pad + colWidth + wallGap);

  return { boundary, rooms: placed };
}

/**
 * Variant 3: Central Corridor
 * Rooms arranged on two sides of a central hallway.
 */
function corridorVariant(totalAreaFt, roomSpecs) {
  const boundary = computeBoundary(totalAreaFt, 1.5);
  const wallGap = WALL_THICKNESS_FT;
  const pad = 0.4;
  const corridorWidth = 3.5;

  const expanded = expandSpecs(roomSpecs);
  expanded.sort((a, b) => b.targetArea - a.targetArea);

  const totalRoomArea = expanded.reduce((s, r) => s + r.targetArea, 0);
  const corridorArea = corridorWidth * (boundary.height - pad * 2);
  const availableArea = (boundary.width - pad * 2) * (boundary.height - pad * 2) - corridorArea;
  const areaScale = Math.min(1.0, Math.sqrt(Math.max(0.5, availableArea / totalRoomArea)));

  // Split rooms: larger ones on left, smaller on right
  const leftRooms = [];
  const rightRooms = [];
  expanded.forEach((room, i) => {
    if (i % 2 === 0) leftRooms.push(room);
    else rightRooms.push(room);
  });

  const leftWidth = (boundary.width - pad * 2 - corridorWidth - wallGap) / 2;
  const rightWidth = leftWidth;
  const rightStart = boundary.width - pad - rightWidth;
  const placed = [];

  function placeSide(rooms, startX, width) {
    let cursorY = pad;
    rooms.forEach(room => {
      const scaledArea = room.targetArea * areaScale;
      const rw = Math.min(width, Math.max(3, scaledArea / 5));
      const rh = Math.max(3, Math.min(12, scaledArea / rw));
      if (cursorY + rh > boundary.height - pad) return;
      placed.push({
        ...room,
        x: Math.round(startX * 10) / 10,
        y: Math.round(cursorY * 10) / 10,
        w: Math.round(rw * 10) / 10,
        h: Math.round(rh * 10) / 10,
      });
      cursorY += rh + wallGap;
    });
  }

  placeSide(leftRooms, pad, leftWidth);
  placeSide(rightRooms, rightStart, rightWidth);

  return { boundary, rooms: placed };
}

/**
 * Variant 4: Open Plan
 * Living/dining/kitchen merged into a large open area, bedrooms private.
 */
function openPlanVariant(totalAreaFt, roomSpecs) {
  const boundary = computeBoundary(totalAreaFt, 1.3);
  const wallGap = WALL_THICKNESS_FT;
  const pad = 0.4;

  const expanded = expandSpecs(roomSpecs);
  expanded.sort((a, b) => b.targetArea - a.targetArea);

  const totalRoomArea = expanded.reduce((s, r) => s + r.targetArea, 0);
  const usableArea = (boundary.width - pad * 2) * (boundary.height - pad * 2);
  const areaScale = Math.min(1.05, Math.sqrt(Math.max(0.5, usableArea / totalRoomArea)));

  // Separate public (living, dining, kitchen) vs private (bedroom, bathroom, etc.)
  const publicTypes = new Set(['living', 'dining', 'kitchen']);
  const publicRooms = expanded.filter(r => publicTypes.has(r.type));
  const privateRooms = expanded.filter(r => !publicTypes.has(r.type));

  const placed = [];
  const maxH = boundary.height - pad * 2;
  const maxW = boundary.width - pad * 2;

  // Place public rooms in the bottom half (larger, open)
  const publicHeight = maxH * 0.55;
  let cursorX = pad;
  const publicWidth = maxW;
  publicRooms.forEach(room => {
    const scaledArea = room.targetArea * areaScale * 1.2; // Give public rooms more space
    const rw = Math.max(4, Math.min(publicWidth / publicRooms.length * 1.5, scaledArea / publicHeight * 0.8));
    const rh = Math.max(4, publicHeight);
    if (cursorX + rw > pad + publicWidth + 0.5) return;
    placed.push({
      ...room,
      x: Math.round(cursorX * 10) / 10,
      y: Math.round((boundary.height - pad - publicHeight) * 10) / 10,
      w: Math.round(rw * 10) / 10,
      h: Math.round(rh * 10) / 10,
    });
    cursorX += rw + wallGap;
  });

  // Stretch last public room to fill width
  if (placed.length > 0 && publicRooms.length > 0) {
    const lastPub = placed[placed.length - 1];
    const targetX = pad + publicWidth;
    if (lastPub.x + lastPub.w < targetX - 1) {
      lastPub.w = Math.round((targetX - lastPub.x) * 10) / 10;
    }
  }

  // Place private rooms in the top half
  const privateHeight = maxH * 0.4;
  let privCursorX = pad;
  privateRooms.forEach(room => {
    const scaledArea = room.targetArea * areaScale;
    const rw = Math.max(3, Math.min(maxW * 0.5, scaledArea / privateHeight * 0.8));
    const rh = Math.max(3, privateHeight);
    if (privCursorX + rw > pad + maxW + 0.5) return;
    placed.push({
      ...room,
      x: Math.round(privCursorX * 10) / 10,
      y: Math.round(pad * 10) / 10,
      w: Math.round(rw * 10) / 10,
      h: Math.round(rh * 10) / 10,
    });
    privCursorX += rw + wallGap;
  });

  return { boundary, rooms: placed };
}

/**
 * Custom: a plain uniform grid that gives every room its own cell so nothing
 * is dropped. It's a clean starting canvas — the user then builds their own
 * layout by dragging, resizing, swapping and rotating rooms in the editor.
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

  const cellW = (boundary.width - pad * 2 - (cols - 1) * wallGap) / cols;
  const cellH = (boundary.height - pad * 2 - (rows - 1) * wallGap) / rows;

  const placed = expanded.map((room, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      ...room,
      x: Math.round((pad + col * (cellW + wallGap)) * 10) / 10,
      y: Math.round((pad + row * (cellH + wallGap)) * 10) / 10,
      w: Math.round(cellW * 10) / 10,
      h: Math.round(cellH * 10) / 10,
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
