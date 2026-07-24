import { describe, it, expect } from 'vitest';
import { sharedIntervals, buildContactGraph, exteriorIntervals, planConnections } from '../planGraph.js';
import { generateWalls } from '../geometry.js';

/** A 30×20 plan: hall spine across the middle, rooms above and below. */
function hallPlan() {
  return [
    { id: 'living_1', type: 'living', roomType: 'living', label: 'Living Room', x: 0, y: 0, w: 18, h: 8 },
    { id: 'kitchen_1', type: 'kitchen', roomType: 'kitchen', label: 'Kitchen', x: 18, y: 0, w: 12, h: 8 },
    { id: 'hall_1', type: 'hall', roomType: 'hall', label: 'Hallway', x: 0, y: 8, w: 30, h: 4 },
    { id: 'bedroom_1', type: 'bedroom', roomType: 'bedroom', label: 'Bedroom 1', x: 0, y: 12, w: 12, h: 8 },
    { id: 'bedroom_2', type: 'bedroom', roomType: 'bedroom', label: 'Bedroom 2', x: 12, y: 12, w: 10, h: 8 },
    { id: 'bathroom_1', type: 'bathroom', roomType: 'bathroom', label: 'Bathroom', x: 22, y: 12, w: 8, h: 8 },
  ];
}

const boundary = { width: 30, height: 20 };

describe('planGraph — contacts', () => {
  it('finds the exact interval two rooms share', () => {
    const rooms = hallPlan();
    const ivs = sharedIntervals(rooms[0], rooms[1]); // living | kitchen
    expect(ivs.length).toBe(1);
    expect(ivs[0].axis).toBe('v');
    expect(ivs[0].fixed).toBe(18);
    expect(ivs[0].lo).toBe(0);
    expect(ivs[0].hi).toBe(8);
  });

  it('reports no contact between rooms separated by the hall', () => {
    const rooms = hallPlan();
    const living = rooms.find(r => r.id === 'living_1');
    const bed = rooms.find(r => r.id === 'bedroom_1');
    expect(sharedIntervals(living, bed).length).toBe(0);
  });

  it('ignores contacts too short to hold a door', () => {
    const rooms = [
      { id: 'a', roomType: 'living', label: 'A', x: 0, y: 0, w: 10, h: 10 },
      // Overlaps the right wall of A by only 1 ft.
      { id: 'b', roomType: 'store', label: 'B', x: 10, y: 9, w: 5, h: 1 },
    ];
    expect(buildContactGraph(rooms).size).toBe(0);
  });
});

describe('planGraph — exterior walls', () => {
  it('only reports edges that actually face outside', () => {
    const rooms = hallPlan();
    const hall = rooms.find(r => r.id === 'hall_1');
    const ext = exteriorIntervals(hall, boundary, rooms);
    // The hall spans the full width, so only its two end walls face out.
    expect(ext.length).toBe(2);
    expect(ext.every(e => e.axis === 'v')).toBe(true);
  });

  it('excludes the stretch of an envelope-line edge shared with a neighbour', () => {
    const rooms = hallPlan();
    const living = rooms.find(r => r.id === 'living_1');
    const ext = exteriorIntervals(living, boundary, rooms);
    // Left wall and top wall face out; the wall shared with the kitchen and
    // the wall onto the hall must not appear.
    expect(ext.some(e => e.axis === 'v' && e.fixed === 18)).toBe(false);
    expect(ext.some(e => e.axis === 'h' && e.fixed === 8)).toBe(false);
    expect(ext.some(e => e.axis === 'v' && e.fixed === 0)).toBe(true);
  });
});

describe('planGraph — connectivity', () => {
  it('reaches every room without stranding any', () => {
    const { stranded } = planConnections(hallPlan(), boundary);
    expect(stranded).toEqual([]);
  });

  it('picks the hall as the entry when there is one', () => {
    expect(planConnections(hallPlan(), boundary).entryId).toBe('hall_1');
  });

  it('never routes circulation through a bedroom when a hall is available', () => {
    const { compromises } = planConnections(hallPlan(), boundary);
    expect(compromises).toEqual([]);
  });

  it('hangs every private room directly off circulation', () => {
    const { connections } = planConnections(hallPlan(), boundary);
    ['bedroom_1', 'bedroom_2', 'bathroom_1'].forEach(id => {
      const viaHall = connections.some(c =>
        (c.aId === id && c.bId === 'hall_1') || (c.bId === id && c.aId === 'hall_1'));
      expect(viaHall, `${id} should open onto the hall`).toBe(true);
    });
  });

  it('flags a compromise, with severity, when a room can only be reached through a bedroom', () => {
    // A tucked behind a bedroom with no other neighbour.
    const rooms = [
      { id: 'living_1', roomType: 'living', label: 'Living', x: 0, y: 0, w: 20, h: 10 },
      { id: 'bedroom_1', roomType: 'bedroom', label: 'Bedroom', x: 0, y: 10, w: 20, h: 10 },
      { id: 'store_1', roomType: 'store', label: 'Store', x: 0, y: 20, w: 20, h: 6 },
    ];
    const { stranded, compromises } = planConnections(rooms, { width: 20, height: 26 });
    expect(stranded).toEqual([]);
    expect(compromises.length).toBe(1);
    expect(compromises[0].severe).toBe(true);
    expect(compromises[0].message).toContain('Store');
  });
});

describe('geometry — graph-driven openings', () => {
  it('puts exactly one opening on each shared wall, not one per room', () => {
    const { doors } = generateWalls(hallPlan(), boundary);
    const seen = new Set();
    doors.filter(d => d.connects && d.connects[1]).forEach(d => {
      const [a, b] = d.connects;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      expect(seen.has(key), `duplicate opening between ${a} and ${b}`).toBe(false);
      seen.add(key);
    });
  });

  it('always produces a front door', () => {
    const { doors } = generateWalls(hallPlan(), boundary);
    expect(doors.filter(d => d.isEntry).length).toBe(1);
  });

  it('keeps every opening inside the wall it belongs to', () => {
    const { doors } = generateWalls(hallPlan(), boundary);
    doors.forEach(d => {
      expect(d.width).toBeGreaterThan(0);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeGreaterThanOrEqual(0);
      if (d.horizontal) expect(d.x + d.width).toBeLessThanOrEqual(boundary.width + 0.01);
      else expect(d.y + d.width).toBeLessThanOrEqual(boundary.height + 0.01);
    });
  });

  it('never overlaps a window with a door on the same wall', () => {
    const { doors, windows } = generateWalls(hallPlan(), boundary);
    windows.forEach(w => {
      doors.forEach(d => {
        if (w.horizontal !== d.horizontal) return;
        const line = w.horizontal ? Math.abs(w.y - d.y) : Math.abs(w.x - d.x);
        if (line > 0.3) return;
        const ws = w.horizontal ? w.x : w.y;
        const ds = d.horizontal ? d.x : d.y;
        const overlap = Math.min(ws + w.width, ds + d.width) - Math.max(ws, ds);
        expect(overlap, `window ${w.id} collides with door ${d.id}`).toBeLessThanOrEqual(0);
      });
    });
  });

  it('gives a long facade more than one window', () => {
    const { windows } = generateWalls(hallPlan(), boundary);
    const livingWindows = windows.filter(w => w.roomId === 'living_1');
    expect(livingWindows.length).toBeGreaterThan(1);
  });
});
