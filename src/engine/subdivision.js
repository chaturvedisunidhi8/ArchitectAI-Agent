/**
 * subdivision.js — Recursive binary subdivision (slicing tree) engine.
 *
 * Replaces the shelf-packing algorithm.  Produces gap-free, exact-tiling
 * room cells from a footprint polygon by recursively bisecting.
 *
 * @module subdivision
 */

import { area as polyArea, centroid as polyCentroid, bbox as polyBbox,
  splitPolygon, rectToPolygon } from './polygon.js';
import { createRoomCell } from './roomCell.js';
import { createPRNG } from './prng.js';
import { MIN_DIMENSIONS, MAX_ASPECT_RATIO, snapToGrid, getZone, getRoomType } from './constants.js';
import { getAdjacencyWeight } from './adjacency.js';

// ---------------------------------------------------------------------------
// Slicing tree node types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SplitNode
 * @property {'split'}  kind
 * @property {string}   axis      - 'horizontal' | 'vertical'
 * @property {number}   ratio     - Split ratio (0-1) along the axis.
 * @property {LeafNode|SplitNode} left
 * @property {LeafNode|SplitNode} right
 * @property {number}   [depth]
 */

/**
 * @typedef {Object} LeafNode
 * @property {'leaf'}   kind
 * @property {string}   cellId     - RoomCell id assigned to this leaf.
 * @property {Object}   roomSpec   - The room spec placed here.
 * @property {import('./types.js').Polygon} [polygon] - Assigned after layout.
 */

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Subdivide a footprint into room cells using a slicing tree.
 *
 * @param {import('./types.js').Polygon} footprint - Building envelope.
 * @param {Object[]} roomSpecs - Expanded room specs [{id, type, label, targetArea, color, aspectTarget}].
 * @param {Object} [opts]
 * @param {number}  [opts.seed]         - PRNG seed for deterministic layout.
 * @param {Object}  [opts.policy]       - Variant policy (see layoutVariants.js).
 * @param {import('./types.js').Polygon} [opts.corridor] - Pre-carved corridor.
 * @returns {{ cells: import('./types.js').RoomCell[], tree: SplitNode|LeafNode, seed: number }}
 */
export function subdivide(footprint, roomSpecs, opts = {}) {
  const seed = opts.seed ?? (Date.now() | 0);
  const rng = createPRNG(seed);
  const policy = opts.policy || {};

  if (roomSpecs.length === 0) return { cells: [], tree: null, seed };

  // Build initial region — if a corridor was carved, subdivide the flanking
  // regions separately and merge results.
  if (opts.corridor && opts.corridor.regions && opts.corridor.regions.length > 0) {
    return subdivideWithCorridor(footprint, roomSpecs, opts);
  }

  // The cells tile the footprint exactly, so their areas must sum to it.
  // Splitting on raw targets that under- or over-fill the envelope makes
  // every ratio down the tree wrong, which is how rooms end up as slivers.
  // `weight` is the share of the envelope a room should occupy; `targetArea`
  // stays untouched so the scorer can still judge how close we got.
  const fpArea = polyArea(footprint);
  const requested = roomSpecs.reduce((s, r) => s + (r.targetArea || 0), 0);
  const k = requested > 0 ? fpArea / requested : 1;
  const normalized = roomSpecs.map(r => ({ ...r, weight: (r.targetArea || 0) * k }));

  // Sort rooms largest-first for more balanced bisection.
  const sorted = normalized.sort((a, b) => b.weight - a.weight);

  // Build slicing tree.
  const tree = buildTree(sorted, footprint, policy, rng, 0);

  // Assign polygons from the tree.
  const cells = assignPolygons(tree, footprint);

  return { cells, tree, seed };
}

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

/**
 * Snap a split position onto the planning grid, without pushing either side
 * below a usable width.  Snapping here — rather than rounding the finished
 * room — is what keeps every wall in the plan on the same module.
 */
function snapSplit(lo, hi, pos) {
  const span = hi - lo;
  if (span < MIN_SLICE_FT * 2) return lo + span / 2;
  const snapped = snapToGrid(pos);
  return Math.max(lo + MIN_SLICE_FT, Math.min(snapped, hi - MIN_SLICE_FT));
}

/** Narrowest slice a split may leave on either side (ft). */
const MIN_SLICE_FT = 4;

