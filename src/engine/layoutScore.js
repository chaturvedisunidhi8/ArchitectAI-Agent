/**
 * layoutScore.js — Multi-objective fitness function for floor plan candidates.
 *
 * The auto-designer generates a large pool of candidate layouts and needs a
 * single comparable number to rank them by.  Rather than one metric, a plan is
 * judged on eight independent criteria (adjacency, area fidelity, proportion,
 * daylight, ventilation, privacy, efficiency, vastu), each normalised to 0-100
 * and combined with weights that shift based on what the user asked for.
 *
 * Reachability is treated as a hard constraint: an unreachable plan keeps its
 * breakdown but is heavily discounted so it can never win over a valid one.
 *
 * @module layoutScore
 */

import { MAX_ASPECT_RATIO, MIN_DIMENSIONS } from './constants.js';
import { getAdjacencyWeight, checkReachability, detectAdjacencies } from './adjacency.js';
import { analyzeEnergy } from './energyAnalyzer.js';
import { checkVastu } from './vastu.js';

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

// ---------------------------------------------------------------------------
// Metric catalogue — drives both the scoring and the UI report
// ---------------------------------------------------------------------------

/**
 * Display metadata for every metric, in the order the report shows them.
 * @type {{key: string, label: string, desc: string}[]}
 */
export const METRICS = [
  { key: 'adjacency', label: 'Room Flow', desc: 'Rooms that belong together share a wall' },
  { key: 'areaFidelity', label: 'Size Accuracy', desc: 'Each room matches the area you asked for' },
  { key: 'proportion', label: 'Proportions', desc: 'No slivers — rooms are usable shapes' },
  { key: 'daylight', label: 'Natural Light', desc: 'Exterior walls and windows per room' },
  { key: 'ventilation', label: 'Ventilation', desc: 'Cross-breeze potential across the plan' },
  { key: 'privacy', label: 'Privacy', desc: 'Bathrooms and bedrooms kept off public rooms' },
  { key: 'efficiency', label: 'Space Use', desc: 'Floor area used by rooms vs circulation' },
  { key: 'vastu', label: 'Vastu', desc: 'Directional placement per Vastu Shastra' },
];

/**
 * Default weights, summing to 100.  Tuned so that a plan cannot win on
 * daylight alone while ignoring flow or room sizes.
 */
export const BASE_WEIGHTS = {
  adjacency: 22,
  areaFidelity: 18,
  proportion: 15,
  daylight: 12,
  ventilation: 8,
  privacy: 10,
  efficiency: 10,
  vastu: 5,
};

/**
 * Multipliers applied to the base weights when the brief signals a priority.
 * After all multipliers are applied the weights are renormalised to 100, so
 * boosting one criterion automatically de-emphasises the rest.
 */
const PREFERENCE_MULTIPLIERS = {
  vastu: { vastu: 4.0, adjacency: 0.85 },
  daylight: { daylight: 2.0, ventilation: 1.8 },
  privacy: { privacy: 2.2, adjacency: 0.9 },
  openPlan: { adjacency: 1.4, privacy: 0.5, efficiency: 1.2 },
  compact: { efficiency: 1.8, areaFidelity: 1.2, daylight: 0.8 },
  luxury: { proportion: 1.5, areaFidelity: 1.3, efficiency: 0.7 },
};

/**
 * Resolve the weight vector for a design brief.
 *
 * @param {Object} [preferences] - Flags from the brief, e.g. `{ vastu: true }`.
 * @returns {Object<string, number>} Weights summing to 100.
 */
export function resolveWeights(preferences = {}) {
  const weights = { ...BASE_WEIGHTS };

  Object.entries(PREFERENCE_MULTIPLIERS).forEach(([pref, multipliers]) => {
    if (!preferences[pref]) return;
    Object.entries(multipliers).forEach(([key, mult]) => {
      weights[key] = (weights[key] || 0) * mult;
    });
  });

  const sum = Object.values(weights).reduce((s, w) => s + w, 0) || 1;
  Object.keys(weights).forEach(key => {
    weights[key] = round1((weights[key] / sum) * 100);
  });

  return weights;
}

// ---------------------------------------------------------------------------
// Individual metrics
// ---------------------------------------------------------------------------

