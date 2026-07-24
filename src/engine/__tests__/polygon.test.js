import { describe, it, expect } from 'vitest';
import {
  signedArea, area, centroid, bbox, splitPolygon,
  clipToRect, offsetPolygon, pointInPolygon,
  polygonContains, rectToPolygon, makeRectFootprint,
  regularPolygon, lShapePolygon, isSelfIntersecting,
} from '../polygon.js';

const EPS = 1e-6;

describe('rectToPolygon', () => {
  it('creates a CW rectangle from origin', () => {
    const poly = rectToPolygon(0, 0, 10, 8);
    expect(poly).toEqual([[0, 0], [10, 0], [10, 8], [0, 8]]);
  });

  it('creates a CW rectangle offset from origin', () => {
    const poly = rectToPolygon(5, 3, 4, 6);
    expect(poly).toEqual([[5, 3], [9, 3], [9, 9], [5, 9]]);
  });
});

describe('signedArea', () => {
  it('returns positive for CW winding (unit square)', () => {
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(signedArea(sq)).toBeCloseTo(1.0, 6);
  });

  it('returns negative for CCW winding', () => {
    const sq = [[0, 0], [0, 1], [1, 1], [1, 0]];
    expect(signedArea(sq)).toBeCloseTo(-1.0, 6);
  });

  it('handles a 10x8 rectangle', () => {
    const r = rectToPolygon(0, 0, 10, 8);
    expect(signedArea(r)).toBeCloseTo(80, 6);
  });
});

describe('area', () => {
  it('always returns positive', () => {
    const cw = [[0, 0], [3, 0], [3, 4], [0, 4]];
    const ccw = [[0, 0], [0, 4], [3, 4], [3, 0]];
    expect(area(cw)).toBeCloseTo(12, 6);
    expect(area(ccw)).toBeCloseTo(12, 6);
  });

  it('computes L-shape area correctly', () => {
    // L-shape: 3x4 rectangle minus a 1x1 corner
    // Actually a 6-vertex polygon
    const l = [[0, 0], [3, 0], [3, 2], [2, 2], [2, 4], [0, 4]];
    // Area = (3*2) + (2*2) = 6 + 4 = 10
    expect(area(l)).toBeCloseTo(10, 6);
  });

  it('handles a triangle', () => {
    const tri = [[0, 0], [4, 0], [2, 3]];
    expect(area(tri)).toBeCloseTo(6, 6);
  });
});

describe('centroid', () => {
  it('returns center of a rectangle', () => {
    const sq = rectToPolygon(0, 0, 10, 8);
    const [cx, cy] = centroid(sq);
    expect(cx).toBeCloseTo(5, 6);
    expect(cy).toBeCloseTo(4, 6);
  });

  it('returns center of a unit square', () => {
    const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const [cx, cy] = centroid(sq);
    expect(cx).toBeCloseTo(0.5, 6);
    expect(cy).toBeCloseTo(0.5, 6);
  });

  it('returns vertex average for a degenerate polygon', () => {
    const degenerate = [[1, 2], [3, 4], [5, 6]]; // collinear
    const [cx, cy] = centroid(degenerate);
    expect(cx).toBeCloseTo(3, 6);
    expect(cy).toBeCloseTo(4, 6);
  });
});

describe('bbox', () => {
  it('returns correct bbox for a rectangle', () => {
    const poly = rectToPolygon(5, 3, 10, 8);
    const b = bbox(poly);
    expect(b).toEqual({ x: 5, y: 3, w: 10, h: 8 });
  });

  it('returns correct bbox for an L-shape', () => {
    const l = [[0, 0], [3, 0], [3, 2], [2, 2], [2, 4], [0, 4]];
    const b = bbox(l);
    expect(b).toEqual({ x: 0, y: 0, w: 3, h: 4 });
  });
});

describe('pointInPolygon', () => {
  const sq = rectToPolygon(0, 0, 10, 10);

  it('detects point inside', () => {
    expect(pointInPolygon(5, 5, sq)).toBe(true);
  });

  it('detects point outside', () => {
    expect(pointInPolygon(15, 5, sq)).toBe(false);
    expect(pointInPolygon(5, -1, sq)).toBe(false);
  });

  it('handles points on edges (ambiguous, but should not crash)', () => {
    // Edge behavior varies; just ensure no crash.
    expect(typeof pointInPolygon(0, 0, sq)).toBe('boolean');
  });
});

