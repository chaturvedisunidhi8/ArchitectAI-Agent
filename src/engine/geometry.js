/**
 * geometry.js — Wall graph generation, opening placement, and wall quads.
 *
 * Single source of truth for all wall geometry.  FloorPlanCanvas, model3d.js,
 * and exporters.js all read from the wall graph produced here.
 *
 * Wall objects have stable IDs and carry thickness, kind (exterior/interior),
 * and adjacency info.  Openings are parametric against wall IDs.
 *
 * @module geometry
 */

import {
  INTERIOR_WALL_FT, EXTERIOR_WALL_FT, DOOR_WIDTH_FT, DOOR_MIN_WIDTH_FT,
  CASED_OPENING_FT, DOOR_JAMB_CLEARANCE_FT, WINDOW_CORNER_CLEARANCE_FT,
  MIN_PIER_FT, WINDOWED_ROOMS, WINDOW_SPEC, DEFAULT_WINDOW_SPEC,
  PRIVATE_ROOM_TYPES, GRID_FT, snapToGrid,
} from './constants.js';
import { pointInPolygon, bbox as polyBbox } from './polygon.js';
import { planConnections, exteriorIntervals } from './planGraph.js';

let _wallSeq = 0;
let _openingSeq = 0;

function resetSequences() { _wallSeq = 0; _openingSeq = 0; }

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate the complete wall graph from room cells.
 *
 * @param {Object[]} rooms - Array of { id, x, y, w, h, type }.
 * @param {{ width: number, height: number }|null} boundary - Plan boundary.
 * @returns {{
 *   walls: Array<{id, x1, y1, x2, y2, start, end, thickness, kind, leftCellId, rightCellId}>,
 *   doors: Array<Opening>,
 *   windows: Array<Opening>,
 * }}
 */
export function generateWalls(rooms, boundary) {
  resetSequences();

  // Step 1: Extract edges from rooms.
  const edges = [];
  rooms.forEach(room => {
    if (room.polygon && room.polygon.length >= 3) {
      // Polygon room: each consecutive vertex pair is an edge.
      const pts = room.polygon;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        edges.push({ x1, y1, x2, y2, roomId: room.id, side: i });
      }
    } else {
      // Legacy rectangular room: extract 4 axis-aligned edges.
      const { id, x, y, w, h } = room;
      edges.push({ x1: x, y1: y, x2: x + w, y2: y, roomId: id, side: 'bottom' });
      edges.push({ x1: x + w, y1: y, x2: x + w, y2: y + h, roomId: id, side: 'right' });
      edges.push({ x1: x + w, y1: y + h, x2: x, y2: y + h, roomId: id, side: 'top' });
      edges.push({ x1: x, y1: y + h, x2: x, y2: y, roomId: id, side: 'left' });
    }
  });

  // Step 2: Merge collinear edges into wall segments.
  const walls = mergeEdges(edges, rooms, boundary);

  // Step 3: Solve the plan topology, then hang one opening on each contact
  // the solver says must be passable.
  const graph = planConnections(rooms, boundary);
  const doors = generateDoors(rooms, walls, boundary, graph);

  // Step 4: Place windows on what is left of the exterior walls.
  const windows = boundary ? generateWindows(rooms, boundary, doors, walls) : [];

  return {
    walls,
    doors,
    windows,
    entryRoomId: graph.entryId,
    connectivity: {
      stranded: graph.stranded,
      compromises: graph.compromises,
    },
  };
}

// ---------------------------------------------------------------------------
// Edge merging → wall segments
// ---------------------------------------------------------------------------

