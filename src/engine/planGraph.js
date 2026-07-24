/**
 * planGraph.js — Topology of a floor plan: which rooms actually touch, where
 * they touch, and which of those contacts must become a door.
 *
 * The old placement logic asked each room independently "which of my edges
 * looks best for a door?".  That produces two doors on one shared wall at
 * different offsets, doors that open into a bedroom, and rooms whose only
 * door lands on an exterior wall — a sealed room.
 *
 * This module inverts the problem.  A door is not a property of a room, it is
 * a property of the *contact between two rooms*.  So we:
 *
 *   1. compute the exact shared-wall interval for every pair of cells,
 *   2. grow a spanning tree from the entry over that contact graph, weighted
 *      by architectural affinity, never traversing *through* a private room,
 *   3. emit one opening per tree edge, plus extra cased openings where two
 *      public rooms should read as one space.
 *
 * The result is connected by construction: every room is reachable from the
 * front door, and no room can end up sealed.
 *
 * @module planGraph
 */

import { bbox as polyBbox, rectToPolygon } from './polygon.js';
import { getAdjacencyWeight } from './adjacency.js';
import { PRIVATE_ROOM_TYPES, DOOR_MIN_WIDTH_FT, DOOR_JAMB_CLEARANCE_FT } from './constants.js';

/** Shortest contact that can still hold a door plus its jamb clearances. */
export const MIN_CONTACT_FT = DOOR_MIN_WIDTH_FT + DOOR_JAMB_CLEARANCE_FT * 2;

/** Coincidence tolerance for two wall lines being "the same wall" (ft). */
const TOL = 0.06;

/** Room types that read as one continuous space when they adjoin. */
const OPEN_PAIRS = new Set([
  'dining|living', 'dining|kitchen', 'kitchen|living', 'hall|living',
]);

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** adjacency.js predates the `hall` cell and spells it `hallway`. */
const normType = (t) => (t === 'hall' ? 'hallway' : t);

const affinity = (a, b) => getAdjacencyWeight(normType(a), normType(b));

const isPrivate = (type) => PRIVATE_ROOM_TYPES.has(type);

const roomType = (r) => r.roomType || r.type;

// ---------------------------------------------------------------------------
// Edge extraction
// ---------------------------------------------------------------------------

/**
 * Decompose a cell into its axis-aligned edges.
 *
 * @param {Object} room - RoomCell or legacy `{x,y,w,h}` room.
 * @returns {{axis:'h'|'v', fixed:number, lo:number, hi:number}[]}
 */
export function cellEdges(room) {
  const pts = (room.polygon && room.polygon.length >= 3)
    ? room.polygon
    : rectToPolygon(room.x, room.y, room.w, room.h);

  const edges = [];
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    if (Math.abs(y1 - y2) < TOL && Math.abs(x1 - x2) > TOL) {
      edges.push({ axis: 'h', fixed: y1, lo: Math.min(x1, x2), hi: Math.max(x1, x2) });
    } else if (Math.abs(x1 - x2) < TOL && Math.abs(y1 - y2) > TOL) {
      edges.push({ axis: 'v', fixed: x1, lo: Math.min(y1, y2), hi: Math.max(y1, y2) });
    }
    // Diagonal edges carry no doors and are ignored here.
  }
  return edges;
}

/**
 * Find every wall interval two cells genuinely share.
 *
 * @param {Object} a - RoomCell.
 * @param {Object} b - RoomCell.
 * @returns {{axis:'h'|'v', fixed:number, lo:number, hi:number, len:number}[]}
 */
export function sharedIntervals(a, b) {
  const out = [];
  const ae = cellEdges(a);
  const be = cellEdges(b);

  ae.forEach(e1 => {
    be.forEach(e2 => {
      if (e1.axis !== e2.axis) return;
      if (Math.abs(e1.fixed - e2.fixed) > TOL) return;
      const lo = Math.max(e1.lo, e2.lo);
      const hi = Math.min(e1.hi, e2.hi);
      const len = hi - lo;
      if (len > TOL) out.push({ axis: e1.axis, fixed: e1.fixed, lo, hi, len });
    });
  });

  // Merge intervals that touch, so a wall split by a stray vertex still reads
  // as one contact.
  out.sort((p, q) => p.fixed - q.fixed || p.lo - q.lo);
  const merged = [];
  out.forEach(iv => {
    const last = merged[merged.length - 1];
    if (last && last.axis === iv.axis && Math.abs(last.fixed - iv.fixed) < TOL && iv.lo <= last.hi + TOL) {
      last.hi = Math.max(last.hi, iv.hi);
      last.len = last.hi - last.lo;
    } else {
      merged.push({ ...iv });
    }
  });

  return merged;
}