function buildTree(rooms, polygon, policy, rng, depth) {
  if (rooms.length === 0) return null;
  if (rooms.length === 1) {
    return { kind: 'leaf', cellId: rooms[0].id, roomSpec: rooms[0] };
  }

  const b = polyBbox(polygon);

  // Partition once, and carry that partition all the way through — computing
  // the ratio from one grouping and then assigning a different one is how
  // rooms end up nothing like their requested size.
  const { groupA, groupB } = partitionRooms(rooms, rng);

  const areaA = groupA.reduce((s, r) => s + r.weight, 0);
  const areaB = groupB.reduce((s, r) => s + r.weight, 0);
  let rawRatio = areaA / (areaA + areaB || 1);

  // A small seeded nudge keeps candidates genuinely different across seeds
  // without letting any room drift far from its requested area.
  rawRatio = Math.max(0.18, Math.min(0.82, rawRatio * (1 + (rng() - 0.5) * 0.14)));

  const attempt = (tryAxis) => {
    const lo = tryAxis === 'vertical' ? b.x : b.y;
    const span = tryAxis === 'vertical' ? b.w : b.h;
    // The dimension each child inherits unchanged from the parent.
    const cross = tryAxis === 'vertical' ? b.h : b.w;

    let want = lo + span * rawRatio;

    // A child holding exactly one room *is* that room, so the cut decides its
    // proportions.  Pull the cut back to whatever keeps that room within the
    // acceptable aspect ratio — a room a little off its requested area beats
    // a 4-foot-wide strip.
    const bounds = aspectBounds(groupA.length, groupB.length, lo, span, cross);
    want = Math.max(bounds.min, Math.min(want, bounds.max));

    const pos = snapSplit(lo, lo + span, want);
    const { left, right } = splitPolygon(polygon, tryAxis, pos);
    const lb = polyBbox(left);
    const rb = polyBbox(right);
    const ok = left.length >= 3 && right.length >= 3
      && lb.w > 1 && lb.h > 1 && rb.w > 1 && rb.h > 1;
    if (!ok) return null;
    return {
      axis: tryAxis,
      pos,
      left,
      right,
      ratio: (pos - lo) / (span || 1),
      score: axisScore(tryAxis, lb, rb, groupA, groupB, policy, depth),
    };
  };

  // Evaluate both axes and take the better one.  Slicing blindly along the
  // policy axis is what produced 3.5:1 slivers: once a group holds a single
  // room, the cut decides that room's proportions outright.
  const options = [attempt('vertical'), attempt('horizontal')].filter(Boolean);

  if (options.length === 0) {
    // Nothing splits cleanly.  Chain the rooms down one axis rather than
    // stacking them into a single polygon, which used to emit overlapping
    // rooms sharing identical geometry.
    return forceChain(rooms, polygon, b.w >= b.h ? 'vertical' : 'horizontal');
  }

  const split = options.reduce((best, o) => (o.score > best.score ? o : best), options[0]);

  return buildTreeWithSplit(groupA, groupB, split, policy, rng, depth);
}

/**
 * The window of split positions that keeps any single-room child within
 * `MAX_ASPECT_RATIO`, given that each child keeps the parent's `cross`
 * dimension and takes its share of `span`.
 *
 * @returns {{min: number, max: number}} Absolute positions along the axis.
 */
function aspectBounds(countA, countB, lo, span, cross) {
  let min = lo;
  let max = lo + span;

  if (countA === 1) {
    // Side A runs from `lo` to `pos`; its own dimension is `pos - lo`.
    min = Math.max(min, lo + cross / MAX_ASPECT_RATIO);
    max = Math.min(max, lo + cross * MAX_ASPECT_RATIO);
  }
  if (countB === 1) {
    // Side B runs from `pos` to `lo + span`.
    max = Math.min(max, lo + span - cross / MAX_ASPECT_RATIO);
    min = Math.max(min, lo + span - cross * MAX_ASPECT_RATIO);
  }

  // An impossible window means the region simply cannot hold both rooms well;
  // fall back to the unconstrained range and let the axis score decide.
  if (min > max) return { min: lo, max: lo + span };
  return { min, max };
}

/**
 * How good a cut is, in points.  Dominated by the proportions it forces on
 * any child that holds exactly one room — that child *is* the room.
 */
function axisScore(axis, lb, rb, groupA, groupB, policy, depth) {
  let score = proportionScore(lb, groupA.length) + proportionScore(rb, groupB.length)
    + areaScore(lb, groupA) + areaScore(rb, groupB);

  // Policy is a preference, not a mandate.
  if (policy.forceAxis === 'alternate') {
    if (axis === (depth % 2 === 0 ? 'vertical' : 'horizontal')) score += 10;
  } else if (policy.forceAxis === axis) {
    score += 10;
  } else if (!policy.forceAxis) {
    // With no policy, cut across the long dimension for squarer children.
    const preferred = lb.w + rb.w >= lb.h + rb.h ? 'vertical' : 'horizontal';
    if (axis === preferred) score += 4;
  }

  return score;
}