function mergeEdges(edges, rooms, boundary) {
  // Separate horizontal, vertical, and diagonal edges.
  const horizontal = [];
  const vertical = [];
  const diagonal = [];

  edges.forEach(e => {
    if (Math.abs(e.y1 - e.y2) < 0.01) {
      horizontal.push({
        fixed: e.y1,
        a: Math.min(e.x1, e.x2),
        b: Math.max(e.x1, e.x2),
        roomId: e.roomId,
        side: e.side,
      });
    } else if (Math.abs(e.x1 - e.x2) < 0.01) {
      vertical.push({
        fixed: e.x1,
        a: Math.min(e.y1, e.y2),
        b: Math.max(e.y1, e.y2),
        roomId: e.roomId,
        side: e.side,
      });
    } else {
      // Diagonal edge — each becomes its own wall segment (no merging).
      diagonal.push(e);
    }
  });

  const walls = [];
  mergeCollinear(horizontal).forEach(s => {
    const wall = createWall(s.a, s.fixed, s.b, s.fixed, s.roomIds, boundary);
    walls.push(wall);
  });
  mergeCollinear(vertical).forEach(s => {
    const wall = createWall(s.fixed, s.a, s.fixed, s.b, s.roomIds, boundary);
    walls.push(wall);
  });
  // Diagonal edges become individual wall segments.
  diagonal.forEach(e => {
    const wall = createWall(e.x1, e.y1, e.x2, e.y2, new Set([e.roomId]), boundary);
    walls.push(wall);
  });
  return walls;
}

/**
 * Merge overlapping/collinear segments and track which rooms they belong to.
 */
function mergeCollinear(segments) {
  const groups = new Map();
  segments.forEach(s => {
    const key = Math.round(s.fixed * 100) / 100;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });

  const result = [];
  groups.forEach((list, fixed) => {
    list.sort((p, q) => p.a - q.a);
    let cur = { fixed, a: list[0].a, b: list[0].b, roomIds: new Set([list[0].roomId]) };
    for (let i = 1; i < list.length; i++) {
      const seg = list[i];
      if (seg.a <= cur.b + 0.1) {
        cur.b = Math.max(cur.b, seg.b);
        cur.roomIds.add(seg.roomId);
      } else {
        result.push(cur);
        cur = { fixed, a: seg.a, b: seg.b, roomIds: new Set([seg.roomId]) };
      }
    }
    result.push(cur);
  });

  return result;
}

/**
 * Create a wall segment with ID, thickness, kind, and adjacency info.
 */
function createWall(x1, y1, x2, y2, roomIds, boundary) {
  const id = `wall_${_wallSeq++}`;
  const isHorizontal = Math.abs(y1 - y2) < 0.01;

  // Determine if this is an exterior or interior wall.
  let kind = 'interior';
  let leftCellId = null;
  let rightCellId = null;

  if (roomIds.size === 1) {
    // Only one room touches this edge → exterior wall.
    kind = 'exterior';
    leftCellId = [...roomIds][0];
  } else if (roomIds.size === 2) {
    // Two rooms share this edge → interior wall.
    kind = 'interior';
    const ids = [...roomIds];
    leftCellId = ids[0];
    rightCellId = ids[1];
  } else {
    // Multiple rooms — could be a corridor wall or complex junction.
    kind = 'interior';
    const ids = [...roomIds];
    leftCellId = ids[0];
    rightCellId = ids[1];
  }

  // Also check against the boundary for exterior detection.
  if (boundary && kind === 'interior') {
    const tol = 0.5;
    if (boundary.polygon && boundary.polygon.length >= 3) {
      // Polygon boundary: check if the wall midpoint lies on a boundary edge.
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if (isNearBoundaryPolygon(mx, my, boundary.polygon, tol)) {
        kind = 'exterior';
      }
    } else {
      // Legacy rectangular boundary: check axis-aligned edges.
      if (isHorizontal) {
        if (Math.abs(y1 - 0) < tol || Math.abs(y1 - boundary.height) < tol) {
          kind = 'exterior';
        }
      } else {
        if (Math.abs(x1 - 0) < tol || Math.abs(x1 - boundary.width) < tol) {
          kind = 'exterior';
        }
      }
    }
  }

  const thickness = kind === 'exterior' ? EXTERIOR_WALL_FT : INTERIOR_WALL_FT;

  return {
    id,
    x1: round1(x1), y1: round1(y1),
    x2: round1(x2), y2: round1(y2),
    start: [round1(x1), round1(y1)],
    end: [round1(x2), round1(y2)],
    thickness,
    kind,
    leftCellId,
    rightCellId,
  };
}