/**
 * Build the full contact graph.
 *
 * @param {Object[]} rooms
 * @param {number} [minLen] - Ignore contacts shorter than this.
 * @returns {Map<string, {aId, bId, axis, fixed, lo, hi, len}>} Keyed "idA|idB".
 */
export function buildContactGraph(rooms, minLen = MIN_CONTACT_FT) {
  const contacts = new Map();

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      const ivs = sharedIntervals(a, b);
      if (ivs.length === 0) continue;
      // Keep the longest contact — that is where a door would go.
      const best = ivs.reduce((m, iv) => (iv.len > m.len ? iv : m), ivs[0]);
      if (best.len < minLen) continue;
      contacts.set(pairKey(a.id, b.id), { aId: a.id, bId: b.id, ...best });
    }
  }

  return contacts;
}

// ---------------------------------------------------------------------------
// Exterior walls
// ---------------------------------------------------------------------------

/**
 * Wall intervals of a room that face outside — i.e. lie on the building
 * envelope and are not shared with another room.
 *
 * @param {Object} room
 * @param {{width:number, height:number}} boundary
 * @param {Object[]} allRooms
 * @returns {{axis:'h'|'v', fixed:number, lo:number, hi:number, len:number,
 *            outward:1|-1}[]}
 */
export function exteriorIntervals(room, boundary, allRooms) {
  if (!boundary) return [];
  const result = [];

  cellEdges(room).forEach(edge => {
    // On the envelope?
    let outward = 0;
    if (edge.axis === 'h') {
      if (Math.abs(edge.fixed) < 0.5) outward = -1;
      else if (Math.abs(edge.fixed - boundary.height) < 0.5) outward = 1;
    } else {
      if (Math.abs(edge.fixed) < 0.5) outward = -1;
      else if (Math.abs(edge.fixed - boundary.width) < 0.5) outward = 1;
    }
    if (outward === 0) return;

    // Subtract any stretch shared with a neighbour (an inner courtyard edge
    // can sit on the envelope line without actually facing outside).
    let spans = [{ lo: edge.lo, hi: edge.hi }];
    allRooms.forEach(other => {
      if (other.id === room.id) return;
      cellEdges(other).forEach(oe => {
        if (oe.axis !== edge.axis || Math.abs(oe.fixed - edge.fixed) > TOL) return;
        spans = spans.flatMap(s => subtractSpan(s, oe.lo, oe.hi));
      });
    });

    spans.forEach(s => {
      const len = s.hi - s.lo;
      if (len > 1) {
        result.push({ axis: edge.axis, fixed: edge.fixed, lo: s.lo, hi: s.hi, len, outward });
      }
    });
  });

  return result;
}

function subtractSpan(span, lo, hi) {
  if (hi <= span.lo + TOL || lo >= span.hi - TOL) return [span];
  const out = [];
  if (lo > span.lo + TOL) out.push({ lo: span.lo, hi: lo });
  if (hi < span.hi - TOL) out.push({ lo: hi, hi: span.hi });
  return out;
}

// ---------------------------------------------------------------------------
// Connectivity
// ---------------------------------------------------------------------------

/**
 * Score a candidate contact as a place to put a door.  Higher is better.
 */
function contactWeight(a, b, contact) {
  const ta = roomType(a);
  const tb = roomType(b);
  let w = affinity(ta, tb) * 10;

  // A hallway exists to be opened onto — strongly prefer it.
  if (ta === 'hall' || tb === 'hall') w += 40;

  // Longer contacts give the door more room to sit well.
  w += Math.min(contact.len, 14);

  // Bedrooms and bathrooms should hang off circulation, not off each other.
  if (isPrivate(ta) && isPrivate(tb) && !(ta === 'bathroom' || tb === 'bathroom')) w -= 60;

  // A bathroom door opening straight into a room people sit in is poor
  // planning — it belongs off a hall, a landing, or the bedroom it serves.
  const ENTERTAINING = new Set(['living', 'dining', 'kitchen']);
  if ((ta === 'bathroom' && ENTERTAINING.has(tb)) || (tb === 'bathroom' && ENTERTAINING.has(ta))) w -= 25;

  return w;
}