/**
 * How closely each room's share of the built area matches its requested share.
 *
 * Compares *shares* rather than absolute areas so that a plan is not punished
 * for the floor area a corridor legitimately consumes.
 *
 * @param {import('./types.js').RoomCell[]} rooms
 * @returns {{ score: number, note: string }}
 */
export function scoreAreaFidelity(rooms) {
  if (!rooms || rooms.length === 0) return { score: 0, note: 'No rooms' };

  const actualTotal = rooms.reduce((s, r) => s + (r.actualArea || r.w * r.h), 0);
  const targetTotal = rooms.reduce((s, r) => s + (r.targetArea || 0), 0);
  if (actualTotal <= 0 || targetTotal <= 0) return { score: 50, note: 'No target areas to compare' };

  let worst = null;
  const errors = rooms.map(room => {
    const actualShare = (room.actualArea || room.w * room.h) / actualTotal;
    const targetShare = (room.targetArea || 0) / targetTotal;
    const err = targetShare > 0 ? Math.abs(actualShare - targetShare) / targetShare : 0;
    if (!worst || err > worst.err) worst = { label: room.label, err };
    return err;
  });

  const meanErr = errors.reduce((s, e) => s + e, 0) / errors.length;
  // A 10% mean deviation still scores 80; 50% deviation bottoms out.
  const score = clamp(100 - meanErr * 200);

  return {
    score: Math.round(score),
    note: worst && worst.err > 0.25
      ? `${worst.label} is ${Math.round(worst.err * 100)}% off its requested size`
      : `Rooms within ${Math.round(meanErr * 100)}% of requested sizes on average`,
  };
}

/**
 * Penalise rooms that are too elongated or too narrow to furnish.
 *
 * @param {import('./types.js').RoomCell[]} rooms
 * @returns {{ score: number, note: string, offenders: string[] }}
 */
export function scoreProportion(rooms) {
  if (!rooms || rooms.length === 0) return { score: 0, note: 'No rooms', offenders: [] };

  const offenders = [];

  const perRoom = rooms.map(room => {
    const w = room.w, h = room.h;
    if (w <= 0 || h <= 0) { offenders.push(room.label); return 0; }

    const aspect = Math.max(w, h) / Math.min(w, h);
    let penalty = 0;

    // A corridor is *meant* to be long and thin — judging it against the
    // ceiling for habitable rooms scores every hallway plan into last place,
    // which is why the search kept returning plans with no circulation at all.
    // What matters for a hall is that it is wide enough to walk down.
    if (room.roomType === 'hall') {
      const width = Math.min(w, h);
      const need = MIN_DIMENSIONS.hall.w;
      return clamp(100 - (width < need ? ((need - width) / need) * 100 : 0));
    }

    // Hard penalty past the engine's usable-aspect ceiling.
    const excess = Math.max(0, aspect - MAX_ASPECT_RATIO);
    penalty += Math.min(60, excess * 40);

    // Soft nudge toward the room type's ideal proportion.
    const target = room.aspectTarget || 1.2;
    penalty += Math.min(20, Math.abs(aspect - target) * 10);

    // Short side must clear the minimum usable dimension for the type.
    const mins = MIN_DIMENSIONS[room.roomType] || { w: 4, h: 4 };
    const need = Math.min(mins.w, mins.h);
    const shortSide = Math.min(w, h);
    if (shortSide < need) {
      penalty += Math.min(40, ((need - shortSide) / need) * 60);
    }

    if (penalty > 45) offenders.push(room.label);
    return clamp(100 - penalty);
  });

  const mean = perRoom.reduce((s, v) => s + v, 0) / perRoom.length;

  // A plain average lets a handful of unusable rooms hide behind a dozen good
  // ones — a plan with a 60×3.6 ft "dining room" would still score in the 70s.
  // Compound the penalty by the share of rooms that are genuinely unusable so
  // such a plan can never outrank a uniformly workable one.
  const unusableShare = perRoom.filter(v => v < 40).length / perRoom.length;
  const score = Math.round(clamp(mean * (1 - unusableShare) - unusableShare * 40));

  return {
    score,
    note: offenders.length === 0
      ? 'All rooms have workable proportions'
      : `${offenders.length} room(s) are awkwardly shaped: ${offenders.slice(0, 3).join(', ')}`,
    offenders,
  };
}