// ---------------------------------------------------------------------------
// Door placement
// ---------------------------------------------------------------------------

/**
 * Fit an opening of `want` feet inside the wall interval `[lo, hi]`, keeping
 * clear of both ends so the leaf never fouls a perpendicular wall.
 *
 * @returns {{start: number, width: number}|null} Null if nothing fits.
 */
function fitOpening(lo, hi, want) {
  const len = hi - lo;
  let clear = DOOR_JAMB_CLEARANCE_FT;
  let usable = len - clear * 2;

  // On a short contact, give up some of the clearance before giving up the
  // door — a tight jamb beats a sealed room.
  if (usable < DOOR_MIN_WIDTH_FT) {
    clear = 0.25;
    usable = len - clear * 2;
  }
  if (usable < DOOR_MIN_WIDTH_FT) return null;

  const width = Math.max(DOOR_MIN_WIDTH_FT, Math.min(want, usable));
  return { start: lo + clear, width: snapToGrid(width), usable, clear };
}

/**
 * Place one opening per connection the plan graph requires, plus a front door.
 *
 * Because a connection belongs to a *pair* of rooms, each shared wall gets
 * exactly one door — no more duplicated, mismatched arcs where two rooms both
 * decided to put a door on the same wall.
 */
function generateDoors(rooms, walls, boundary, graph) {
  const doors = [];
  const byId = new Map(rooms.map(r => [r.id, r]));
  const typeOf = (r) => r.roomType || r.type;

  graph.connections.forEach(conn => {
    const a = byId.get(conn.aId);
    const b = byId.get(conn.bId);
    if (!a || !b) return;

    const want = conn.kind === 'opening' ? CASED_OPENING_FT : DOOR_WIDTH_FT;
    const fit = fitOpening(conn.lo, conn.hi, want);
    if (!fit) return;

    // Where along the wall: cased openings centre on the contact; hinged
    // doors hug the corner nearest the more public room, which is how a
    // drafted plan keeps the long wall of a bedroom free for furniture.
    const aPrivate = PRIVATE_ROOM_TYPES.has(typeOf(a));
    const bPrivate = PRIVATE_ROOM_TYPES.has(typeOf(b));
    const publicRoom = aPrivate && !bPrivate ? b : (!aPrivate && bPrivate ? a : null);

    let start;
    if (conn.kind === 'opening' || !publicRoom) {
      start = conn.lo + (conn.hi - conn.lo - fit.width) / 2;
    } else {
      const along = conn.axis === 'h' ? publicRoom.x + publicRoom.w / 2 : publicRoom.y + publicRoom.h / 2;
      const mid = (conn.lo + conn.hi) / 2;
      start = along <= mid
        ? conn.lo + fit.clear
        : conn.hi - fit.clear - fit.width;
    }

    // Snap, then clamp back inside the clear zone the snap may have left.
    start = snapToGrid(start);
    start = Math.max(conn.lo + fit.clear, Math.min(start, conn.hi - fit.clear - fit.width));

    // Swing into the more private room, away from circulation.
    const swingRoom = publicRoom ? (publicRoom === a ? b : a) : a;
    const swingCentre = conn.axis === 'h'
      ? swingRoom.y + swingRoom.h / 2
      : swingRoom.x + swingRoom.w / 2;
    const swingDir = swingCentre < conn.fixed ? 'in' : 'out';

    const horizontal = conn.axis === 'h';
    const x = horizontal ? start : conn.fixed;
    const y = horizontal ? conn.fixed : start;

    const wall = findWallOnSide(
      horizontal
        ? { x1: conn.lo, y1: conn.fixed, x2: conn.hi, y2: conn.fixed }
        : { x1: conn.fixed, y1: conn.lo, x2: conn.fixed, y2: conn.hi },
      walls,
    );

    doors.push(createOpening({
      wallId: wall ? wall.id : null,
      offsetAlongWall: round1(start - conn.lo),
      width: round1(fit.width),
      kind: conn.kind,
      swingDirection: swingDir,
      roomId: swingRoom.id,
      connects: [conn.aId, conn.bId],
      side: horizontal ? 'h' : 'v',
      horizontal,
      x: round1(x),
      y: round1(y),
    }));
  });

  // --- Front door ----------------------------------------------------------
  const entry = byId.get(graph.entryId);
  if (entry && boundary) {
    const ext = exteriorIntervals(entry, boundary, rooms);
    if (ext.length > 0) {
      // Prefer the entrance facade (the bottom of the plan), then the longest.
      ext.sort((p, q) => {
        const pFront = p.axis === 'h' && Math.abs(p.fixed) < 0.5 ? 0 : 1;
        const qFront = q.axis === 'h' && Math.abs(q.fixed) < 0.5 ? 0 : 1;
        if (pFront !== qFront) return pFront - qFront;
        return q.len - p.len;
      });

      const s = ext[0];
      const fit = fitOpening(s.lo, s.hi, DOOR_WIDTH_FT);
      if (fit) {
        const start = snapToGrid(s.lo + (s.len - fit.width) / 2);
        const horizontal = s.axis === 'h';
        doors.push(createOpening({
          wallId: null,
          offsetAlongWall: round1(start - s.lo),
          width: round1(fit.width),
          kind: 'door',
          isEntry: true,
          swingDirection: s.outward < 0 ? 'out' : 'in',
          roomId: entry.id,
          connects: [entry.id, null],
          side: horizontal ? 'h' : 'v',
          horizontal,
          x: round1(horizontal ? start : s.fixed),
          y: round1(horizontal ? s.fixed : start),
        }));
      }
    }
  }

  return doors;
}