/**
 * How close a child region comes to the floor area its rooms asked for.
 * Weighted hardest when the child holds a single room, because then the cut
 * has decided that room's area outright and nothing downstream can recover it.
 */
function areaScore(box, group) {
  const want = group.reduce((s, r) => s + (r.weight || 0), 0);
  if (want <= 0) return 0;
  const got = box.w * box.h;
  const error = Math.abs(got - want) / want;
  return -error * (group.length === 1 ? 45 : 15);
}

function proportionScore(box, roomCount) {
  if (box.w <= 0 || box.h <= 0) return -1000;
  const ar = Math.max(box.w / box.h, box.h / box.w);
  if (roomCount === 1) {
    // A finished room: penalise hard past the acceptable ratio.
    return -Math.max(0, ar - 1.6) * 25;
  }
  // A region that will be cut again: only very extreme shapes are a problem.
  return -Math.max(0, ar - 2.5) * 6;
}

function buildTreeWithSplit(groupA, groupB, split, policy, rng, depth) {
  const left = groupA.length > 0 ? buildTree(groupA, split.left, policy, rng, depth + 1) : null;
  const right = groupB.length > 0 ? buildTree(groupB, split.right, policy, rng, depth + 1) : null;

  if (!left) return right;
  if (!right) return left;

  return { kind: 'split', axis: split.axis, ratio: split.ratio, left, right, depth };
}

/**
 * Last-resort layout: slice the polygon into equal bands along one axis, one
 * room per band.  Degenerate, but every room still gets its own footprint.
 */
function forceChain(rooms, polygon, axis) {
  if (rooms.length === 1) {
    return { kind: 'leaf', cellId: rooms[0].id, roomSpec: rooms[0] };
  }
  const b = polyBbox(polygon);
  const lo = axis === 'vertical' ? b.x : b.y;
  const span = axis === 'vertical' ? b.w : b.h;
  const pos = lo + span / 2;
  const { left, right } = splitPolygon(polygon, axis, pos);

  const half = Math.ceil(rooms.length / 2);
  const a = rooms.slice(0, half);
  const c = rooms.slice(half);

  return {
    kind: 'split',
    axis,
    ratio: 0.5,
    left: forceChain(a, left, axis),
    right: forceChain(c, right, axis),
    depth: 0,
  };
}

// ---------------------------------------------------------------------------
// Room partitioning
// ---------------------------------------------------------------------------

/**
 * How much a room wants to be on the same side of a split as a given group.
 * Same zone counts for a lot; a specific adjacency preference counts for more.
 */
function cohesion(room, group) {
  if (group.length === 0) return 0;
  const zone = getZone(room.type);
  let score = 0;
  group.forEach(other => {
    if (getZone(other.type) === zone) score += 3;
    score += getAdjacencyWeight(room.type, other.type);

    // Rooms of similar size want to be siblings.  A 60 ft² bathroom paired
    // against a whole wing gets sliced off the full depth of that wing and
    // comes out at twice its brief; paired with the store room, the two nest
    // into one small column and both land on their target area.
    const a = room.weight || room.targetArea || 1;
    const b = other.weight || other.targetArea || 1;
    const ratio = Math.abs(Math.log(a / b));
    score += Math.max(0, 1 - ratio / 1.6) * 5;
  });
  return score / group.length;
}

/**
 * Split rooms into the two halves of a slice.
 *
 * Balancing area alone — the previous behaviour — interleaves the public,
 * private and service parts of the home, so the kitchen lands across the plan
 * from the dining room and the search has to brute-force its way back to a
 * sensible arrangement.  Here each side is grown by cohesion (same zone,
 * preferred adjacency) under an area budget, so the halves come out as
 * coherent blocks and the door graph has something sane to work with.
 *
 * @param {Object[]} rooms
 * @param {Function} rng
 * @returns {{groupA: Object[], groupB: Object[]}}
 */
