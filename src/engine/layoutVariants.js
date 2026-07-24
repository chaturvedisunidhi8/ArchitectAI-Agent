/**
 * layoutVariants.js — Generates multiple distinct layout variants using
 * the subdivision engine with different constraint policies.
 *
 * Each variant is a policy that controls how the slicing tree is built.
 * The actual subdivision is handled by subdivision.js.
 *
 * @module layoutVariants
 */

import { makeRectFootprint, rectToPolygon, area as polyArea, bbox as polyBbox } from './polygon.js';
import { snapToGrid } from './constants.js';
import { subdivide, optimizeLayout } from './subdivision.js';
import { carveCorridor } from './circulation.js';
import { scoreAdjacency, checkReachability, optimizeAdjacency } from './adjacency.js';
import { generateWalls } from './geometry.js';
import { defaultFurnishings } from './furniture.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const round1 = (v) => Math.round(v * 10) / 10;

function computeFootprint(totalAreaFt, aspect) {
  const h = Math.sqrt(totalAreaFt / aspect);
  const w = totalAreaFt / h;
  // Snap the envelope to the planning grid so every wall inside it can be
  // snapped too without the outer dimensions drifting off-module.
  return makeRectFootprint(snapToGrid(w), snapToGrid(h));
}

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

// ---------------------------------------------------------------------------
// Variant policies
// ---------------------------------------------------------------------------

/**
 * Shelf: bias the first splits horizontal; wide shallow bands.
 */
const shelfPolicy = {
  name: 'shelf',
  forceAxis: 'horizontal',
};

/**
 * Grid: alternate split axis strictly at each depth.
 */
const gridPolicy = {
  name: 'grid',
  forceAxis: 'alternate',
};

/**
 * Corridor: reserve a central spine first, subdivide both sides.
 */
const corridorPolicy = {
  name: 'corridor',
  forceAxis: null, // Let subdivision choose; corridor is carved separately.
};

/**
 * Open Plan: merge living + dining + kitchen into one parent cell before
 * subdividing.  The merged band can serve as circulation itself.
 */
const openPlanPolicy = {
  name: 'open',
  forceAxis: null,
  mergePublic: true, // Signal to handle Open Plan specially.
};

// ---------------------------------------------------------------------------
// Variant generators
// ---------------------------------------------------------------------------

function generateShelfVariant(totalAreaFt, roomSpecs, seed, aspect) {
  const footprint = computeFootprint(totalAreaFt, aspect ?? 1.35);
  const rooms = expandSpecs(roomSpecs);
  const corridor = carveCorridor(footprint, {
    entrySide: 'bottom',
    totalArea: totalAreaFt,
    roomCount: rooms.length,
  });
  const result = subdivide(footprint, rooms, { seed, policy: shelfPolicy, corridor });
  return { footprint, ...result };
}

function generateGridVariant(totalAreaFt, roomSpecs, seed, aspect) {
  const footprint = computeFootprint(totalAreaFt, aspect ?? 1.2);
  const rooms = expandSpecs(roomSpecs);
  const corridor = carveCorridor(footprint, {
    entrySide: 'bottom',
    totalArea: totalAreaFt,
    roomCount: rooms.length,
  });
  const result = subdivide(footprint, rooms, { seed, policy: gridPolicy, corridor });
  return { footprint, ...result };
}

function generateCorridorVariant(totalAreaFt, roomSpecs, seed, aspect) {
  const footprint = computeFootprint(totalAreaFt, aspect ?? 1.5);
  const rooms = expandSpecs(roomSpecs);
  const corridor = carveCorridor(footprint, {
    entrySide: 'bottom',
    totalArea: totalAreaFt,
    roomCount: rooms.length,
  });
  const result = subdivide(footprint, rooms, { seed, policy: corridorPolicy, corridor });
  return { footprint, ...result };
}

function generateOpenPlanVariant(totalAreaFt, roomSpecs, seed, aspect) {
  const footprint = computeFootprint(totalAreaFt, aspect ?? 1.3);
  const rooms = expandSpecs(roomSpecs);

  // Merge public rooms (living, dining, kitchen) into a single group
  // that gets placed together in the bottom band.
  const publicTypes = new Set(['living', 'dining', 'kitchen']);
  const publicRooms = rooms.filter(r => publicTypes.has(r.type));
  const privateRooms = rooms.filter(r => !publicTypes.has(r.type));

  // If all rooms are one type, fall back to standard subdivision.
  if (publicRooms.length === 0 || privateRooms.length === 0) {
    const corridor = carveCorridor(footprint, {
      entrySide: 'bottom',
      totalArea: totalAreaFt,
      roomCount: rooms.length,
    });
    const result = subdivide(footprint, rooms, { seed, policy: openPlanPolicy, corridor });
    return { footprint, ...result };
  }

  // For Open Plan, subdivide without a dedicated corridor — the public
  // rooms form an open band that provides circulation.
  const result = subdivideOpenPlan(footprint, publicRooms, privateRooms, seed);
  return { footprint, ...result };
}