describe('polygonContains', () => {
  it('detects containment', () => {
    const outer = rectToPolygon(0, 0, 10, 10);
    const inner = rectToPolygon(2, 2, 3, 3);
    expect(polygonContains(outer, inner)).toBe(true);
  });

  it('detects non-containment', () => {
    const outer = rectToPolygon(0, 0, 10, 10);
    const notInner = rectToPolygon(8, 8, 5, 5);
    expect(polygonContains(outer, notInner)).toBe(false);
  });
});

describe('splitPolygon', () => {
  const rect = rectToPolygon(0, 0, 10, 8);

  it('splits a rectangle vertically at midpoint', () => {
    const { left, right } = splitPolygon(rect, 'vertical', 5);
    // Left half: x in [0, 5]
    const lb = bbox(left);
    expect(lb.x).toBeCloseTo(0, 4);
    expect(lb.w).toBeCloseTo(5, 4);
    expect(lb.h).toBeCloseTo(8, 4);
    // Right half: x in [5, 10]
    const rb = bbox(right);
    expect(rb.x).toBeCloseTo(5, 4);
    expect(rb.w).toBeCloseTo(5, 4);
  });

  it('splits a rectangle horizontally at midpoint', () => {
    const { top, bottom } = (() => {
      const { left, right } = splitPolygon(rect, 'horizontal', 4);
      // 'left' is below the line (y <= 4), 'right' is above (y >= 4)
      return { bottom: left, top: right };
    })();
    const tb = bbox(top);
    expect(tb.y).toBeCloseTo(4, 4);
    expect(tb.h).toBeCloseTo(4, 4);
    const bb = bbox(bottom);
    expect(bb.y).toBeCloseTo(0, 4);
    expect(bb.h).toBeCloseTo(4, 4);
  });

  it('both halves together tile the original (area preserved)', () => {
    const { left, right } = splitPolygon(rect, 'vertical', 3);
    const totalArea = area(left) + area(right);
    expect(totalArea).toBeCloseTo(area(rect), 4);
  });
});

describe('clipToRect', () => {
  it('clips a polygon to a smaller rect', () => {
    const big = rectToPolygon(0, 0, 20, 20);
    const clip = clipToRect(big, { x: 5, y: 5, w: 10, h: 10 });
    const b = bbox(clip);
    expect(b.x).toBeCloseTo(5, 4);
    expect(b.y).toBeCloseTo(5, 4);
    expect(b.w).toBeCloseTo(10, 4);
    expect(b.h).toBeCloseTo(10, 4);
  });

  it('returns empty for non-overlapping polygons', () => {
    const poly = rectToPolygon(0, 0, 5, 5);
    const clipped = clipToRect(poly, { x: 10, y: 10, w: 5, h: 5 });
    expect(clipped.length).toBe(0);
  });

  it('returns the polygon unchanged if fully inside', () => {
    const poly = rectToPolygon(2, 2, 3, 3);
    const clipped = clipToRect(poly, { x: 0, y: 0, w: 10, h: 10 });
    expect(clipped.length).toBe(4);
    expect(area(clipped)).toBeCloseTo(area(poly), 4);
  });
});

describe('offsetPolygon', () => {
  it('offsets a rectangle outward', () => {
    const sq = rectToPolygon(0, 0, 10, 10);
    const out = offsetPolygon(sq, 1);
    const b = bbox(out);
    expect(b.x).toBeCloseTo(-1, 3);
    expect(b.y).toBeCloseTo(-1, 3);
    expect(b.w).toBeCloseTo(12, 3);
    expect(b.h).toBeCloseTo(12, 3);
  });

  it('offsets a rectangle inward', () => {
    const sq = rectToPolygon(0, 0, 10, 10);
    const inPoly = offsetPolygon(sq, -1);
    const b = bbox(inPoly);
    expect(b.x).toBeCloseTo(1, 3);
    expect(b.y).toBeCloseTo(1, 3);
    expect(b.w).toBeCloseTo(8, 3);
    expect(b.h).toBeCloseTo(8, 3);
  });

  it('returns empty when inward offset collapses the polygon', () => {
    const small = rectToPolygon(0, 0, 2, 2);
    const result = offsetPolygon(small, -5);
    expect(result.length).toBe(0);
  });

  it('returns same polygon for zero offset', () => {
    const sq = rectToPolygon(0, 0, 10, 10);
    const result = offsetPolygon(sq, 0);
    expect(result).toEqual(sq);
  });
});

