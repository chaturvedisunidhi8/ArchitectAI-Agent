/**
 * roomCell.js — RoomCell class with polygon representation and bbox
 * compatibility layer.
 *
 * Existing consumers read `room.x`, `room.y`, `room.w`, `room.h`.
 * Those properties are derived from the polygon bounding box and kept in
 * sync automatically.  Do NOT set them directly — they are read-only getters.
 *
 * @module roomCell
 */

import { area as polyArea, centroid as polyCentroid, bbox as polyBbox, rectToPolygon } from './polygon.js';

let _nextId = 1;

/**
 * Create a RoomCell from a polygon or from legacy {x, y, w, h} params.
 *
 * @param {Object} opts
 * @param {string}          opts.id
 * @param {string}          opts.roomType
 * @param {string}          opts.label
 * @param {import('./types.js').Polygon} [opts.polygon]  - Explicit polygon.
 * @param {number}          [opts.x] - Legacy: top-left X.
 * @param {number}          [opts.y] - Legacy: top-left Y.
 * @param {number}          [opts.w] - Legacy: width.
 * @param {number}          [opts.h] - Legacy: height.
 * @param {number}          opts.targetArea
 * @param {string}          [opts.color]
 * @param {number}          [opts.aspectTarget]
 * @param {string}          [opts.floorType]
 * @returns {import('./types.js').RoomCell}
 */
export function createRoomCell(opts) {
  const poly = opts.polygon || rectToPolygon(opts.x ?? 0, opts.y ?? 0, opts.w ?? 1, opts.h ?? 1);
  const b = polyBbox(poly);
  const c = polyCentroid(poly);

  const cell = {
    id: opts.id || `cell_${_nextId++}`,
    roomType: opts.roomType,
    label: opts.label || opts.roomType,
    polygon: poly,
    targetArea: opts.targetArea,
    actualArea: polyArea(poly),
    centroid: c,
    color: opts.color || '#cccccc',
    aspectTarget: opts.aspectTarget || 1.2,
    floorType: opts.floorType || null,
  };

  // Expose derived bbox as read-only properties via defineProperty so
  // that existing code reading cell.x / cell.y / cell.w / cell.h works.
  // For rectangular cells these values are exact.  For non-rectangular
  // cells they represent the bounding box (sufficient for Phase 1-6 consumers).
  Object.defineProperty(cell, 'x', {
    get() { return polyBbox(this.polygon).x; },
    enumerable: true,
  });
  Object.defineProperty(cell, 'y', {
    get() { return polyBbox(this.polygon).y; },
    enumerable: true,
  });
  Object.defineProperty(cell, 'w', {
    get() { return polyBbox(this.polygon).w; },
    enumerable: true,
  });
  Object.defineProperty(cell, 'h', {
    get() { return polyBbox(this.polygon).h; },
    enumerable: true,
  });

  return cell;
}

/**
 * Migrate a legacy room object `{id, type, label, targetArea, color, x, y, w, h, ...}`
 * into a proper RoomCell with a rectangular polygon.
 *
 * @param {Object} legacy - Old-format room object.
 * @returns {import('./types.js').RoomCell}
 */
export function migrateLegacyRoom(legacy) {
  return createRoomCell({
    id: legacy.id,
    roomType: legacy.type,
    label: legacy.label,
    x: legacy.x,
    y: legacy.y,
    w: legacy.w,
    h: legacy.h,
    targetArea: legacy.targetArea || legacy.w * legacy.h,
    color: legacy.color,
    aspectTarget: legacy.aspectTarget,
    floorType: legacy.floorType,
  });
}