/**
 * Special Open Plan subdivision: split footprint into two bands (private
 * top, public bottom), then subdivide each band independently.
 */
function subdivideOpenPlan(footprint, publicRooms, privateRooms, seed) {
  const b = polyBbox(footprint);
  const fpArea = polyArea(footprint);

  const publicArea = publicRooms.reduce((s, r) => s + r.targetArea, 0);
  const totalArea = publicArea + privateRooms.reduce((s, r) => s + r.targetArea, 0) || 1;
  const publicFrac = Math.max(0.35, Math.min(0.6, publicArea / totalArea));

  const privateH = snapToGrid(b.h * (1 - publicFrac));
  const publicH = b.h - privateH;

  // Split the footprint horizontally.
  const splitY = b.y + privateH;

  // For a rectangular footprint, create the two bands as polygons.
  const privatePoly = rectToPolygon(b.x, b.y, b.w, privateH);
  const publicPoly = rectToPolygon(b.x, splitY, b.w, publicH);

  const rng = createPRNGSub(seed);

  // Subdivide private rooms into the top band.
  const privateResult = subdivide(privatePoly, privateRooms, {
    seed: rng(),
    policy: { forceAxis: 'alternate' },
  });

  // Subdivide public rooms into the bottom band. Split vertically so living,
  // dining and kitchen sit side by side across the band and each keeps its
  // full depth — stacking them horizontally turned the band into slivers.
  const publicResult = subdivide(publicPoly, publicRooms, {
    seed: rng(),
    policy: { forceAxis: 'vertical' },
  });

  return {
    cells: [...privateResult.cells, ...publicResult.cells],
    tree: null,
    seed,
  };
}

function createPRNGSub(seed) {
  // Inline simple PRNG for sub-seeds.
  let s = seed | 0;
  return function() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % 2147483647;
  };
}

function generateCustomVariant(totalAreaFt, roomSpecs, seed, aspect) {
  const footprint = computeFootprint(totalAreaFt, aspect ?? 1.3);
  const rooms = expandSpecs(roomSpecs);
  // Custom: just a clean grid, no optimization.
  const result = subdivide(footprint, rooms, {
    seed,
    policy: { forceAxis: 'alternate' },
  });
  return { footprint, ...result };
}

// ---------------------------------------------------------------------------
// Finalize layout
// ---------------------------------------------------------------------------

function finalizeLayout(variant, footprint) {
  const b = polyBbox(footprint);
  const boundary = { width: round1(b.w), height: round1(b.h) };

  // Convert cells to the shape expected by generateWalls.  The polygon and
  // label go along too — the plan graph needs real edges, not just a bbox.
  const roomsForWalls = variant.cells.map(c => ({
    id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, type: c.roomType,
    roomType: c.roomType, label: c.label, polygon: c.polygon,
  }));

  const { walls, doors, windows, entryRoomId, connectivity } = generateWalls(roomsForWalls, boundary);
  const furnishings = defaultFurnishings(variant.cells, doors);

  return {
    footprint: { polygon: footprint, width: boundary.width, height: boundary.height },
    boundary,
    rooms: variant.cells,
    walls,
    doors,
    windows,
    furnishings,
    entryRoomId,
    connectivity,
    seed: variant.seed,
  };
}

// ---------------------------------------------------------------------------
// Variant metadata
// ---------------------------------------------------------------------------

export const VARIANT_INFO = [
  {
    id: 'shelf',
    name: 'Shelf Layout',
    desc: 'Rows of rooms stretched to fill the width',
    strategy: generateShelfVariant,
  },
  {
    id: 'grid',
    name: 'Grid Layout',
    desc: 'Alternating splits, compact and organized',
    strategy: generateGridVariant,
  },
  {
    id: 'corridor',
    name: 'Corridor Plan',
    desc: 'Rooms on both sides of a central hallway',
    strategy: generateCorridorVariant,
  },
  {
    id: 'open',
    name: 'Open Plan',
    desc: 'Large open living area, private bedrooms',
    strategy: generateOpenPlanVariant,
  },
];