/**
 * Rooms narrower than the type can physically accommodate — a 5 ft bedroom is
 * not a small bedroom, it is not a bedroom. Reported separately from the
 * proportion score because averaging lets one such room hide in a large plan,
 * and no amount of daylight or flow redeems a plan you cannot build.
 *
 * @param {import('./types.js').RoomCell[]} rooms
 * @param {number} [tolerance=0.9] - Fraction of the minimum still accepted.
 * @returns {{ label: string, shortSide: number, required: number }[]}
 */
export function findDimensionViolations(rooms, tolerance = 0.9) {
  if (!rooms) return [];

  return rooms.reduce((violations, room) => {
    const mins = MIN_DIMENSIONS[room.roomType];
    if (!mins) return violations;

    const required = Math.min(mins.w, mins.h);
    const shortSide = Math.min(room.w, room.h);
    if (shortSide < required * tolerance) {
      violations.push({ label: room.label, shortSide: round1(shortSide), required });
    }
    return violations;
  }, []);
}

/**
 * Score how well the plan satisfies preferred room relationships.
 *
 * Differs from `scoreAdjacency` in what it counts. That function sums weights
 * over every *instance* pair, so a 4-bed 3-bath home accrues 12 bedroom-bathroom
 * obligations when only three can physically be met — capping even an excellent
 * plan around 30%. The design intent is per *type* pair ("bedrooms should reach
 * a bathroom", "kitchen next to dining"), so credit the weight once a pair is
 * satisfied anywhere. That makes 100 attainable and the metric discriminating.
 *
 * @param {import('./types.js').RoomCell[]} rooms
 * @returns {{ score: number, note: string, unmet: string[] }}
 */
export function scoreRoomFlow(rooms) {
  if (!rooms || rooms.length < 2) return { score: 100, note: 'Too few rooms to relate', unmet: [] };

  const adjacencies = detectAdjacencies(rooms);
  const types = [...new Set(rooms.map(r => r.roomType))];

  // Which type pairs actually touch somewhere in the plan.
  const satisfiedPairs = new Set();
  const touches = new Map(rooms.map(r => [r.id, new Set()]));
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (!adjacencies.has(key)) continue;
      const t = a.roomType < b.roomType ? `${a.roomType}|${b.roomType}` : `${b.roomType}|${a.roomType}`;
      satisfiedPairs.add(t);
      touches.get(a.id).add(b.id);
      touches.get(b.id).add(a.id);
    }
  }

  // Two rooms that both open onto the same hallway are related the way the
  // brief meant, even though they do not share a wall.  Without this, giving
  // a plan the circulation it needs reads as a flow failure, and the search
  // learns to avoid hallways entirely.
  const halls = rooms.filter(r => r.roomType === 'hall');
  halls.forEach(hall => {
    const served = rooms.filter(r => touches.get(hall.id).has(r.id));
    for (let i = 0; i < served.length; i++) {
      for (let j = i + 1; j < served.length; j++) {
        const ta = served[i].roomType;
        const tb = served[j].roomType;
        satisfiedPairs.add(ta < tb ? `${ta}|${tb}` : `${tb}|${ta}`);
      }
    }
  });

  let totalWeight = 0;
  let satisfiedWeight = 0;
  const unmet = [];

  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const weight = getAdjacencyWeight(types[i], types[j]);
      if (weight <= 0) continue;

      totalWeight += weight;
      const [lo, hi] = types[i] < types[j] ? [types[i], types[j]] : [types[j], types[i]];
      if (satisfiedPairs.has(`${lo}|${hi}`)) satisfiedWeight += weight;
      // Label alphabetically so it does not depend on room ordering.
      else unmet.push(`${lo}–${hi}`);
    }
  }

  if (totalWeight === 0) return { score: 50, note: 'No relationships defined for these rooms', unmet: [] };

  const score = Math.round((satisfiedWeight / totalWeight) * 100);
  return {
    score,
    note: unmet.length === 0
      ? 'Every preferred room pairing is satisfied'
      : `Not connected: ${unmet.slice(0, 3).join(', ')}`,
    unmet,
  };
}