describe('makeRectFootprint', () => {
  it('creates a footprint polygon at the origin', () => {
    const fp = makeRectFootprint(35, 25);
    expect(fp).toEqual([[0, 0], [35, 0], [35, 25], [0, 25]]);
    expect(area(fp)).toBeCloseTo(875, 6);
  });
});

describe('regularPolygon', () => {
  it('creates a polygon with the correct vertex count', () => {
    const poly = regularPolygon(10, 10, 5, 40);
    expect(poly.length).toBe(40);
  });

  it('has centroid at the specified center', () => {
    const poly = regularPolygon(10, 10, 5, 40);
    const [cx, cy] = centroid(poly);
    expect(cx).toBeCloseTo(10, 4);
    expect(cy).toBeCloseTo(10, 4);
  });

  it('has area approximately equal to πr²', () => {
    const r = 5;
    const poly = regularPolygon(0, 0, r, 100);
    const expected = Math.PI * r * r;
    expect(area(poly)).toBeCloseTo(expected, 0);
  });

  it('all vertices are approximately equidistant from center', () => {
    const cx = 5, cy = 3, r = 7;
    const poly = regularPolygon(cx, cy, r, 40);
    for (const [px, py] of poly) {
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      expect(dist).toBeCloseTo(r, 6);
    }
  });

  it('produces a valid (non-self-intersecting) polygon', () => {
    const poly = regularPolygon(0, 0, 10, 40);
    expect(isSelfIntersecting(poly)).toBe(false);
  });
});

describe('lShapePolygon', () => {
  it('creates a 6-vertex polygon', () => {
    const poly = lShapePolygon(0, 0, 30, 40);
    expect(poly.length).toBe(6);
  });

  it('has the correct bounding box', () => {
    const poly = lShapePolygon(0, 0, 30, 40);
    const b = bbox(poly);
    expect(b.x).toBeCloseTo(0, 4);
    expect(b.y).toBeCloseTo(0, 4);
    expect(b.w).toBeCloseTo(30, 4);
    expect(b.h).toBeCloseTo(40, 4);
  });

  it('has the correct area (full rect minus notch)', () => {
    const w = 30, h = 40, nf = 0.4;
    const poly = lShapePolygon(0, 0, w, h, nf);
    const expectedArea = w * h - (w * nf) * (h * nf);
    expect(area(poly)).toBeCloseTo(expectedArea, 4);
  });

  it('is a valid non-self-intersecting polygon', () => {
    const poly = lShapePolygon(0, 0, 30, 40);
    expect(isSelfIntersecting(poly)).toBe(false);
  });

  it('clamps notchFrac to valid range', () => {
    const poly1 = lShapePolygon(0, 0, 10, 10, 0.01);
    const poly2 = lShapePolygon(0, 0, 10, 10, 0.99);
    expect(area(poly1)).toBeGreaterThan(0);
    expect(area(poly2)).toBeGreaterThan(0);
  });
});

describe('isSelfIntersecting', () => {
  it('returns false for a simple rectangle', () => {
    const sq = rectToPolygon(0, 0, 10, 10);
    expect(isSelfIntersecting(sq)).toBe(false);
  });

  it('returns false for a simple triangle', () => {
    const tri = [[0, 0], [5, 0], [2, 4]];
    expect(isSelfIntersecting(tri)).toBe(false);
  });

  it('returns false for a simple L-shape', () => {
    const l = lShapePolygon(0, 0, 10, 10);
    expect(isSelfIntersecting(l)).toBe(false);
  });

  it('returns true for a bow-tie (self-intersecting)', () => {
    const bowtie = [[0, 0], [4, 4], [4, 0], [0, 4]];
    expect(isSelfIntersecting(bowtie)).toBe(true);
  });

  it('returns false for a polygon with 3 vertices', () => {
    const tri = [[0, 0], [5, 0], [2.5, 3]];
    expect(isSelfIntersecting(tri)).toBe(false);
  });
});
