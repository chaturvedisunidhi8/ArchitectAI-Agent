import { describe, it, expect, beforeAll } from 'vitest';

// Mock document.createElement for THREE.CanvasTexture in Node environment.
beforeAll(() => {
  const mockCtx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fillText() {}, closePath() {}, arc() {}, fill() {},
  };
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') {
        return { width: 128, height: 128, getContext() { return mockCtx; } };
      }
      return {};
    },
  };
});

import { buildModel } from '../model3d.js';

const BOUNDARY = { width: 40, height: 30, x: 0, y: 0 };

function makeLayout(rooms, opts = {}) {
  return {
    boundary: opts.boundary || BOUNDARY,
    rooms,
    walls: opts.walls || [],
    doors: opts.doors || [],
    windows: opts.windows || [],
    furnishings: [],
  };
}

describe('buildModel — polygon floor positioning', () => {
  it('positions polygon floor mesh at centroid', () => {
    const rooms = [{
      id: 'r1', label: 'Living', type: 'living', roomType: 'living',
      polygon: [[0, 0], [20, 0], [20, 15], [0, 15]],
      x: 0, y: 0, w: 20, h: 15,
    }];
    const { groups, dispose } = buildModel(makeLayout(rooms));
    try {
      const floor = groups.floors.children.find(c => c.name === 'Floor_r1');
      expect(floor).toBeDefined();
      // Position should be at centroid (10, y, 7.5).
      expect(floor.position.x).toBeCloseTo(10, 1);
      expect(floor.position.z).toBeCloseTo(7.5, 1);
    } finally {
      dispose();
    }
  });

  it('positions rectangular floor mesh at center', () => {
    const rooms = [{
      id: 'r1', label: 'Bed', type: 'bedroom', roomType: 'bedroom',
      x: 5, y: 3, w: 12, h: 10,
    }];
    const { groups, dispose } = buildModel(makeLayout(rooms));
    try {
      const floor = groups.floors.children.find(c => c.name === 'Floor_r1');
      expect(floor).toBeDefined();
      expect(floor.position.x).toBeCloseTo(11, 1);
      expect(floor.position.z).toBeCloseTo(8, 1);
    } finally {
      dispose();
    }
  });
});

describe('buildModel — polygon floor rotation', () => {
  it('applies rotation around centroid for polygon rooms', () => {
    const rooms = [{
      id: 'r1', label: 'Living', type: 'living', roomType: 'living',
      polygon: [[0, 0], [20, 0], [20, 15], [0, 15]],
      x: 0, y: 0, w: 20, h: 15, rotation: Math.PI / 4,
    }];
    const { groups, dispose } = buildModel(makeLayout(rooms));
    try {
      const floor = groups.floors.children.find(c => c.name === 'Floor_r1');
      expect(floor).toBeDefined();
      // Rotation should be on Z axis (floor plan rotation).
      expect(floor.rotation.z).toBeCloseTo(Math.PI / 4, 4);
      // Position at centroid.
      expect(floor.position.x).toBeCloseTo(10, 1);
      expect(floor.position.z).toBeCloseTo(7.5, 1);
    } finally {
      dispose();
    }
  });

  it('does not apply rotation for non-rotated polygon rooms', () => {
    const rooms = [{
      id: 'r1', label: 'Kitchen', type: 'kitchen', roomType: 'kitchen',
      polygon: [[0, 0], [12, 0], [12, 10], [0, 10]],
      x: 0, y: 0, w: 12, h: 10,
    }];
    const { groups, dispose } = buildModel(makeLayout(rooms));
    try {
      const floor = groups.floors.children.find(c => c.name === 'Floor_r1');
      expect(floor).toBeDefined();
      expect(floor.rotation.z).toBe(0);
    } finally {
      dispose();
    }
  });
});

