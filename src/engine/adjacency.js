/**
 * adjacency.js — Adjacency graph, scoring, and hill-climbing optimizer.
 *
 * Defines which rooms should be near each other, scores a candidate layout
 * by how many adjacencies share a wall long enough for a door, and optimises
 * via tree mutations.
 *
 * @module adjacency
 */

import { bbox as polyBbox, area as polyArea } from './polygon.js';

// ---------------------------------------------------------------------------
// Preferred adjacencies (weighted)
// ---------------------------------------------------------------------------

/**
 * @type {Map<string, Map<string, number>>}
 * Key = "typeA|typeB" (alphabetical), value = weight (1-10).
 * Higher weight = stronger preference for sharing a wall.
 */
const ADJACENCY_WEIGHTS = new Map([
  ['bathroom|bedroom', 8],
  ['bathroom|hallway', 6],
  ['bedroom|hallway', 7],
  ['dining|kitchen', 9],
  ['dining|living', 8],
  ['entry|hallway', 10],
  ['hallway|kitchen', 5],
  ['hallway|living', 6],
  ['kitchen|living', 7],
  ['living|entry', 9],
  ['study|bedroom', 4],
  ['garage|kitchen', 3],
  ['laundry|bathroom', 5],
  ['laundry|kitchen', 4],
  ['pooja|living', 5],
  ['store|kitchen', 3],
  ['balcony|bedroom', 4],
  ['balcony|living', 5],
]);

/**
 * The weights table predates the generated `hall` cell and spells circulation
 * `hallway`.  Normalise so a real hallway in a plan is recognised.
 */
const normType = (t) => (t === 'hall' ? 'hallway' : t);

function adjKey(typeA, typeB) {
  const a = typeA < typeB ? typeA : typeB;
  const b = typeA < typeB ? typeB : typeA;
  return `${a}|${b}`;
}

/**
 * Get the adjacency weight between two room types.
 * @returns {number} 0 if no preference defined.
 */
/**
 * Per-run overrides, installed by the optional LLM bubble-diagram step.
 * Null means "use the built-in table".  Keys are `adjKey`-normalised and are
 * looked up against the *un*-normalised type names the model was given, so
 * `hall` is stored as `hallway` here too.
 * @type {Map<string, number>|null}
 */
let _overrides = null;

/**
 * Install a design-specific adjacency graph for the current run.
 * @param {Map<string, number>} weights - Keyed "typeA|typeB", alphabetical.
 */
export function setAdjacencyOverrides(weights) {
  if (!weights || weights.size === 0) { _overrides = null; return; }
  const normalised = new Map();
  weights.forEach((w, key) => {
    const [a, b] = key.split('|');
    normalised.set(adjKey(normType(a), normType(b)), w);
  });
  _overrides = normalised;
}

/** Return to the built-in weights table. */
export function clearAdjacencyOverrides() {
  _overrides = null;
}

/** Whether a design-specific graph is currently installed. */
export function hasAdjacencyOverrides() {
  return _overrides !== null;
}

export function getAdjacencyWeight(typeA, typeB) {
  const a = normType(typeA);
  const b = normType(typeB);
  if (a === b) return 0;
  const key = adjKey(a, b);
  if (_overrides && _overrides.has(key)) return _overrides.get(key);
  return ADJACENCY_WEIGHTS.get(key) || 0;
}

// ---------------------------------------------------------------------------
// Adjacency detection from cell layout
// ---------------------------------------------------------------------------

/**
 * Minimum wall-length (ft) required for two cells to count as "adjacent".
 */
const MIN_ADJACENT_WALL_FT = 3;

/**
 * Detect which pairs of cells share an edge long enough to hold a door.
 *
 * @param {import('./types.js').RoomCell[]} cells
 * @returns {Map<string, number>} Map of "idA|idB" → shared wall length.
 */
export function detectAdjacencies(cells) {
  const adj = new Map();

  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i];
      const b = cells[j];
      const len = sharedWallLength(a, b);
      if (len >= MIN_ADJACENT_WALL_FT) {
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        adj.set(key, len);
      }
    }
  }

  return adj;
}

/**
 * Compute the length of shared wall between two cells.
 * Uses bounding-box edge alignment (sufficient for rectangular cells).
 *
 * @returns {number} Shared edge length, or 0.
 */
function sharedWallLength(cellA, cellB) {
  const aPoly = cellA.polygon;
  const bPoly = cellB.polygon;

  // If both rooms have polygon data, check polygon edge overlap directly.
  if (aPoly && aPoly.length >= 3 && bPoly && bPoly.length >= 3) {
    let maxOverlap = 0;
    for (let i = 0; i < aPoly.length; i++) {
      const [ax1, ay1] = aPoly[i];
      const [ax2, ay2] = aPoly[(i + 1) % aPoly.length];
      for (let j = 0; j < bPoly.length; j++) {
        const [bx1, by1] = bPoly[j];
        const [bx2, by2] = bPoly[(j + 1) % bPoly.length];
        const overlap = segmentOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2);
        if (overlap > maxOverlap) maxOverlap = overlap;
      }
    }
    if (maxOverlap >= MIN_ADJACENT_WALL_FT) return maxOverlap;
  }

  // Fallback: bounding-box edge alignment.
  const a = polyBbox(aPoly);
  const b = polyBbox(bPoly);

  let shared = 0;

  if (Math.abs(a.y + a.h - b.y) < 0.1 || Math.abs(b.y + b.h - a.y) < 0.1) {
    const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    shared = Math.max(shared, overlapX);
  }

  if (Math.abs(a.x + a.w - b.x) < 0.1 || Math.abs(b.x + b.w - a.x) < 0.1) {
    const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    shared = Math.max(shared, overlapY);
  }

  return shared;
}