// ---------------------------------------------------------------------------
// Window placement
// ---------------------------------------------------------------------------

/**
 * Collect the spans already occupied by doors on one wall line, so windows
 * can be kept off them with a masonry pier in between.
 */
function occupiedSpans(doors, axis, fixed) {
  return doors
    .filter(d => (d.horizontal ? 'h' : 'v') === axis
      && Math.abs((axis === 'h' ? d.y : d.x) - fixed) < 0.3)
    .map(d => {
      const start = axis === 'h' ? d.x : d.y;
      return { lo: start - MIN_PIER_FT, hi: start + d.width + MIN_PIER_FT };
    });
}

/**
 * Place windows along every exterior wall of every daylit room.
 *
 * A long facade gets several evenly spaced windows rather than one wide slot,
 * each held clear of the corners and of any door already on that wall.  That
 * regular rhythm is most of what makes a drafted elevation read as designed.
 */
function generateWindows(rooms, boundary, doors, walls) {
  const windows = [];

  rooms.forEach(room => {
    const type = room.roomType || room.type;
    if (!WINDOWED_ROOMS.has(type)) return;

    const spec = WINDOW_SPEC[type] || DEFAULT_WINDOW_SPEC;
    const intervals = exteriorIntervals(room, boundary, rooms)
      .filter(s => s.len >= spec.minWall)
      .sort((a, b) => b.len - a.len);

    if (intervals.length === 0) return;

    // Daylight the two best facades; more than that and small rooms end up
    // with no solid wall left to put anything against.
    intervals.slice(0, 2).forEach(s => {
      const blocked = occupiedSpans(doors, s.axis, s.fixed);
      const clear = WINDOW_CORNER_CLEARANCE_FT;
      const usable = s.len - clear * 2;
      if (usable < 2) return;

      const count = Math.max(1, Math.min(spec.max, Math.floor(usable / (spec.unit + 2))));
      const slot = usable / count;
      const width = snapToGrid(Math.max(2, Math.min(spec.unit, slot - 1)));

      const wall = findWallOnSide(
        s.axis === 'h'
          ? { x1: s.lo, y1: s.fixed, x2: s.hi, y2: s.fixed }
          : { x1: s.fixed, y1: s.lo, x2: s.fixed, y2: s.hi },
        walls,
      );

      for (let i = 0; i < count; i++) {
        const centre = s.lo + clear + slot * (i + 0.5);
        const start = snapToGrid(centre - width / 2);
        if (start < s.lo + clear - 0.01 || start + width > s.hi - clear + 0.01) continue;
        if (blocked.some(bl => start < bl.hi && start + width > bl.lo)) continue;

        const horizontal = s.axis === 'h';
        windows.push(createOpening({
          wallId: wall ? wall.id : null,
          offsetAlongWall: round1(start - s.lo),
          width: round1(width),
          kind: 'window',
          swingDirection: 'none',
          roomId: room.id,
          side: horizontal ? 'h' : 'v',
          horizontal,
          x: round1(horizontal ? start : s.fixed),
          y: round1(horizontal ? s.fixed : start),
        }));

        blocked.push({ lo: start - MIN_PIER_FT, hi: start + width + MIN_PIER_FT });
      }
    });
  });

  return windows;
}