/**
 * Choose the room the front door opens into.
 */
function pickEntry(rooms) {
  const byType = (t) => rooms.filter(r => roomType(r) === t);
  const hall = byType('hall');
  if (hall.length > 0) {
    return hall.reduce((m, r) => (r.w * r.h > m.w * m.h ? r : m), hall[0]);
  }
  const living = byType('living');
  if (living.length > 0) return living[0];
  const publics = rooms.filter(r => !isPrivate(roomType(r)));
  const pool = publics.length > 0 ? publics : rooms;
  return pool.reduce((m, r) => (r.w * r.h > m.w * m.h ? r : m), pool[0]);
}

/**
 * Plan every opening in the layout.
 *
 * Grows a spanning tree from the entry room across the contact graph.  An
 * edge may only be used to *leave* a room that is not private, so bedrooms
 * and bathrooms become leaves and are never walked through.  If that rule
 * would strand a room, it is relaxed for that room and the compromise is
 * reported rather than hidden.
 *
 * @param {Object[]} rooms
 * @param {{width:number, height:number}} boundary
 * @returns {{
 *   entryId: string,
 *   connections: {aId, bId, axis, fixed, lo, hi, len, kind:'door'|'opening'}[],
 *   stranded: string[],
 *   compromises: string[],
 * }}
 */
export function planConnections(rooms, boundary) {
  const contacts = buildContactGraph(rooms);
  const byId = new Map(rooms.map(r => [r.id, r]));

  if (rooms.length === 0) {
    return { entryId: null, connections: [], stranded: [], compromises: [] };
  }

  const entry = pickEntry(rooms);
  const visited = new Set([entry.id]);
  const chosen = [];
  const compromises = [];

  const allContacts = [...contacts.values()];

  // --- Prim's, with the through-private rule as a hard constraint ----------
  const grow = (allowThroughPrivate) => {
    let progressed = true;
    while (visited.size < rooms.length && progressed) {
      progressed = false;
      let best = null;
      let bestW = -Infinity;

      allContacts.forEach(c => {
        const aIn = visited.has(c.aId);
        const bIn = visited.has(c.bId);
        if (aIn === bIn) return; // both in, or both out

        const fromId = aIn ? c.aId : c.bId;
        const toId = aIn ? c.bId : c.aId;
        const from = byId.get(fromId);
        const to = byId.get(toId);
        if (!from || !to) return;

        // Leaving a private room to reach another room means routing
        // circulation through somebody's bedroom.
        if (!allowThroughPrivate && isPrivate(roomType(from))) return;

        const w = contactWeight(from, to, c);
        if (w > bestW) { bestW = w; best = { c, fromId, toId }; }
      });

      if (best) {
        visited.add(best.toId);
        chosen.push({ ...best.c, kind: 'door' });
        progressed = true;
        if (allowThroughPrivate) {
          const from = byId.get(best.fromId);
          const to = byId.get(best.toId);
          compromises.push({
            message: `${to.label} can only be reached through ${from.label}`,
            // Walking through someone's bedroom or bathroom to reach a room
            // is a different order of problem from a mild detour.
            severe: isPrivate(roomType(from)),
          });
        }
      }
    }
  };

  grow(false);
  if (visited.size < rooms.length) grow(true);

  const stranded = rooms.filter(r => !visited.has(r.id)).map(r => r.id);

  // --- Extra openings where two rooms should read as one space -------------
  const used = new Set(chosen.map(c => pairKey(c.aId, c.bId)));
  allContacts.forEach(c => {
    const key = pairKey(c.aId, c.bId);
    if (used.has(key)) return;
    const a = byId.get(c.aId);
    const b = byId.get(c.bId);
    if (!a || !b) return;
    const ta = roomType(a);
    const tb = roomType(b);
    if (isPrivate(ta) || isPrivate(tb)) return;
    if (affinity(ta, tb) < 7) return;
    used.add(key);
    chosen.push({ ...c, kind: OPEN_PAIRS.has(pairKey(ta, tb)) ? 'opening' : 'door' });
  });

  // Mark tree edges between two public rooms as cased openings too.
  chosen.forEach(c => {
    const ta = roomType(byId.get(c.aId));
    const tb = roomType(byId.get(c.bId));
    if (OPEN_PAIRS.has(pairKey(ta, tb)) && c.len >= 7) c.kind = 'opening';
  });

  return { entryId: entry.id, connections: chosen, stranded, compromises };
}
