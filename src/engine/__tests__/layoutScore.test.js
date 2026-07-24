import { describe, it, expect } from 'vitest';
import {
  BASE_WEIGHTS, resolveWeights, scoreLayout, scoreAreaFidelity,
  scoreProportion, scorePrivacy, scoreEfficiency, scoreRoomFlow,
  findDimensionViolations, explainScore, findWeaknesses,
} from '../layoutScore.js';
import { scoreAdjacency } from '../adjacency.js';
import { createRoomCell } from '../roomCell.js';
import { generateWalls } from '../geometry.js';

/** Build a RoomCell from a rectangle, with a target area of its own size. */
function cell(id, roomType, x, y, w, h, targetArea) {
  return createRoomCell({
    id, roomType, label: id, x, y, w, h,
    targetArea: targetArea ?? w * h,
  });
}

/** A tidy 30×20 two-bed plan used across the assertions. */
function sampleLayout() {
  const rooms = [
    cell('living_1', 'living', 0, 0, 18, 12),
    cell('kitchen_1', 'kitchen', 18, 0, 12, 12),
    cell('bedroom_1', 'bedroom', 0, 12, 15, 8),
    cell('bedroom_2', 'bedroom', 15, 12, 9, 8),
    cell('bathroom_1', 'bathroom', 24, 12, 6, 8),
  ];
  const boundary = { width: 30, height: 20 };
  const { walls, doors, windows } = generateWalls(
    rooms.map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, type: r.roomType })),
    boundary,
  );
  return { boundary, rooms, walls, doors, windows, furnishings: [] };
}

describe('resolveWeights', () => {
  it('returns the base weights when no preferences are set', () => {
    const w = resolveWeights({});
    Object.keys(BASE_WEIGHTS).forEach(key => {
      expect(w[key]).toBeCloseTo(BASE_WEIGHTS[key], 1);
    });
  });

  it('always normalises to 100', () => {
    const cases = [{}, { vastu: true }, { daylight: true, privacy: true }, { openPlan: true, luxury: true }];
    cases.forEach(prefs => {
      const sum = Object.values(resolveWeights(prefs)).reduce((s, v) => s + v, 0);
      expect(sum).toBeCloseTo(100, 0);
    });
  });

  it('boosts the requested criterion and de-emphasises the rest', () => {
    const base = resolveWeights({});
    const vastu = resolveWeights({ vastu: true });
    expect(vastu.vastu).toBeGreaterThan(base.vastu);
    expect(vastu.daylight).toBeLessThan(base.daylight);
  });
});

describe('scoreAreaFidelity', () => {
  it('scores a perfectly proportioned schedule at 100', () => {
    const rooms = [cell('a', 'living', 0, 0, 10, 10), cell('b', 'bedroom', 10, 0, 10, 10)];
    expect(scoreAreaFidelity(rooms).score).toBe(100);
  });

  it('penalises a room that got far more space than requested', () => {
    const rooms = [
      cell('a', 'living', 0, 0, 10, 10, 100),
      cell('b', 'bedroom', 10, 0, 30, 10, 100), // 3x its target
    ];
    expect(scoreAreaFidelity(rooms).score).toBeLessThan(60);
  });

  it('compares shares, so a uniform shortfall is not punished', () => {
    // Every room is 20% smaller than target — the distribution is still right.
    const rooms = [
      cell('a', 'living', 0, 0, 8, 10, 100),
      cell('b', 'bedroom', 8, 0, 8, 10, 100),
    ];
    expect(scoreAreaFidelity(rooms).score).toBe(100);
  });
});

describe('scoreProportion', () => {
  it('rewards square-ish rooms', () => {
    const rooms = [cell('a', 'bedroom', 0, 0, 13, 10)];
    expect(scoreProportion(rooms).score).toBeGreaterThan(85);
  });

  it('flags slivers as offenders', () => {
    const rooms = [cell('a', 'bedroom', 0, 0, 40, 3)];
    const result = scoreProportion(rooms);
    expect(result.score).toBeLessThan(40);
    expect(result.offenders).toContain('a');
  });

  it('penalises a room below its minimum usable dimension', () => {
    const wide = scoreProportion([cell('a', 'living', 0, 0, 12, 12)]).score;
    const narrow = scoreProportion([cell('a', 'living', 0, 0, 24, 6)]).score;
    expect(narrow).toBeLessThan(wide);
  });

  it('does not let a few unusable rooms hide behind many good ones', () => {
    // Eleven workable rooms plus three 60x4 slivers. A plain average would
    // still land in the 70s; the plan must not read as acceptable.
    const good = Array.from({ length: 11 }, (_, i) => cell(`g${i}`, 'bedroom', 0, i * 12, 13, 10));
    const slivers = [
      cell('living_1', 'living', 0, 200, 60, 4),
      cell('kitchen_1', 'kitchen', 0, 210, 60, 4),
      cell('dining_1', 'dining', 0, 220, 60, 4),
    ];
    const mixed = scoreProportion([...good, ...slivers]);
    const clean = scoreProportion(good);

    expect(mixed.offenders).toHaveLength(3);
    expect(mixed.score).toBeLessThan(55);
    expect(clean.score - mixed.score).toBeGreaterThan(35);
  });
});