function partitionRooms(rooms, rng) {
  if (rooms.length <= 1) return { groupA: [rooms[0]], groupB: [] };
  if (rooms.length === 2) return { groupA: [rooms[0]], groupB: [rooms[1]] };

  const sorted = [...rooms].sort((a, b) => b.weight - a.weight);
  const totalArea = sorted.reduce((s, r) => s + r.weight, 0);
  const budgetA = totalArea / 2;

  // Seed each side with the two rooms that least want to be together, so the
  // halves start from opposite corners of the programme.
  const seedA = sorted[0];
  let seedB = sorted[1];
  let worst = Infinity;
  sorted.slice(1).forEach(r => {
    const affinity = getAdjacencyWeight(seedA.type, r.type)
      + (getZone(seedA.type) === getZone(r.type) ? 3 : 0);
    // Bias by seed so different seeds explore different pairings.
    const jitter = rng() * 4;
    if (affinity + jitter < worst) { worst = affinity + jitter; seedB = r; }
  });

  const groupA = [seedA];
  const groupB = [seedB];
  let areaA = seedA.weight;
  let areaB = seedB.weight;

  sorted.forEach(room => {
    if (room === seedA || room === seedB) return;
    // Jitter is what makes one seed's plan differ from another's; without it
    // cohesion is deterministic and the whole candidate search collapses to
    // a single layout repeated dozens of times.
    const pullA = cohesion(room, groupA) + (rng() - 0.5) * 5;
    const pullB = cohesion(room, groupB) + (rng() - 0.5) * 5;

    // Area budget breaks ties and stops one side swallowing the plan.
    const roomForA = areaA + room.weight <= budgetA * 1.25;
    const roomForB = areaB + room.weight <= budgetA * 1.25;

    let toA;
    if (pullA === pullB) toA = areaA <= areaB;
    else if (pullA > pullB) toA = roomForA || !roomForB;
    else toA = !(roomForB || !roomForA);

    if (toA) { groupA.push(room); areaA += room.weight; }
    else { groupB.push(room); areaB += room.weight; }
  });

  if (groupA.length === 0) groupA.push(groupB.pop());
  if (groupB.length === 0) groupB.push(groupA.pop());

  return { groupA, groupB };
}

// ---------------------------------------------------------------------------
// Polygon assignment
// ---------------------------------------------------------------------------

/**
 * Walk the slicing tree and assign actual polygons to each leaf.
 *
 * @param {SplitNode|LeafNode} tree
 * @param {import('./types.js').Polygon} footprint
 * @returns {import('./types.js').RoomCell[]}
 */
function assignPolygons(tree, footprint) {
  const cells = [];
  walkTree(tree, footprint, cells);
  return cells;
}

function walkTree(node, polygon, cells) {
  if (!node) return;

  if (node.kind === 'leaf') {
    const b = polyBbox(polygon);
    const cell = createRoomCell({
      id: node.cellId,
      roomType: node.roomSpec.type,
      label: node.roomSpec.label,
      polygon,
      targetArea: node.roomSpec.targetArea,
      color: node.roomSpec.color,
      aspectTarget: node.roomSpec.aspectTarget,
    });
    cells.push(cell);
    return;
  }

  if (node.kind === 'split') {
    const b = polyBbox(polygon);
    // Re-snap: the ratio was derived from an already-snapped position, so
    // this only clears floating-point drift and keeps every wall on module.
    const splitPos = node.axis === 'vertical'
      ? snapToGrid(b.x + b.w * node.ratio)
      : snapToGrid(b.y + b.h * node.ratio);

    const { left, right } = splitPolygon(polygon, node.axis, splitPos);
    walkTree(node.left, left, cells);
    walkTree(node.right, right, cells);
  }
}

// ---------------------------------------------------------------------------
// Corridor-aware subdivision
// ---------------------------------------------------------------------------

/**
 * Subdivide around a carved circulation spine.
 *
 * The corridor is emitted as a real `hall` cell rather than being discarded.
 * That matters for more than looks: the plan graph gives the hall a strong
 * pull, so every room ends up opening onto circulation instead of onto
 * whichever neighbour happened to share the longest wall.
 */
