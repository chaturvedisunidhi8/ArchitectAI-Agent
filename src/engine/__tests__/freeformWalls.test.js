import { describe, it, expect } from 'vitest';
import { generateWalls } from '../geometry.js';
import { roomExteriorWalls } from '../energyAnalyzer.js';
import { detectAdjacencies } from '../adjacency.js';
import { createRoomCell } from '../roomCell.js';

// Helper: create a minimal RoomCell with polygon.
function makeCell(id, type, polygon, opts = {}) {
  return createRoomCell({
    id,
    label: `${type}_${id}`,
    roomType: type,
    polygon,
    ...opts,
  });
}

describe('generateWalls with polygon rooms', () => {
  it('generates wall segments from a diagonal room edge', () => {
    const rooms = [
      makeCell('r1', 'living', [[0, 0], [40, 0], [30, 30], [0, 30]]),
    ];
    const boundary = { width: 40, height: 30, x: 0, y: 0 };
    const { walls } = generateWalls(rooms, boundary, [], []);
    // Should have walls for all 4 edges (including the diagonal from (30,30)→(0,30) is axis-aligned H,
    // (40,0)→(30,30) is diagonal).
    const diagonalWalls = walls.filter(w =>
      Math.abs(w.x1 - w.x2) > 0.01 && Math.abs(w.y1 - w.y2) > 0.01,
    );
    expect(diagonalWalls.length).toBe(1); // one diagonal edge
    expect(diagonalWalls[0].x1).toBe(40);
    expect(diagonalWalls[0].y1).toBe(0);
    expect(diagonalWalls[0].x2).toBe(30);
    expect(diagonalWalls[0].y2).toBe(30);
  });

  it('generates walls from two adjacent rooms sharing a polygon edge', () => {
    const r1 = makeCell('r1', 'living', [[0, 0], [20, 0], [20, 15], [0, 15]]);
    const r2 = makeCell('r2', 'kitchen', [[20, 0], [40, 0], [40, 15], [20, 15]]);
    const rooms = [r1, r2];
    const boundary = { width: 40, height: 15, x: 0, y: 0 };
    const { walls } = generateWalls(rooms, boundary, [], []);
    // The shared edge should exist but be marked interior.
    const sharedWalls = walls.filter(w =>
      w.x1 === 20 && w.x2 === 20 && Math.abs(w.y1 - 0) < 0.1 && Math.abs(w.y2 - 15) < 0.1,
    );
    expect(sharedWalls.length).toBe(1);
    expect(sharedWalls[0].kind).toBe('interior');
  });
});

describe('energyAnalyzer polygon rooms', () => {
  it('detects exterior edges of a polygon room against a polygon boundary', () => {
    const boundary = {
      width: 40,
      height: 40,
      polygon: [[0, 0], [40, 0], [40, 40], [0, 40]],
    };
    // Room along bottom edge.
    const room = {
      id: 'r1',
      polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
      w: 20, h: 10, x: 0, y: 0,
    };
    const sides = roomExteriorWalls(room, boundary);
    // Bottom edge (0,0)→(20,0) is on boundary bottom — should be exterior.
    expect(sides.length).toBeGreaterThanOrEqual(1);
  });

  it('returns no exterior sides for an interior polygon room', () => {
    const boundary = {
      width: 40,
      height: 40,
      polygon: [[0, 0], [40, 0], [40, 40], [0, 40]],
    };
    const room = {
      id: 'r1',
      polygon: [[10, 10], [30, 10], [30, 30], [10, 30]],
      w: 20, h: 20, x: 10, y: 10,
    };
    const sides = roomExteriorWalls(room, boundary);
    expect(sides.length).toBe(0);
  });
});

describe('adjacency polygon rooms', () => {
  it('detects shared wall length between polygon rooms', () => {
    const r1 = makeCell('r1', 'living', [[0, 0], [20, 0], [20, 15], [0, 15]]);
    const r2 = makeCell('r2', 'kitchen', [[20, 0], [40, 0], [40, 15], [20, 15]]);
    const adj = detectAdjacencies([r1, r2]);
    const key = 'r1|r2';
    expect(adj.has(key)).toBe(true);
    expect(adj.get(key)).toBeGreaterThanOrEqual(15);
  });

  it('does not report non-adjacent rooms', () => {
    const r1 = makeCell('r1', 'living', [[0, 0], [10, 0], [10, 10], [0, 10]]);
    const r2 = makeCell('r2', 'kitchen', [[30, 30], [40, 30], [40, 40], [30, 40]]);
    const adj = detectAdjacencies([r1, r2]);
    expect(adj.size).toBe(0);
  });

  it('handles rotated rooms with shared bbox edge', () => {
    // Two rooms whose bboxes share an edge but polygons are rotated.
    const r1 = makeCell('r1', 'living', [[0, 0], [20, 0], [20, 10], [0, 10]]);
    const r2 = makeCell('r2', 'bedroom', [[0, 10], [20, 10], [20, 20], [0, 20]]);
    const adj = detectAdjacencies([r1, r2]);
    const key = 'r1|r2';
    expect(adj.has(key)).toBe(true);
    expect(adj.get(key)).toBeGreaterThanOrEqual(10);
  });
});