describe('buildModel — polygon ceiling positioning', () => {
  it('positions polygon ceiling at centroid', () => {
    const rooms = [{
      id: 'r1', label: 'Living', type: 'living', roomType: 'living',
      polygon: [[0, 0], [20, 0], [20, 15], [0, 15]],
      x: 0, y: 0, w: 20, h: 15,
    }];
    const { groups, dispose } = buildModel(makeLayout(rooms));
    try {
      const ceiling = groups.ceilings.children.find(c => c.name === 'Ceiling_r1');
      expect(ceiling).toBeDefined();
      expect(ceiling.position.x).toBeCloseTo(10, 1);
      expect(ceiling.position.z).toBeCloseTo(7.5, 1);
    } finally {
      dispose();
    }
  });

  it('applies rotation on Z for rotated polygon ceilings', () => {
    const rooms = [{
      id: 'r1', label: 'Bed', type: 'bedroom', roomType: 'bedroom',
      polygon: [[0, 0], [14, 0], [14, 10], [0, 10]],
      x: 0, y: 0, w: 14, h: 10, rotation: Math.PI / 6,
    }];
    const { groups, dispose } = buildModel(makeLayout(rooms));
    try {
      const ceiling = groups.ceilings.children.find(c => c.name === 'Ceiling_r1');
      expect(ceiling).toBeDefined();
      expect(ceiling.rotation.z).toBeCloseTo(Math.PI / 6, 4);
    } finally {
      dispose();
    }
  });

  it('excludes balcony from ceilings', () => {
    const rooms = [{
      id: 'b1', label: 'Balcony', type: 'balcony', roomType: 'balcony',
      polygon: [[0, 0], [8, 0], [8, 4], [0, 4]],
      x: 0, y: 0, w: 8, h: 4,
    }];
    const { groups, dispose } = buildModel(makeLayout(rooms));
    try {
      const ceiling = groups.ceilings.children.find(c => c.name === 'Ceiling_b1');
      expect(ceiling).toBeUndefined();
    } finally {
      dispose();
    }
  });
});

describe('buildModel — diagonal walls', () => {
  it('creates a rotated mesh for diagonal walls', () => {
    const diagonalWall = {
      id: 'w1', x1: 0, y1: 0, x2: 10, y2: 10,
      thickness: 0.375, kind: 'exterior',
    };
    const rooms = [{
      id: 'r1', label: 'Room', type: 'living', roomType: 'living',
      polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
      x: 0, y: 0, w: 10, h: 10,
    }];
    const { groups, dispose } = buildModel(makeLayout(rooms, { walls: [diagonalWall] }));
    try {
      const walls = groups.walls.children;
      const diagWall = walls.find(c => c.name && c.name.startsWith('Wall_D'));
      expect(diagWall).toBeDefined();
      // Should be rotated by -atan2(10, 10) = -PI/4.
      expect(diagWall.rotation.y).toBeCloseTo(-Math.PI / 4, 4);
    } finally {
      dispose();
    }
  });

  it('creates horizontal walls without rotation', () => {
    const hWall = {
      id: 'w1', x1: 0, y1: 0, x2: 20, y2: 0,
      thickness: 0.375, kind: 'exterior',
    };
    const rooms = [{
      id: 'r1', label: 'Room', type: 'living', roomType: 'living',
      x: 0, y: 0, w: 20, h: 10,
    }];
    const { groups, dispose } = buildModel(makeLayout(rooms, { walls: [hWall] }));
    try {
      const walls = groups.walls.children;
      const hWallMesh = walls.find(c => c.name && c.name.startsWith('Wall_H'));
      expect(hWallMesh).toBeDefined();
      expect(hWallMesh.rotation.y).toBe(0);
    } finally {
      dispose();
    }
  });
});

describe('buildModel — mixed polygon and rectangular rooms', () => {
  it('renders both polygon and rectangular rooms together', () => {
    const rooms = [
      {
        id: 'r1', label: 'Living', type: 'living', roomType: 'living',
        polygon: [[0, 0], [20, 0], [20, 15], [0, 15]],
        x: 0, y: 0, w: 20, h: 15,
      },
      {
        id: 'r2', label: 'Bed', type: 'bedroom', roomType: 'bedroom',
        x: 20, y: 0, w: 10, h: 10,
      },
    ];
    const { groups, dispose } = buildModel(makeLayout(rooms));
    try {
      const floors = groups.floors.children;
      expect(floors.length).toBe(2);
      const f1 = floors.find(c => c.name === 'Floor_r1');
      const f2 = floors.find(c => c.name === 'Floor_r2');
      expect(f1).toBeDefined();
      expect(f2).toBeDefined();
      // Polygon room at centroid.
      expect(f1.position.x).toBeCloseTo(10, 1);
      expect(f1.position.z).toBeCloseTo(7.5, 1);
      // Rectangular room at center.
      expect(f2.position.x).toBeCloseTo(25, 1);
      expect(f2.position.z).toBeCloseTo(5, 1);
    } finally {
      dispose();
    }
  });
});