// ---------------------------------------------------------------------------
// Opening creation
// ---------------------------------------------------------------------------

function createOpening(opts) {
  return {
    id: `opening_${_openingSeq++}`,
    wallId: opts.wallId,
    offsetAlongWall: opts.offsetAlongWall || 0,
    width: opts.width,
    kind: opts.kind,
    swingDirection: opts.swingDirection || 'none',
    // The canvas renderer reads `swingDir`; keep both spellings in sync.
    swingDir: opts.swingDirection || 'none',
    roomId: opts.roomId,
    // The two rooms this opening joins (second is null for the front door).
    connects: opts.connects || null,
    isEntry: opts.isEntry || false,
    // Derived absolute coordinates (backward-compatible).
    x: opts.x,
    y: opts.y,
    horizontal: opts.horizontal,
    side: opts.side,
  };
}

// ---------------------------------------------------------------------------
// Wall quad generation (for poché rendering)
// ---------------------------------------------------------------------------

/**
 * Generate a filled polygon (quad) for a wall segment.
 * Each wall is expanded by thickness/2 on each side, with mitered corners.
 *
 * @param {Object} wall - WallSegment with { x1, y1, x2, y2, thickness }.
 * @returns {Array<[number, number]>} 4-vertex polygon.
 */
export function wallToQuad(wall) {
  const t = wall.thickness / 2;
  const { x1, y1, x2, y2 } = wall;
  const isH = Math.abs(y1 - y2) < 0.01;
  const isV = Math.abs(x1 - x2) < 0.01;

  if (isH) {
    return [
      [x1, y1 - t], [x2, y2 - t],
      [x2, y2 + t], [x1, y1 + t],
    ];
  } else if (isV) {
    return [
      [x1 - t, y1], [x2 - t, y2],
      [x2 + t, y2], [x1 + t, y1],
    ];
  }

  // Diagonal wall: use perpendicular direction.
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-12) return [[x1, y1], [x2, y2], [x2, y2], [x1, y1]];
  const nx = -dy / len, ny = dx / len;
  return [
    [x1 + nx * t, y1 + ny * t],
    [x2 + nx * t, y2 + ny * t],
    [x2 - nx * t, y2 - ny * t],
    [x1 - nx * t, y1 - ny * t],
  ];
}