describe('scoreRoomFlow', () => {
  it('awards full marks when every preferred pairing is met', () => {
    const rooms = [
      cell('kitchen_1', 'kitchen', 0, 0, 12, 12),
      cell('dining_1', 'dining', 12, 0, 12, 12),
    ];
    const result = scoreRoomFlow(rooms);
    expect(result.score).toBe(100);
    expect(result.unmet).toHaveLength(0);
  });

  it('reports the pairings it could not connect', () => {
    const rooms = [
      cell('kitchen_1', 'kitchen', 0, 0, 12, 12),
      cell('dining_1', 'dining', 40, 40, 12, 12), // nowhere near the kitchen
    ];
    const result = scoreRoomFlow(rooms);
    expect(result.score).toBe(0);
    expect(result.unmet).toContain('dining–kitchen');
  });

  it('does not punish duplicate rooms for obligations they cannot meet', () => {
    // Four bedrooms and three bathrooms create 12 instance pairs but only one
    // type-level relationship. Per-instance scoring caps such a plan far below
    // 100 no matter how good it is; per-type scoring does not.
    const rooms = [
      cell('bedroom_1', 'bedroom', 0, 0, 12, 12),
      cell('bedroom_2', 'bedroom', 0, 12, 12, 12),
      cell('bedroom_3', 'bedroom', 0, 24, 12, 12),
      cell('bedroom_4', 'bedroom', 0, 36, 12, 12),
      cell('bathroom_1', 'bathroom', 12, 0, 8, 12),
      cell('bathroom_2', 'bathroom', 12, 12, 8, 12),
      cell('bathroom_3', 'bathroom', 12, 24, 8, 12),
    ];
    expect(scoreRoomFlow(rooms).score).toBe(100);
    expect(scoreAdjacency(rooms)).toBeLessThan(100);
  });

  it('handles a plan with no defined relationships', () => {
    expect(scoreRoomFlow([cell('a', 'garden', 0, 0, 10, 10)]).score).toBe(100);
  });
});

describe('scorePrivacy', () => {
  it('is perfect when no conflicting pair exists', () => {
    const rooms = [cell('a', 'bedroom', 0, 0, 10, 10), cell('b', 'bathroom', 10, 0, 10, 10)];
    expect(scorePrivacy(rooms).score).toBe(100);
  });

  it('penalises a bathroom opening onto the living room', () => {
    const rooms = [
      cell('living_1', 'living', 0, 0, 12, 12),
      cell('bathroom_1', 'bathroom', 12, 0, 6, 12),
    ];
    expect(scorePrivacy(rooms).score).toBeLessThan(50);
  });

  it('is unaffected when the conflicting rooms do not touch', () => {
    const rooms = [
      cell('living_1', 'living', 0, 0, 12, 12),
      cell('bathroom_1', 'bathroom', 40, 40, 6, 6),
    ];
    expect(scorePrivacy(rooms).score).toBe(100);
  });
});

describe('scoreEfficiency', () => {
  it('gives full marks inside the 82-95% band', () => {
    const layout = { boundary: { width: 10, height: 10 }, rooms: [cell('a', 'living', 0, 0, 9, 10)] };
    expect(scoreEfficiency(layout).score).toBe(100);
  });

  it('penalises a plan that wastes half the envelope', () => {
    const layout = { boundary: { width: 10, height: 10 }, rooms: [cell('a', 'living', 0, 0, 5, 10)] };
    expect(scoreEfficiency(layout).score).toBeLessThan(15);
  });

  it('mildly penalises a plan with no circulation slack', () => {
    const layout = { boundary: { width: 10, height: 10 }, rooms: [cell('a', 'living', 0, 0, 10, 10)] };
    const s = scoreEfficiency(layout).score;
    expect(s).toBeLessThan(100);
    expect(s).toBeGreaterThanOrEqual(60);
  });
});