function segmentOverlap(x1, y1, x2, y2, bx1, by1, bx2, by2) {
  const edx = bx2 - bx1, edy = by2 - by1;
  const elen2 = edx * edx + edy * edy;
  if (elen2 < 1e-10) return 0;
  const t1 = ((x1 - bx1) * edx + (y1 - by1) * edy) / elen2;
  const t2 = ((x2 - bx1) * edx + (y2 - by1) * edy) / elen2;
  const tMin = Math.min(t1, t2), tMax = Math.max(t1, t2);
  const overlapStart = Math.max(tMin, 0), overlapEnd = Math.min(tMax, 1);
  if (overlapEnd - overlapStart < 1e-6) return 0;
  // Verify endpoints are actually close to the boundary edge.
  const cx = (overlapStart + overlapEnd) / 2;
  const px = bx1 + cx * edx, py = by1 + cx * edy;
  const ax = (x1 + x2) / 2, ay = (y1 + y2) / 2;
  if (Math.hypot(ax - px, ay - py) > 0.5) return 0;
  return (overlapEnd - overlapStart) * Math.sqrt(elen2);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a layout based on how well adjacencies are satisfied.
 *
 * @param {import('./types.js').RoomCell[]} cells
 * @returns {number} Score 0-100.
 */
export function scoreAdjacency(cells) {
  const adjacencies = detectAdjacencies(cells);
  let totalWeight = 0;
  let satisfiedWeight = 0;

  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const typeA = cells[i].roomType;
      const typeB = cells[j].roomType;
      const weight = getAdjacencyWeight(typeA, typeB);
      if (weight > 0) {
        totalWeight += weight;
        const key = cells[i].id < cells[j].id
          ? `${cells[i].id}|${cells[j].id}`
          : `${cells[j].id}|${cells[i].id}`;
        if (adjacencies.has(key)) {
          satisfiedWeight += weight;
        }
      }
    }
  }

  if (totalWeight === 0) return 50; // No preferences defined.
  return Math.round((satisfiedWeight / totalWeight) * 100);
}

// ---------------------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------------------

/**
 * Check that every room is reachable from the entry room without
 * passing through a bedroom or bathroom.
 *
 * @param {import('./types.js').RoomCell[]} cells
 * @param {string} [entryRoomType='living'] - The room type at the entry.
 * @returns {{ reachable: boolean, violations: string[] }}
 */
export function checkReachability(cells, entryRoomType = 'living') {
  const adjacencies = detectAdjacencies(cells);

  // Find entry cells.
  const entryCells = cells.filter(c => c.roomType === entryRoomType);
  if (entryCells.length === 0) {
    // No living room — try entry type, or just the first cell.
    const entryFallback = cells.find(c => c.roomType === 'entry') || cells[0];
    if (!entryFallback) return { reachable: true, violations: [] };
    entryCells.push(entryFallback);
  }

  // BFS from all entry cells.
  const visited = new Set();
  const queue = [...entryCells.map(c => c.id)];
  entryCells.forEach(c => visited.add(c.id));

  while (queue.length > 0) {
    const currentId = queue.shift();
    const currentCell = cells.find(c => c.id === currentId);

    // Find neighbors through adjacencies.
    for (const [key, _len] of adjacencies) {
      const [idA, idB] = key.split('|');
      const neighborId = idA === currentId ? idB : idB === currentId ? idA : null;
      if (!neighborId || visited.has(neighborId)) continue;

      const neighbor = cells.find(c => c.id === neighborId);
      if (!neighbor) continue;

      // Don't traverse through private rooms (except the destination).
      const isPrivate = ['bedroom', 'bathroom', 'store'].includes(neighbor.roomType);
      if (isPrivate) {
        // Mark as reachable but don't traverse further.
        visited.add(neighborId);
        continue;
      }

      visited.add(neighborId);
      queue.push(neighborId);
    }
  }

  // Check all cells are reachable.
  const violations = cells
    .filter(c => !visited.has(c.id))
    .map(c => `${c.label} (${c.id}) is not reachable from entry`);

  return { reachable: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Hill-climbing optimiser
// ---------------------------------------------------------------------------

/**
 * Optimise adjacency score by mutating the room assignment.
 *
 * @param {import('./types.js').RoomCell[]} cells
 * @param {Object[]} roomSpecs
 * @param {import('./types.js').Polygon} footprint
 * @param {Function} subdivideFn - The subdivide function.
 * @param {Object} opts - { iterations, seed }
 * @returns {{ cells: import('./types.js').RoomCell[], score: number }}
 */
export function optimizeAdjacency(cells, roomSpecs, footprint, subdivideFn, opts = {}) {
  const iterations = opts.iterations || 200;
  const baseSeed = opts.seed ?? (Date.now() | 0);

  let bestCells = cells;
  let bestScore = scoreAdjacency(cells);

  let currentSeed = baseSeed;

  for (let i = 0; i < iterations; i++) {
    // Swap two random room assignments in the specs.
    currentSeed = (currentSeed + 1) | 0;
    const shuffled = [...roomSpecs];
    if (shuffled.length >= 2) {
      const idx1 = (currentSeed % shuffled.length);
      const idx2 = ((currentSeed * 7 + 3) % shuffled.length);
      if (idx1 !== idx2) {
        const temp = shuffled[idx1];
        shuffled[idx1] = shuffled[idx2];
        shuffled[idx2] = temp;
      }
    }

    const trial = subdivideFn(footprint, shuffled, { ...opts, seed: currentSeed });
    const trialScore = scoreAdjacency(trial.cells);

    if (trialScore > bestScore) {
      bestCells = trial.cells;
      bestScore = trialScore;
    }
  }

  return { cells: bestCells, score: bestScore };
}
