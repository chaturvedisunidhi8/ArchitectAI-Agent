import { describe, it, expect } from 'vitest';
import { roomExteriorWalls, analyzeEnergy } from '../energyAnalyzer.js';
import { createRoomCell } from '../roomCell.js';
import { rectToPolygon } from '../polygon.js';
import { generateWalls } from '../geometry.js';

function cell(id, roomType, x, y, w, h) {
  return createRoomCell({ id, roomType, label: id, x, y, w, h, targetArea: w * h });
}

describe('roomExteriorWalls', () => {
  it('detects exterior walls on a rectangular envelope', () => {
    // The subdivision engine emits `{ width, height }` boundaries with no
    // polygon. RoomCells always carry one, so the polygon branch used to run
    // against an undefined envelope and report zero exterior walls for
    // every room — flattening daylight and ventilation scores.
    const boundary = { width: 30, height: 20 };
    const corner = cell('a', 'bedroom', 0, 0, 10, 10);
    const interior = cell('b', 'bedroom', 12, 6, 6, 6);

    expect(roomExteriorWalls(corner, boundary).length).toBe(2);
    expect(roomExteriorWalls(interior, boundary)).toHaveLength(0);
  });

  it('still uses the polygon path when the envelope is a polygon', () => {
    const boundary = { width: 30, height: 20, polygon: rectToPolygon(0, 0, 30, 20) };
    const corner = cell('a', 'bedroom', 0, 0, 10, 10);
    expect(roomExteriorWalls(corner, boundary).length).toBeGreaterThan(0);
  });

  it('finds all four sides for a room filling the envelope', () => {
    const boundary = { width: 10, height: 10 };
    expect(roomExteriorWalls(cell('a', 'living', 0, 0, 10, 10), boundary)).toHaveLength(4);
  });
});

describe('analyzeEnergy', () => {
  it('scores perimeter rooms above landlocked ones', () => {
    const rooms = [
      cell('living_1', 'living', 0, 0, 12, 20),
      cell('bedroom_1', 'bedroom', 12, 6, 8, 8), // fully enclosed
      cell('bedroom_2', 'bedroom', 20, 0, 10, 20),
    ];
    const boundary = { width: 30, height: 20 };
    const { walls, doors, windows } = generateWalls(
      rooms.map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, type: r.roomType })),
      boundary,
    );
    const result = analyzeEnergy({ boundary, rooms, walls, doors, windows });

    const perimeter = result.rooms.find(r => r.id === 'living_1');
    const landlocked = result.rooms.find(r => r.id === 'bedroom_1');
    expect(perimeter.light.score).toBeGreaterThan(landlocked.light.score);
    expect(result.averages.overall).toBeGreaterThan(0);
  });

  it('returns null rather than NaN for an empty plan', () => {
    expect(analyzeEnergy({ boundary: { width: 10, height: 10 }, rooms: [] })).toBeNull();
    expect(analyzeEnergy(null)).toBeNull();
  });

  it('generates light tips using the RoomCell type field', () => {
    const rooms = [cell('bedroom_1', 'bedroom', 4, 4, 8, 8)]; // no exterior wall
    const result = analyzeEnergy({
      boundary: { width: 30, height: 30 }, rooms, walls: [], doors: [], windows: [],
    });
    expect(result.rooms[0].type).toBe('bedroom');
    expect(result.tips.length).toBeGreaterThan(0);
  });
});
