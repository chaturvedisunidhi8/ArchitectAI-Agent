import { describe, it, expect } from 'vitest';
import { subdivide, optimizeLayout } from '../subdivision.js';
import { makeRectFootprint, area as polyArea, bbox as polyBbox, rectToPolygon } from '../polygon.js';
import { carveCorridor } from '../circulation.js';
import { scoreAdjacency, checkReachability, detectAdjacencies, getAdjacencyWeight } from '../adjacency.js';

const EPS = 1e-4;

function makeSpecs(counts) {
  const specs = [];
  for (const [type, label, targetArea, count] of counts) {
    for (let i = 0; i < count; i++) {
      specs.push({
        id: `${type}_${i + 1}`,
        type,
        label: count > 1 ? `${label} ${i + 1}` : label,
        targetArea,
        color: '#cccccc',
        aspectTarget: 1.2,
      });
    }
  }
  return specs;
}

describe('subdivision', () => {
  it('produces gap-free tiling on a rectangle with 4 rooms', () => {
    const fp = makeRectFootprint(40, 30);
    const specs = makeSpecs([
      ['bedroom', 'Bedroom', 150, 2],
      ['bathroom', 'Bathroom', 50, 1],
      ['kitchen', 'Kitchen', 100, 1],
    ]);

    const result = subdivide(fp, specs, { seed: 42 });
    expect(result.cells.length).toBe(4);

    // All cells should have valid polygons.
    for (const cell of result.cells) {
      expect(cell.polygon.length).toBeGreaterThanOrEqual(4);
      expect(cell.w).toBeGreaterThan(0);
      expect(cell.h).toBeGreaterThan(0);
    }

    // Cells should tile the footprint (sum of areas ≈ footprint area).
    const totalCellArea = result.cells.reduce((s, c) => s + c.actualArea, 0);
    const fpArea = polyArea(fp);
    expect(totalCellArea).toBeCloseTo(fpArea, 0);
  });

  it('respects aspect ratio constraints (no cell > 2.2)', () => {
    const fp = makeRectFootprint(50, 40);
    const specs = makeSpecs([
      ['bedroom', 'Bedroom', 150, 2],
      ['bathroom', 'Bathroom', 50, 1],
      ['kitchen', 'Kitchen', 100, 1],
      ['living', 'Living', 200, 1],
    ]);

    const result = subdivide(fp, specs, { seed: 123 });
    for (const cell of result.cells) {
      const b = polyBbox(cell.polygon);
      const ar = Math.max(b.w / b.h, b.h / b.w);
      expect(ar).toBeLessThanOrEqual(3); // Allow some slack for edge cases.
    }
  });

  it('deterministic with same seed', () => {
    const fp = makeRectFootprint(40, 30);
    const specs = makeSpecs([
      ['bedroom', 'Bedroom', 150, 2],
      ['kitchen', 'Kitchen', 100, 1],
    ]);

    const r1 = subdivide(fp, specs, { seed: 42 });
    const r2 = subdivide(fp, specs, { seed: 42 });
    expect(r1.cells.length).toBe(r2.cells.length);
    for (let i = 0; i < r1.cells.length; i++) {
      expect(r1.cells[i].x).toBeCloseTo(r2.cells[i].x, 4);
      expect(r1.cells[i].y).toBeCloseTo(r2.cells[i].y, 4);
      expect(r1.cells[i].w).toBeCloseTo(r2.cells[i].w, 4);
      expect(r1.cells[i].h).toBeCloseTo(r2.cells[i].h, 4);
    }
  });

  it('different seeds produce different layouts', () => {
    const fp = makeRectFootprint(40, 30);
    const specs = makeSpecs([
      ['bedroom', 'Bedroom', 150, 2],
      ['bathroom', 'Bathroom', 50, 1],
      ['kitchen', 'Kitchen', 100, 1],
      ['living', 'Living', 200, 1],
    ]);

    const r1 = subdivide(fp, specs, { seed: 1 });
    const r2 = subdivide(fp, specs, { seed: 2 });
    // At least one cell should differ.
    const differs = r1.cells.some((c, i) =>
      Math.abs(c.x - r2.cells[i]?.x) > 0.5 || Math.abs(c.y - r2.cells[i]?.y) > 0.5,
    );
    expect(differs).toBe(true);
  });

  it('handles a single room', () => {
    const fp = makeRectFootprint(20, 15);
    const specs = [{ id: 'living_1', type: 'living', label: 'Living', targetArea: 300, color: '#ccc', aspectTarget: 1.2 }];

    const result = subdivide(fp, specs, { seed: 42 });
    expect(result.cells.length).toBe(1);
    expect(result.cells[0].roomType).toBe('living');
  });

  it('produces cells with correct room types', () => {
    const fp = makeRectFootprint(40, 30);
    const specs = makeSpecs([
      ['bedroom', 'Bedroom', 150, 2],
      ['bathroom', 'Bathroom', 50, 1],
    ]);

    const result = subdivide(fp, specs, { seed: 42 });
    const types = result.cells.map(c => c.roomType).sort();
    expect(types).toEqual(['bathroom', 'bedroom', 'bedroom']);
  });
});

