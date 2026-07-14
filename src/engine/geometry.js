import {
  WALL_THICKNESS_FT, DOOR_WIDTH_FT, WINDOWED_ROOMS,
  WINDOW_MIN_WALL_FT,
} from './constants.js';

export function generateWalls(rooms, boundary) {
  const edges = [];
  rooms.forEach((room) => {
    const { id, x, y, w, h } = room;
    edges.push({ x1: x, y1: y, x2: x + w, y2: y, roomId: id, side: 'bottom' });
    edges.push({ x1: x + w, y1: y, x2: x + w, y2: y + h, roomId: id, side: 'right' });
    edges.push({ x1: x + w, y1: y + h, x2: x, y2: y + h, roomId: id, side: 'top' });
    edges.push({ x1: x, y1: y + h, x2: x, y2: y, roomId: id, side: 'left' });
  });

  const merged = mergeEdges(edges);
  const doors = generateDoors(rooms, merged);
  const windows = boundary ? generateWindows(rooms, boundary, doors) : [];

  return { walls: merged, doors, windows };
}

// A wall side is "exterior" when it lies on the plan boundary.
function isExteriorSide(room, side, boundary) {
  const tol = 0.5;
  switch (side) {
    case 'bottom': return Math.abs(room.y - 0) < tol;
    case 'top': return Math.abs((room.y + room.h) - boundary.height) < tol;
    case 'left': return Math.abs(room.x - 0) < tol;
    case 'right': return Math.abs((room.x + room.w) - boundary.width) < tol;
    default: return false;
  }
}

// Place a centered window on the longest exterior wall of each windowed room,
// avoiding any door already placed on that same wall.
function generateWindows(rooms, boundary, doors) {
  const windows = [];

  rooms.forEach((room) => {
    if (!WINDOWED_ROOMS.has(room.type)) return;

    const sides = [
      { side: 'bottom', horizontal: true, x1: room.x, y1: room.y, len: room.w },
      { side: 'top', horizontal: true, x1: room.x, y1: room.y + room.h, len: room.w },
      { side: 'left', horizontal: false, x1: room.x, y1: room.y, len: room.h },
      { side: 'right', horizontal: false, x1: room.x + room.w, y1: room.y, len: room.h },
    ].filter(s => isExteriorSide(room, s.side, boundary) && s.len >= WINDOW_MIN_WALL_FT);

    if (sides.length === 0) return;
    sides.sort((a, b) => b.len - a.len);
    const s = sides[0];

    const winW = Math.min(Math.max(s.len * 0.45, 3), 6);
    const offset = (s.len - winW) / 2;

    // Skip if a door sits on this same wall in the overlapping span.
    const conflicts = doors.some(d =>
      d.roomId === room.id && d.horizontal === s.horizontal &&
      (s.horizontal ? Math.abs(d.y - s.y1) < 0.3 : Math.abs(d.x - s.x1) < 0.3)
    );
    if (conflicts && s.len < winW + DOOR_WIDTH_FT + 2) return;

    if (s.horizontal) {
      windows.push({
        x: s.x1 + offset, y: s.y1, width: winW,
        horizontal: true, roomId: room.id, side: s.side,
      });
    } else {
      windows.push({
        x: s.x1, y: s.y1 + offset, width: winW,
        horizontal: false, roomId: room.id, side: s.side,
      });
    }
  });

  return windows;
}

function mergeEdges(edges) {
  // Reduce room-edge line segments to a minimal set of walls. Horizontal edges
  // share a constant y; vertical edges a constant x. Overlapping / touching
  // collinear segments (including the duplicate an interior wall gets from each
  // of the two rooms it separates) are unioned into a single wall segment.
  const horizontal = edges
    .filter(e => Math.abs(e.y1 - e.y2) < 0.01)
    .map(e => ({ fixed: e.y1, a: Math.min(e.x1, e.x2), b: Math.max(e.x1, e.x2) }));
  const vertical = edges
    .filter(e => Math.abs(e.x1 - e.x2) < 0.01)
    .map(e => ({ fixed: e.x1, a: Math.min(e.y1, e.y2), b: Math.max(e.y1, e.y2) }));

  const out = [];
  mergeCollinear(horizontal).forEach(s => out.push({ x1: s.a, y1: s.fixed, x2: s.b, y2: s.fixed }));
  mergeCollinear(vertical).forEach(s => out.push({ x1: s.fixed, y1: s.a, x2: s.fixed, y2: s.b }));
  return out;
}

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
    let cur = { fixed, a: list[0].a, b: list[0].b };
    for (let i = 1; i < list.length; i++) {
      const seg = list[i];
      if (seg.a <= cur.b + 0.1) {
        cur.b = Math.max(cur.b, seg.b); // overlapping or adjacent → extend
      } else {
        result.push(cur);
        cur = { fixed, a: seg.a, b: seg.b };
      }
    }
    result.push(cur);
  });

  return result;
}

function generateDoors(rooms, walls) {
  const doors = [];
  const halfWall = WALL_THICKNESS_FT / 2;

  rooms.forEach(room => {
    const sides = [
      { side: 'bottom', x1: room.x, y1: room.y, x2: room.x + room.w, y2: room.y, horizontal: true },
      { side: 'top', x1: room.x, y1: room.y + room.h, x2: room.x + room.w, y2: room.y + room.h, horizontal: true },
      { side: 'left', x1: room.x, y1: room.y, x2: room.x, y2: room.y + room.h, horizontal: false },
      { side: 'right', x1: room.x + room.w, y1: room.y, x2: room.x + room.w, y2: room.y + room.h, horizontal: false },
    ];

    let placed = false;
    const order = room.type === 'bathroom' || room.type === 'store' || room.type === 'laundry'
      ? [2, 3, 1, 0]
      : [0, 2, 3, 1];

    order.forEach(si => {
      if (placed) return;
      const s = sides[si];
      const len = s.horizontal ? (s.x2 - s.x1) : (s.y2 - s.y1);
      if (len < DOOR_WIDTH_FT + 1) return;

      const offset = len * 0.35;
      if (s.horizontal) {
        const dx = s.x1 + offset;
        doors.push({
          x: dx, y: s.y1,
          width: DOOR_WIDTH_FT,
          horizontal: true,
          roomId: room.id,
          side: s.side,
          swingDir: s.side === 'bottom' ? 'in' : 'out',
        });
      } else {
        const dy = s.y1 + offset;
        doors.push({
          x: s.x1, y: dy,
          width: DOOR_WIDTH_FT,
          horizontal: false,
          roomId: room.id,
          side: s.side,
          swingDir: s.side === 'left' ? 'in' : 'out',
        });
      }
      placed = true;
    });
  });

  return doors;
}

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
