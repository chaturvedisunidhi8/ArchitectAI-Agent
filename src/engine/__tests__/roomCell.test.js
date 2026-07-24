import { describe, it, expect } from 'vitest';
import { createRoomCell, migrateLegacyRoom } from '../roomCell.js';
import { area as polyArea, rectToPolygon } from '../polygon.js';

describe('createRoomCell', () => {
  it('creates a cell from explicit polygon', () => {
    const cell = createRoomCell({
      id: 'bedroom_1',
      roomType: 'bedroom',
      label: 'Bedroom 1',
      polygon: rectToPolygon(5, 3, 12, 10),
      targetArea: 120,
      color: '#E8D5B7',
    });
    expect(cell.id).toBe('bedroom_1');
    expect(cell.roomType).toBe('bedroom');
    expect(cell.polygon).toEqual([[5, 3], [17, 3], [17, 13], [5, 13]]);
    expect(cell.actualArea).toBeCloseTo(120, 4);
    expect(cell.targetArea).toBe(120);
  });

  it('bbox getters derive from polygon', () => {
    const cell = createRoomCell({
      id: 'test',
      roomType: 'living',
      label: 'Living',
      polygon: rectToPolygon(5, 3, 12, 10),
      targetArea: 120,
    });
    expect(cell.x).toBeCloseTo(5, 6);
    expect(cell.y).toBeCloseTo(3, 6);
    expect(cell.w).toBeCloseTo(12, 6);
    expect(cell.h).toBeCloseTo(10, 6);
  });

  it('creates a cell from legacy {x, y, w, h}', () => {
    const cell = createRoomCell({
      id: 'kitchen_1',
      roomType: 'kitchen',
      label: 'Kitchen',
      x: 0, y: 0, w: 8, h: 6,
      targetArea: 48,
    });
    expect(cell.x).toBeCloseTo(0, 6);
    expect(cell.y).toBeCloseTo(0, 6);
    expect(cell.w).toBeCloseTo(8, 6);
    expect(cell.h).toBeCloseTo(6, 6);
    expect(cell.polygon).toEqual([[0, 0], [8, 0], [8, 6], [0, 6]]);
    expect(cell.actualArea).toBeCloseTo(48, 4);
  });

  it('centroid is correct for a rectangle', () => {
    const cell = createRoomCell({
      id: 'r1',
      roomType: 'bedroom',
      label: 'R1',
      x: 0, y: 0, w: 10, h: 8,
      targetArea: 80,
    });
    expect(cell.centroid[0]).toBeCloseTo(5, 6);
    expect(cell.centroid[1]).toBeCloseTo(4, 6);
  });

  it('handles L-shaped polygon', () => {
    const lShape = [[0, 0], [3, 0], [3, 2], [2, 2], [2, 4], [0, 4]];
    const cell = createRoomCell({
      id: 'l1',
      roomType: 'living',
      label: 'L1',
      polygon: lShape,
      targetArea: 10,
    });
    expect(cell.actualArea).toBeCloseTo(10, 4);
    // Bounding box
    expect(cell.x).toBeCloseTo(0, 6);
    expect(cell.y).toBeCloseTo(0, 6);
    expect(cell.w).toBeCloseTo(3, 6);
    expect(cell.h).toBeCloseTo(4, 6);
  });
});

describe('migrateLegacyRoom', () => {
  it('converts a legacy room to a RoomCell', () => {
    const legacy = {
      id: 'bedroom_1',
      type: 'bedroom',
      label: 'Bedroom 1',
      color: '#E8D5B7',
      targetArea: 150,
      aspectTarget: 1.3,
      x: 5,
      y: 3,
      w: 12,
      h: 10,
    };
    const cell = migrateLegacyRoom(legacy);
    expect(cell.id).toBe('bedroom_1');
    expect(cell.roomType).toBe('bedroom');
    expect(cell.label).toBe('Bedroom 1');
    expect(cell.color).toBe('#E8D5B7');
    expect(cell.x).toBeCloseTo(5, 6);
    expect(cell.y).toBeCloseTo(3, 6);
    expect(cell.w).toBeCloseTo(12, 6);
    expect(cell.h).toBeCloseTo(10, 6);
    expect(cell.polygon).toEqual(rectToPolygon(5, 3, 12, 10));
  });

  it('preserves floorType', () => {
    const legacy = {
      id: 'kitchen_1',
      type: 'kitchen',
      label: 'Kitchen',
      x: 0, y: 0, w: 8, h: 6,
      targetArea: 48,
      floorType: 'tile',
    };
    const cell = migrateLegacyRoom(legacy);
    expect(cell.floorType).toBe('tile');
  });
});