function subdivideWithCorridor(footprint, roomSpecs, opts) {
  const { corridor, policy = {}, seed } = opts;
  const rng = createPRNG(seed);

  const regions = corridor.regions;
  const totalRegionArea = regions.reduce((s, r) => s + polyArea(r), 0);
  if (totalRegionArea <= 0) {
    return subdivide(footprint, roomSpecs, { ...opts, corridor: null });
  }

  // The hall consumes floor area.  Rooms are distributed against a share of
  // what is actually left, but their stated targetArea is untouched so the
  // scorer still judges the plan against what was asked for.
  const requested = roomSpecs.reduce((s, r) => s + r.targetArea, 0) || 1;
  const fit = Math.min(1, totalRegionArea / requested);

  // Distribute rooms across the flanking regions by area, not by count, and
  // keep zone-mates together: the private side of the plan stays private.
  const allCells = [];
  const remaining = roomSpecs
    .map(r => ({ ...r, fitArea: r.targetArea * fit }))
    .sort((a, b) => b.fitArea - a.fitArea);
  const buckets = regions.map(region => ({
    region,
    capacity: polyArea(region),
    used: 0,
    rooms: [],
  }));

  remaining.forEach(room => {
    // Bin-pack against the region's real capacity.  Cohesion decides *which*
    // side a room prefers, but overflowing a region is what wrecks every
    // room's area in it, so overflow has to dominate the choice.
    let best = null;
    let bestScore = -Infinity;
    buckets.forEach(bucket => {
      const after = bucket.used + room.fitArea;
      const overflow = Math.max(0, after - bucket.capacity) / (bucket.capacity || 1);
      const score = cohesion(room, bucket.rooms) * 2 - overflow * 400;
      if (score > bestScore) { bestScore = score; best = bucket; }
    });
    best = best || buckets[0];
    best.rooms.push(room);
    best.used += room.fitArea;
  });

  buckets.forEach(bucket => {
    if (bucket.rooms.length === 0) return;
    const { cells } = subdivide(bucket.region, bucket.rooms, {
      policy,
      seed: (rng() * 2147483647) | 0,
    });
    allCells.push(...cells);
  });

  // Emit the corridor itself.
  if (corridor.corridor && corridor.corridor.length >= 3) {
    const hallType = getRoomType('hall');
    allCells.push(createRoomCell({
      id: 'hall_1',
      roomType: 'hall',
      label: 'Hallway',
      polygon: corridor.corridor,
      targetArea: polyArea(corridor.corridor),
      color: hallType ? hallType.color : '#EDE8E0',
      aspectTarget: 3.0,
    }));
  }

  return { cells: allCells, tree: null, seed };
}

// ---------------------------------------------------------------------------
// Hill-climbing optimizer
// ---------------------------------------------------------------------------

/**
 * Optimize a slicing tree layout by hill-climbing over mutations.
 *
 * @param {import('./types.js').Polygon} footprint
 * @param {Object[]} roomSpecs
 * @param {Object} opts - Same as subdivide options + { iterations: number }.
 * @returns {{ cells: import('./types.js').RoomCell[], tree: SplitNode|LeafNode, seed: number, score: number }}
 */
export function optimizeLayout(footprint, roomSpecs, opts = {}) {
  const iterations = opts.iterations || 500;
  const baseSeed = opts.seed ?? (Date.now() | 0);

  let bestResult = subdivide(footprint, roomSpecs, opts);
  let bestScore = scoreLayout(bestResult.cells, footprint);

  let currentSeed = baseSeed;

  for (let i = 0; i < iterations; i++) {
    currentSeed = (currentSeed + 1) | 0;
    const trialOpts = { ...opts, seed: currentSeed };
    const trial = subdivide(footprint, roomSpecs, trialOpts);
    const trialScore = scoreLayout(trial.cells, footprint);

    if (trialScore > bestScore) {
      bestResult = trial;
      bestScore = trialScore;
    }
  }

  return { ...bestResult, score: bestScore };
}

/**
 * Score a layout.  Higher is better.
 * Factors: aspect ratio quality, minimum dimension compliance, adjacency.
 */
function scoreLayout(cells, footprint) {
  if (cells.length === 0) return 0;

  let score = 100;
  const fpArea = polyArea(footprint);

  for (const cell of cells) {
    const b = polyBbox(cell.polygon);
    if (b.w < 1 || b.h < 1) { score -= 50; continue; }

    // Aspect ratio penalty.
    const ar = Math.max(b.w / b.h, b.h / b.w);
    if (ar > MAX_ASPECT_RATIO) {
      score -= (ar - MAX_ASPECT_RATIO) * 10;
    }

    // Minimum dimension check.
    const minDim = MIN_DIMENSIONS[cell.roomType];
    if (minDim) {
      if (b.w < minDim.w * 0.8) score -= 5;
      if (b.h < minDim.h * 0.8) score -= 5;
    }

    // Area efficiency bonus.
    const efficiency = cell.actualArea / (cell.targetArea || 1);
    if (efficiency > 0.8 && efficiency < 1.3) score += 2;
  }

  return Math.max(0, score);
}