/**
 * Room pairs that should NOT share a wall, with a penalty weight each.
 * @type {[string, string, number][]}
 */
const PRIVACY_CONFLICTS = [
  ['bathroom', 'living', 10],
  ['bathroom', 'dining', 10],
  ['bathroom', 'kitchen', 8],
  ['bedroom', 'kitchen', 4],
  ['bedroom', 'dining', 3],
  ['garage', 'bedroom', 5],
  ['laundry', 'living', 3],
];

/**
 * Score how well private rooms are kept away from public ones.
 *
 * @param {import('./types.js').RoomCell[]} rooms
 * @returns {{ score: number, note: string }}
 */
export function scorePrivacy(rooms) {
  if (!rooms || rooms.length < 2) return { score: 100, note: 'Too few rooms to conflict' };

  const adjacencies = detectAdjacencies(rooms);
  let possible = 0;
  let violated = 0;
  const hits = [];

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const rule = PRIVACY_CONFLICTS.find(([ta, tb]) =>
        (a.roomType === ta && b.roomType === tb) || (a.roomType === tb && b.roomType === ta),
      );
      if (!rule) continue;

      possible += rule[2];
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (adjacencies.has(key)) {
        violated += rule[2];
        hits.push(`${a.label} ↔ ${b.label}`);
      }
    }
  }

  if (possible === 0) return { score: 100, note: 'No privacy conflicts possible' };

  const score = Math.round(clamp(100 - (violated / possible) * 100));
  return {
    score,
    note: hits.length === 0
      ? 'Private rooms are shielded from public areas'
      : `Direct opening between ${hits.slice(0, 2).join(' and ')}`,
  };
}

/**
 * Score how much of the envelope is usable room area.
 *
 * Rewards the 82-95% band: below it the plan wastes space, above it there is
 * no room left for circulation.
 *
 * @param {Object} layout
 * @returns {{ score: number, note: string, ratio: number }}
 */
export function scoreEfficiency(layout) {
  const boundaryArea = layout.boundary.width * layout.boundary.height;
  if (boundaryArea <= 0) return { score: 0, note: 'Degenerate envelope', ratio: 0 };

  const roomArea = layout.rooms.reduce((s, r) => s + (r.actualArea || r.w * r.h), 0);
  const ratio = roomArea / boundaryArea;

  let score;
  if (ratio >= 0.82 && ratio <= 0.95) score = 100;
  else if (ratio < 0.82) score = clamp(100 - (0.82 - ratio) * 300);
  else score = clamp(100 - (ratio - 0.95) * 400, 60);

  return {
    score: Math.round(score),
    note: `${Math.round(ratio * 100)}% of the envelope is room area`,
    ratio,
  };
}

// ---------------------------------------------------------------------------
// Composite score
// ---------------------------------------------------------------------------

/**
 * Score a complete layout across every criterion.
 *
 * @param {Object} layout - Finalised layout `{ rooms, boundary, windows, ... }`.
 * @param {Object} [opts]
 * @param {Object} [opts.preferences] - Brief flags used to weight the metrics.
 * @param {string} [opts.direction]   - Facing direction, for the Vastu check.
 * @param {Object} [opts.weights]     - Pre-resolved weights (skips resolution).
 * @returns {{
 *   total: number,
 *   breakdown: Object<string, {score: number, weight: number, note: string}>,
 *   weights: Object<string, number>,
 *   reachable: boolean,
 *   notes: string[],
 * }}
 */