describe('scoreLayout', () => {
  it('produces a total in range with every metric present', () => {
    const result = scoreLayout(sampleLayout());
    expect(result.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThanOrEqual(100);
    Object.keys(BASE_WEIGHTS).forEach(key => {
      expect(result.breakdown[key]).toBeDefined();
      expect(result.breakdown[key].score).toBeGreaterThanOrEqual(0);
      expect(result.breakdown[key].score).toBeLessThanOrEqual(100);
    });
  });

  it('handles an empty layout without throwing', () => {
    expect(scoreLayout({ boundary: { width: 10, height: 10 }, rooms: [] }).total).toBe(0);
    expect(scoreLayout(null).total).toBe(0);
  });

  it('discounts a plan with unreachable rooms', () => {
    const connected = sampleLayout();
    const isolated = {
      boundary: { width: 60, height: 60 },
      rooms: [
        cell('living_1', 'living', 0, 0, 12, 12),
        cell('bedroom_1', 'bedroom', 40, 40, 12, 12), // nowhere near anything
      ],
      windows: [], doors: [], walls: [],
    };
    const a = scoreLayout(connected);
    const b = scoreLayout(isolated);
    expect(a.reachable).toBe(true);
    expect(b.reachable).toBe(false);
    expect(b.total).toBeLessThan(a.total);
  });

  it('shifts the total when the weights change', () => {
    const layout = sampleLayout();
    const neutral = scoreLayout(layout);
    const vastuFirst = scoreLayout(layout, { preferences: { vastu: true } });
    expect(vastuFirst.weights.vastu).toBeGreaterThan(neutral.weights.vastu);
    expect(vastuFirst.total).not.toBe(neutral.total);
  });
});

describe('findDimensionViolations', () => {
  it('flags a bedroom too narrow to be a bedroom', () => {
    const violations = findDimensionViolations([cell('bedroom_4', 'bedroom', 0, 0, 5, 17.2)]);
    expect(violations).toHaveLength(1);
    expect(violations[0].shortSide).toBe(5);
    expect(violations[0].required).toBe(8);
  });

  it('accepts rooms at or just under the minimum', () => {
    expect(findDimensionViolations([cell('a', 'bedroom', 0, 0, 8, 12)])).toHaveLength(0);
    expect(findDimensionViolations([cell('a', 'bathroom', 0, 0, 5, 8)])).toHaveLength(0);
  });

  it('ignores types with no defined minimum', () => {
    expect(findDimensionViolations([cell('a', 'hallway', 0, 0, 2, 20)])).toHaveLength(0);
  });
});

describe('scoreLayout hard constraints', () => {
  it('heavily discounts a plan containing an unbuildable room', () => {
    const ok = sampleLayout();
    const broken = sampleLayout();
    // Replace one bedroom with a 5 ft wide strip in the same footprint.
    broken.rooms = broken.rooms.map(r =>
      r.id === 'bedroom_2' ? cell('bedroom_2', 'bedroom', 15, 12, 5, 8) : r,
    );

    const a = scoreLayout(ok);
    const b = scoreLayout(broken);
    expect(a.undersized).toHaveLength(0);
    expect(b.undersized).toHaveLength(1);
    expect(b.total).toBeLessThan(a.total * 0.8);
    expect(b.notes.join(' ')).toMatch(/below minimum width/);
  });

  it('compounds the discount across multiple violations', () => {
    const one = sampleLayout();
    one.rooms = [...one.rooms.slice(0, 4), cell('bathroom_1', 'bathroom', 24, 12, 2, 8)];

    const two = sampleLayout();
    two.rooms = [
      ...two.rooms.slice(0, 3),
      cell('bedroom_2', 'bedroom', 15, 12, 4, 8),
      cell('bathroom_1', 'bathroom', 24, 12, 2, 8),
    ];

    expect(scoreLayout(two).total).toBeLessThan(scoreLayout(one).total);
  });
});

describe('explainScore / findWeaknesses', () => {
  it('returns the requested number of strengths, best first', () => {
    const result = scoreLayout(sampleLayout());
    const strengths = explainScore(result, 3);
    expect(strengths).toHaveLength(3);
    expect(strengths[0].label).toBeTruthy();
    expect(strengths[0].score).toBeGreaterThanOrEqual(strengths[2].score - 100);
  });

  it('only reports weaknesses below the threshold', () => {
    const result = scoreLayout(sampleLayout());
    findWeaknesses(result, 60).forEach(w => expect(w.score).toBeLessThan(60));
  });

  it('degrades gracefully on a null result', () => {
    expect(explainScore(null)).toEqual([]);
    expect(findWeaknesses(null)).toEqual([]);
  });
});