/**
 * Generate wall quads for all walls, with mitered corners at junctions.
 * For Phase 1 this returns simple quads; mitering can be enhanced later
 * when wall junctions are tracked.
 *
 * @param {Object[]} walls
 * @returns {Array<Array<[number, number]>>} Array of quads.
 */
export function generateWallQuads(walls) {
  return walls.map(wallToQuad);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExteriorSide(room, side, boundary) {
  const tol = 0.5;
  if (boundary.polygon && boundary.polygon.length >= 3) {
    // Polygon boundary: check if the midpoint of this side is near a boundary edge.
    let mx, my;
    switch (side) {
      case 'bottom': mx = room.x + room.w / 2; my = room.y; break;
      case 'top': mx = room.x + room.w / 2; my = room.y + room.h; break;
      case 'left': mx = room.x; my = room.y + room.h / 2; break;
      case 'right': mx = room.x + room.w; my = room.y + room.h / 2; break;
      default: return false;
    }
    return isNearBoundaryPolygon(mx, my, boundary.polygon, tol);
  }
  switch (side) {
    case 'bottom': return Math.abs(room.y - 0) < tol;
    case 'top': return Math.abs((room.y + room.h) - boundary.height) < tol;
    case 'left': return Math.abs(room.x - 0) < tol;
    case 'right': return Math.abs((room.x + room.w) - boundary.width) < tol;
    default: return false;
  }
}

/**
 * Check if a point is within `tol` of any edge of a boundary polygon.
 */
function isNearBoundaryPolygon(px, py, boundaryPoly, tol) {
  const n = boundaryPoly.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = boundaryPoly[i];
    const [x2, y2] = boundaryPoly[(i + 1) % n];
    const dist = pointToSegmentDist(px, py, x1, y1, x2, y2);
    if (dist < tol) return true;
  }
  return false;
}

/**
 * Minimum distance from point (px,py) to segment (x1,y1)-(x2,y2).
 */
function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx, projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function findWallOnSide(side, walls) {
  return walls.find(w => {
    // Check if this wall overlaps with the given side/edge.
    return edgesOverlap(w.x1, w.y1, w.x2, w.y2, side.x1, side.y1, side.x2, side.y2);
  });
}

function segmentsOverlap(a1, a2, b1, b2) {
  const lo = Math.max(Math.min(a1, a2), Math.min(b1, b2));
  const hi = Math.min(Math.max(a1, a2), Math.max(b1, b2));
  return hi - lo > 0.1;
}

/**
 * Check if two line segments overlap (share at least 0.1 ft in common).
 * Works for both axis-aligned and diagonal segments.
 */
function edgesOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  // Compute overlap length by projecting both segments onto the line direction.
  const adx = ax2 - ax1, ady = ay2 - ay1;
  const len = Math.sqrt(adx * adx + ady * ady);
  if (len < 0.1) return false;
  const dirX = adx / len, dirY = ady / len;

  // Project both segments onto the direction vector.
  const aStart = ax1 * dirX + ay1 * dirY;
  const aEnd = ax2 * dirX + ay2 * dirY;
  const bStart = bx1 * dirX + by1 * dirY;
  const bEnd = bx2 * dirX + by2 * dirY;

  const aLo = Math.min(aStart, aEnd), aHi = Math.max(aStart, aEnd);
  const bLo = Math.min(bStart, bEnd), bHi = Math.max(bStart, bEnd);
  const overlap = Math.min(aHi, bHi) - Math.max(aLo, bLo);

  return overlap > 0.1;
}

const round1 = v => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Legacy helpers (kept for backward compat)
// ---------------------------------------------------------------------------

export function getRoomCenter(room) {
  return { x: room.x + room.w / 2, y: room.y + room.h / 2 };
}

export function pointInRoom(px, py, room) {
  return px >= room.x && px <= room.x + room.w && py >= room.y && py <= room.y + room.h;
}

export function roomsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function roomContainsPoint(rx, ry, rw, rh, px, py) {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}
