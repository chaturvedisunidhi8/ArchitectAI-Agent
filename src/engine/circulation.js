/**
 * circulation.js — Carves a corridor spine from the building footprint
 * before subdivision.  Runs before the slicing tree.
 *
 * The corridor guarantees that every room is reachable from the entry
 * without passing through a bedroom or bathroom.
 *
 * @module circulation
 */

import { area as polyArea, splitPolygon, clipToRect, rectToPolygon } from './polygon.js';
import { MIN_CORRIDOR_WIDTH_FT, PRIVATE_ROOM_TYPES, snapToGrid } from './constants.js';

/**
 * @typedef {Object} CirculationResult
 * @property {import('./types.js').Polygon} corridor  - Corridor polygon.
 * @property {import('./types.js').Polygon[]} regions  - Flanking regions
 *   (1 or 2 polygons) on either side of the corridor.
 * @property {number} corridorWidth - Actual width used in feet.
 */

/**
 * Decide where to place the corridor and carve it from the footprint.
 *
 * @param {import('./types.js').Polygon} footprint - Building envelope.
 * @param {Object} opts
 * @param {'top'|'bottom'|'left'|'right'} [opts.entrySide='bottom'] - Which
 *   side the front door is on.
 * @param {number} [opts.totalArea] - Total floor area in sqft, used to
 *   decide whether a corridor is affordable.
 * @param {number} [opts.roomCount] - Number of rooms to place.
 * @param {'spine'|'l'|'t'} [opts.shape='spine'] - Corridor shape.
 * @returns {CirculationResult}
 */
export function carveCorridor(footprint, opts = {}) {
  const {
    entrySide = 'bottom',
    totalArea = 1200,
    roomCount = 8,
    shape = 'spine',
  } = opts;

  const b = boundingBox(footprint);
  const corridorW = computeCorridorWidth(b, totalArea, roomCount);

  // For small plans (< 800 sqft) or very few rooms, let the living room
  // serve as circulation hub instead of carving a dedicated corridor.
  const corridorArea = corridorW * (b.w > b.h ? b.h : b.w);
  const footprintArea = polyArea(footprint);
  if (footprintArea < 700 || roomCount <= 4 || corridorArea > footprintArea * 0.16) {
    return {
      corridor: [],
      regions: [footprint],
      corridorWidth: 0,
    };
  }

  return carveSpine(footprint, b, corridorW, entrySide);
}

/**
 * Carve a straight spine corridor through the footprint.
 */
function carveSpine(footprint, b, corridorW, entrySide) {
  // Spine runs through the center of the shorter axis.
  const horizontal = b.w >= b.h;

  // Both flanking regions are derived from the *same* snapped corridor edges
  // as the corridor polygon itself.  Deriving them independently leaves a
  // sub-inch sliver between region and hall, and every room then reads as
  // touching nothing — which strands the whole wing.
  if (horizontal) {
    // Horizontal spine across the middle.
    const near = snapToGrid(b.y + b.h / 2 - corridorW / 2);
    const far = near + corridorW;
    const corridor = rectToPolygon(b.x, near, b.w, corridorW);

    const bottom = clipToRect(footprint, { x: b.x, y: b.y, w: b.w, h: near - b.y });
    const top = clipToRect(footprint, { x: b.x, y: far, w: b.w, h: (b.y + b.h) - far });

    const regions = [];
    if (bottom.length >= 3) regions.push(bottom);
    if (top.length >= 3) regions.push(top);
    if (regions.length === 0) return { corridor: [], regions: [footprint], corridorWidth: 0 };

    return { corridor, regions, corridorWidth: corridorW };
  } else {
    // Vertical spine down the middle.
    const near = snapToGrid(b.x + b.w / 2 - corridorW / 2);
    const far = near + corridorW;
    const corridor = rectToPolygon(near, b.y, corridorW, b.h);

    const leftRegion = clipToRect(footprint, { x: b.x, y: b.y, w: near - b.x, h: b.h });
    const rightRegion = clipToRect(footprint, { x: far, y: b.y, w: (b.x + b.w) - far, h: b.h });

    const regions = [];
    if (leftRegion.length >= 3) regions.push(leftRegion);
    if (rightRegion.length >= 3) regions.push(rightRegion);
    if (regions.length === 0) return { corridor: [], regions: [footprint], corridorWidth: 0 };

    return { corridor, regions, corridorWidth: corridorW };
  }
}

/**
 * Compute corridor width based on plan size and room count.
 */
function computeCorridorWidth(b, totalArea, roomCount) {
  const minDim = Math.min(b.w, b.h);
  let w = MIN_CORRIDOR_WIDTH_FT;

  // Scale up slightly for larger plans.
  if (totalArea > 2000) w = Math.min(5, w + 0.5);
  if (roomCount > 10) w = Math.min(5, w + 0.5);

  // Don't exceed 15% of the shorter dimension.
  w = Math.min(w, minDim * 0.15);
  w = Math.max(w, MIN_CORRIDOR_WIDTH_FT);

  return snapToGrid(w);
}

/**
 * Check if a room can access the corridor without passing through private rooms.
 * This is a simplified check — the full reachability test is in adjacency.js.
 *
 * @param {Object} room - Room with { roomType } or { type }.
 * @returns {boolean}
 */
export function isPublicRoom(room) {
  const t = room.roomType || room.type;
  return !PRIVATE_ROOM_TYPES.has(t);
}

/**
 * Get bounding box of a polygon.
 */
function boundingBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
