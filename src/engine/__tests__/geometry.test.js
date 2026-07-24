import { describe, it, expect } from 'vitest';
import { generateWalls, wallToQuad, generateWallQuads } from '../geometry.js';

const rooms = [
  { id: 'bedroom_1', x: 0, y: 0, w: 12, h: 10, type: 'bedroom' },
  { id: 'bedroom_2', x: 12, y: 0, w: 12, h: 10, type: 'bedroom' },
  { id: 'bathroom_1', x: 0, y: 10, w: 8, h: 6, type: 'bathroom' },
  { id: 'kitchen_1', x: 8, y: 10, w: 16, h: 6, type: 'kitchen' },
];

const boundary = { width: 24, height: 16 };

describe('generateWalls', () => {
  it('produces walls with IDs', () => {
    const { walls } = generateWalls(rooms, boundary);
    expect(walls.length).toBeGreaterThan(0);
    for (const w of walls) {
      expect(w.id).toMatch(/^wall_\d+$/);
    }
  });

  it('walls have thickness and kind', () => {
    const { walls } = generateWalls(rooms, boundary);
    for (const w of walls) {
      expect(w.thickness).toBeGreaterThan(0);
      expect(['exterior', 'interior']).toContain(w.kind);
    }
  });

  it('exterior walls are thicker than interior walls', () => {
    const { walls } = generateWalls(rooms, boundary);
    const exterior = walls.filter(w => w.kind === 'exterior');
    const interior = walls.filter(w => w.kind === 'interior');
    if (exterior.length > 0 && interior.length > 0) {
      expect(exterior[0].thickness).toBeGreaterThan(interior[0].thickness);
    }
  });

  it('walls have start and end as [x,y] pairs', () => {
    const { walls } = generateWalls(rooms, boundary);
    for (const w of walls) {
      expect(w.start).toHaveLength(2);
      expect(w.end).toHaveLength(2);
      expect(typeof w.start[0]).toBe('number');
      expect(typeof w.start[1]).toBe('number');
    }
  });

  it('interior walls track adjacent cell IDs', () => {
    const { walls } = generateWalls(rooms, boundary);
    const interior = walls.filter(w => w.kind === 'interior');
    for (const w of interior) {
      expect(w.leftCellId).toBeTruthy();
      expect(w.rightCellId).toBeTruthy();
    }
  });

  it('produces doors with wallId and offset', () => {
    const { doors } = generateWalls(rooms, boundary);
    expect(doors.length).toBeGreaterThan(0);
    for (const d of doors) {
      expect(d.id).toMatch(/^opening_\d+$/);
      expect(d.kind).toBe('door');
      expect(typeof d.offsetAlongWall).toBe('number');
      expect(typeof d.x).toBe('number');
      expect(typeof d.y).toBe('number');
      expect(typeof d.horizontal).toBe('boolean');
      expect(['in', 'out']).toContain(d.swingDirection);
    }
  });

  it('produces windows on exterior walls of habitable rooms', () => {
    const { windows } = generateWalls(rooms, boundary);
    // bedroom and kitchen should get windows.
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.kind).toBe('window');
      expect(w.width).toBeGreaterThanOrEqual(2);
    }
    const habitable = windows.filter(w => w.roomId.startsWith('bedroom') || w.roomId.startsWith('living'));
    for (const w of habitable) {
      expect(w.width).toBeGreaterThanOrEqual(3);
    }
  });

  it('gives a bathroom a small window, not a full one', () => {
    const { windows } = generateWalls(rooms, boundary);
    const bathroomWindows = windows.filter(w => w.roomId === 'bathroom_1');
    for (const w of bathroomWindows) {
      expect(w.width).toBeLessThanOrEqual(3);
    }
  });

  it('every room is joined to the plan by at least one opening', () => {
    const { doors } = generateWalls(rooms, boundary);
    const connected = new Set();
    doors.forEach(d => (d.connects || [d.roomId]).forEach(id => id && connected.add(id)));
    for (const room of rooms) {
      expect(connected.has(room.id)).toBe(true);
    }
  });

  it('walls are either horizontal or vertical', () => {
    const { walls } = generateWalls(rooms, boundary);
    for (const w of walls) {
      const isH = Math.abs(w.y1 - w.y2) < 0.01;
      const isV = Math.abs(w.x1 - w.x2) < 0.01;
      expect(isH || isV).toBe(true);
    }
  });

  it('handles null boundary (no windows)', () => {
    const { walls, doors, windows } = generateWalls(rooms, null);
    expect(walls.length).toBeGreaterThan(0);
    expect(doors.length).toBeGreaterThan(0);
    expect(windows.length).toBe(0);
  });
});

describe('wallToQuad', () => {
  it('produces a 4-vertex quad for a horizontal wall', () => {
    const wall = { x1: 0, y1: 5, x2: 10, y2: 5, thickness: 0.5 };
    const quad = wallToQuad(wall);
    expect(quad).toHaveLength(4);
    // All vertices should be at y = 5 ± 0.25.
    expect(quad[0][1]).toBeCloseTo(4.75, 4);
    expect(quad[2][1]).toBeCloseTo(5.25, 4);
  });

  it('produces a 4-vertex quad for a vertical wall', () => {
    const wall = { x1: 5, y1: 0, x2: 5, y2: 10, thickness: 0.5 };
    const quad = wallToQuad(wall);
    expect(quad).toHaveLength(4);
    // All vertices should be at x = 5 ± 0.25.
    expect(quad[0][0]).toBeCloseTo(4.75, 4);
    expect(quad[2][0]).toBeCloseTo(5.25, 4);
  });

  it('exterior wall quads are wider', () => {
    const extWall = { x1: 0, y1: 0, x2: 10, y2: 0, thickness: 0.75 };
    const intWall = { x1: 0, y1: 5, x2: 10, y2: 5, thickness: 0.375 };
    const extQuad = wallToQuad(extWall);
    const intQuad = wallToQuad(intWall);
    // Exterior wall quad is thicker.
    const extThickness = extQuad[2][1] - extQuad[0][1];
    const intThickness = intQuad[2][1] - intQuad[0][1];
    expect(extThickness).toBeGreaterThan(intThickness);
  });
});

describe('generateWallQuads', () => {
  it('returns one quad per wall', () => {
    const { walls } = generateWalls(rooms, boundary);
    const quads = generateWallQuads(walls);
    expect(quads.length).toBe(walls.length);
    for (const q of quads) {
      expect(q.length).toBe(4);
    }
  });
});