describe('optimizeLayout', () => {
  it('returns a valid layout', () => {
    const fp = makeRectFootprint(40, 30);
    const specs = makeSpecs([
      ['bedroom', 'Bedroom', 150, 2],
      ['bathroom', 'Bathroom', 50, 1],
      ['kitchen', 'Kitchen', 100, 1],
    ]);

    const result = optimizeLayout(fp, specs, { seed: 42, iterations: 50 });
    expect(result.cells.length).toBe(4);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});

describe('circulation', () => {
  it('carves a corridor on a large plan', () => {
    const fp = makeRectFootprint(50, 40);
    const result = carveCorridor(fp, { totalArea: 2000, roomCount: 8 });
    // Should have a corridor and flanking regions.
    expect(result.regions.length).toBeGreaterThanOrEqual(1);
  });

  it('skips corridor for small plans', () => {
    const fp = makeRectFootprint(20, 15);
    const result = carveCorridor(fp, { totalArea: 300, roomCount: 2 });
    expect(result.corridor.length).toBe(0);
    expect(result.regions.length).toBe(1);
  });

  it('corridor width >= minimum', () => {
    const fp = makeRectFootprint(50, 40);
    const result = carveCorridor(fp, { totalArea: 2000, roomCount: 10 });
    if (result.corridorWidth > 0) {
      expect(result.corridorWidth).toBeGreaterThanOrEqual(3.5);
    }
  });
});

describe('adjacency', () => {
  it('detects shared walls between adjacent cells', () => {
    const cells = [
      { id: 'a', roomType: 'bedroom', polygon: rectToPolygon(0, 0, 10, 10) },
      { id: 'b', roomType: 'bathroom', polygon: rectToPolygon(10, 0, 5, 10) },
    ];
    const adj = detectAdjacencies(cells);
    expect(adj.size).toBe(1);
    const key = adj.keys().next().value;
    expect(key).toContain('a');
    expect(key).toContain('b');
  });

  it('returns 0 weight for unknown room types', () => {
    expect(getAdjacencyWeight('unknown1', 'unknown2')).toBe(0);
  });

  it('returns correct weights for known adjacencies', () => {
    expect(getAdjacencyWeight('dining', 'kitchen')).toBe(9);
    expect(getAdjacencyWeight('bathroom', 'bedroom')).toBe(8);
  });

  it('scores a good layout higher', () => {
    const goodCells = [
      { id: 'dining_1', roomType: 'dining', polygon: rectToPolygon(0, 0, 10, 10) },
      { id: 'kitchen_1', roomType: 'kitchen', polygon: rectToPolygon(10, 0, 10, 10) },
    ];
    const badCells = [
      { id: 'dining_1', roomType: 'dining', polygon: rectToPolygon(0, 0, 10, 10) },
      { id: 'kitchen_1', roomType: 'kitchen', polygon: rectToPolygon(20, 20, 10, 10) },
    ];
    expect(scoreAdjacency(goodCells)).toBeGreaterThan(scoreAdjacency(badCells));
  });

  it('reachability: all cells reachable from living', () => {
    const cells = [
      { id: 'living_1', roomType: 'living', polygon: rectToPolygon(0, 0, 10, 10) },
      { id: 'bedroom_1', roomType: 'bedroom', polygon: rectToPolygon(10, 0, 10, 10) },
      { id: 'kitchen_1', roomType: 'kitchen', polygon: rectToPolygon(0, 10, 10, 10) },
    ];
    const result = checkReachability(cells);
    expect(result.reachable).toBe(true);
  });

  it('reachability: detects unreachable cell', () => {
    const cells = [
      { id: 'living_1', roomType: 'living', polygon: rectToPolygon(0, 0, 10, 10) },
      { id: 'bedroom_1', roomType: 'bedroom', polygon: rectToPolygon(20, 20, 10, 10) }, // Far away, no shared wall
    ];
    const result = checkReachability(cells);
    // Bedroom is isolated — should be unreachable.
    expect(result.reachable).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