export function scoreLayout(layout, opts = {}) {
  const empty = {
    total: 0, breakdown: {}, weights: resolveWeights(opts.preferences),
    reachable: false, notes: ['Layout has no rooms'],
  };
  if (!layout || !layout.rooms || layout.rooms.length === 0) return empty;

  const weights = opts.weights || resolveWeights(opts.preferences);
  const rooms = layout.rooms;

  const energy = analyzeEnergy(layout) || { averages: { light: 50, ventilation: 50 } };
  const vastu = checkVastu(layout, opts.direction);
  const reach = checkReachability(rooms);

  const area = scoreAreaFidelity(rooms);
  const proportion = scoreProportion(rooms);
  const privacy = scorePrivacy(rooms);
  const efficiency = scoreEfficiency(layout);
  const flow = scoreRoomFlow(rooms);

  const breakdown = {
    adjacency: { score: flow.score, note: flow.note },
    areaFidelity: { score: area.score, note: area.note },
    proportion: { score: proportion.score, note: proportion.note },
    daylight: { score: energy.averages.light, note: `Average daylight across ${rooms.length} rooms` },
    ventilation: { score: energy.averages.ventilation, note: 'Cross-ventilation potential' },
    privacy: { score: privacy.score, note: privacy.note },
    efficiency: { score: efficiency.score, note: efficiency.note },
    vastu: { score: vastu ? vastu.score : 50, note: vastu ? `${vastu.passed}/${vastu.total} Vastu rules satisfied` : 'Not evaluated' },
  };

  let total = 0;
  Object.keys(breakdown).forEach(key => {
    const weight = weights[key] || 0;
    breakdown[key].weight = weight;
    breakdown[key].contribution = round1((breakdown[key].score * weight) / 100);
    total += breakdown[key].contribution;
  });

  const notes = [];

  // Prefer the real door graph over the wall-adjacency estimate: it knows
  // where openings were actually placed, not merely which rooms touch.
  const conn = layout.connectivity;
  let reachable = reach.reachable;

  if (conn) {
    reachable = conn.stranded.length === 0;
    if (conn.stranded.length > 0) {
      // Hard constraint: a plan you cannot walk through never outranks one you can.
      total *= 0.6;
      notes.push(`${conn.stranded.length} room(s) cannot be reached from the entry`);
    }
    if (conn.compromises.length > 0) {
      // Soft but real: routing through a bedroom to reach another room is a
      // plan people have to live with every day.  Weight it heavily enough
      // that a plan with proper circulation wins on merit.
      conn.compromises.forEach(c => { total *= (c.severe === false ? 0.9 : 0.72); });
      notes.push(conn.compromises[0].message || conn.compromises[0]);
    }
  } else if (!reach.reachable) {
    total *= 0.6;
    notes.push(`${reach.violations.length} room(s) unreachable from the entry`);
  }

  // Hard constraint: every room must be wide enough to actually be that room.
  const undersized = findDimensionViolations(rooms);
  if (undersized.length > 0) {
    total *= Math.pow(0.65, Math.min(undersized.length, 3));
    const worst = undersized[0];
    notes.push(
      `${undersized.length} room(s) below minimum width — ${worst.label} is ${worst.shortSide} ft across, needs ${worst.required} ft`,
    );
  }
  if (proportion.offenders.length > 0) notes.push(proportion.note);

  return {
    total: round1(clamp(total)),
    breakdown,
    weights,
    reachable,
    undersized,
    notes,
  };
}

/**
 * Turn a score result into the two or three sentences the report shows as
 * "why this plan won".  Picks the highest-contributing metrics relative to
 * their weight, so a 100/100 on a 5-weight metric doesn't outrank a 90 on 22.
 *
 * @param {ReturnType<typeof scoreLayout>} result
 * @param {number} [count=3]
 * @returns {{ label: string, score: number, note: string }[]}
 */
export function explainScore(result, count = 3) {
  if (!result || !result.breakdown) return [];

  return METRICS
    .map(m => ({ ...m, ...result.breakdown[m.key] }))
    .filter(m => m.score !== undefined && m.weight > 0)
    .sort((a, b) => (b.score * b.weight) - (a.score * a.weight))
    .slice(0, count)
    .map(m => ({ label: m.label, score: m.score, note: m.note }));
}

/**
 * The inverse of `explainScore` — the metrics dragging the plan down, used to
 * tell the user what a manual pass could still improve.
 *
 * @param {ReturnType<typeof scoreLayout>} result
 * @param {number} [threshold=60]
 * @returns {{ label: string, score: number, note: string }[]}
 */
export function findWeaknesses(result, threshold = 60) {
  if (!result || !result.breakdown) return [];

  return METRICS
    .map(m => ({ ...m, ...result.breakdown[m.key] }))
    .filter(m => m.score !== undefined && m.weight >= 5 && m.score < threshold)
    .sort((a, b) => (a.score * a.weight) - (b.score * b.weight))
    .map(m => ({ label: m.label, score: m.score, note: m.note }));
}