/**
 * Build a single layout candidate under full control of strategy, seed and
 * envelope proportion.  The auto-designer sweeps this across a search space;
 * `generateVariants` is the fixed four-option version used by manual mode.
 *
 * @param {string} strategyId - One of the `VARIANT_INFO` ids, or 'custom'.
 * @param {number} totalAreaFt
 * @param {Object[]} roomSpecs
 * @param {Object} [opts]
 * @param {number} [opts.seed]
 * @param {number} [opts.aspect] - Envelope width/height ratio.
 * @returns {{ id, name, desc, layout, seed, aspect } | null} Null if the
 *          strategy produced no cells.
 */
export function buildCandidate(strategyId, totalAreaFt, roomSpecs, opts = {}) {
  const info = VARIANT_INFO.find(v => v.id === strategyId);
  const strategy = info ? info.strategy : generateCustomVariant;
  const seed = opts.seed ?? (Date.now() | 0);

  const variant = strategy(totalAreaFt, roomSpecs, seed, opts.aspect);
  if (!variant || variant.cells.length === 0) return null;

  return {
    id: strategyId,
    name: info ? info.name : 'Custom Layout',
    desc: info ? info.desc : 'Grid starting point',
    layout: finalizeLayout(variant, variant.footprint),
    seed,
    aspect: opts.aspect ?? null,
  };
}

/**
 * Summary stats shown on a layout card.
 *
 * @param {Object} layout
 * @returns {{ roomCount: number, dimensions: string, efficiency: number }}
 */
export function layoutStats(layout) {
  const totalRoomArea = layout.rooms.reduce((s, r) => s + (r.actualArea || r.w * r.h), 0);
  const boundaryArea = layout.boundary.width * layout.boundary.height;
  return {
    roomCount: layout.rooms.length,
    dimensions: `${layout.boundary.width.toFixed(0)} × ${layout.boundary.height.toFixed(0)}`,
    efficiency: boundaryArea > 0 ? Math.round((totalRoomArea / boundaryArea) * 100) : 0,
  };
}

/**
 * Generate multiple layout variants from room specifications.
 * Returns an array of complete layout objects, each with a different arrangement.
 *
 * @param {number} totalAreaFt
 * @param {Object[]} roomSpecs
 * @param {number} [seed] - Optional seed; auto-generated if not provided.
 * @returns {Object[]}
 */
export function generateVariants(totalAreaFt, roomSpecs, seed) {
  const baseSeed = seed ?? (Date.now() | 0);
  const results = [];

  VARIANT_INFO.forEach(({ id, name, desc, strategy }, idx) => {
    try {
      const variantSeed = (baseSeed + idx * 1000) | 0;
      const variant = strategy(totalAreaFt, roomSpecs, variantSeed);
      if (variant.cells.length === 0) return;

      const layout = finalizeLayout(variant, variant.footprint);

      // Run adjacency optimization.
      const optimized = optimizeLayout(
        variant.footprint,
        expandSpecs(roomSpecs),
        { seed: variantSeed, iterations: 200 },
      );

      // If optimization improved things, use it.
      const optLayout = finalizeLayout({ ...variant, cells: optimized.cells, seed: optimized.seed }, variant.footprint);

      const totalRoomArea = layout.rooms.reduce((s, r) => s + r.actualArea, 0);
      const boundaryArea = layout.boundary.width * layout.boundary.height;

      const reachability = checkReachability(layout.rooms);
      const adjScore = scoreAdjacency(layout.rooms);

      results.push({
        id,
        name,
        desc,
        layout: reachability.reachable ? optLayout : layout,
        stats: {
          roomCount: layout.rooms.length,
          dimensions: `${layout.boundary.width.toFixed(0)} × ${layout.boundary.height.toFixed(0)}`,
          efficiency: Math.round((totalRoomArea / boundaryArea) * 100),
          adjacency: adjScore,
          reachable: reachability.reachable,
        },
      });
    } catch (e) {
      console.warn(`Variant "${id}" failed:`, e);
    }
  });

  // Append custom variant.
  try {
    const customSeed = (baseSeed + 9999) | 0;
    const variant = generateCustomVariant(totalAreaFt, roomSpecs, customSeed);
    if (variant.cells.length > 0) {
      const layout = finalizeLayout(variant, variant.footprint);
      layout.isCustom = true;
      const totalRoomArea = layout.rooms.reduce((s, r) => s + r.actualArea, 0);
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
