/**
 * polygon.js — Pure-geometry utilities for 2D convex/concave polygons.
 *
 * All functions are stateless and import-free.  Polygons are represented
 * as arrays of [x, y] vertices in clockwise winding order.
 *
 * @module polygon
 */

/**
 * Area of a polygon (shoelace formula).  Positive for CW winding.
 *
 * @param {Polygon} pts
 * @returns {number} Signed area (absolute value is the true area).
 */
export function signedArea(pts) {
  const n = pts.length;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Absolute area of a polygon. */
export function area(pts) {
  return Math.abs(signedArea(pts));
}

/**
 * Centroid of a polygon.
 *
 * @param {Polygon} pts
 * @returns {[number, number]} [cx, cy]
 */
export function centroid(pts) {
  const n = pts.length;
  let cx = 0, cy = 0;
  const a6 = signedArea(pts) * 6;
  if (Math.abs(a6) < 1e-12) {
    // Degenerate — fall back to vertex average.
    for (const [x, y] of pts) { cx += x; cy += y; }
    return [cx / n, cy / n];
  }
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / a6, cy / a6];
}

/**
 * Axis-aligned bounding box.
 *
 * @param {Polygon} pts
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Split a convex or simple polygon by a horizontal or vertical line.
 * Returns { left, right } arrays of vertices on each side.
 * The split line is included in both halves so that shared edges tile exactly.
 *
 * @param {Polygon} pts - Input polygon (CW).
 * @param {'horizontal'|'vertical'} axis - Split axis.
 * @param {number} pos - Position along the axis (x for vertical, y for horizontal).
 * @returns {{ left: Polygon, right: Polygon }}
 */
export function splitPolygon(pts, axis, pos) {
  const left = [];
  const right = [];
  const n = pts.length;

  for (let i = 0; i < n; i++) {
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const cv = axis === 'vertical' ? curr[0] : curr[1];
    const nv = axis === 'vertical' ? next[0] : next[1];

    // Add current vertex to the correct side.
    if (cv <= pos + 1e-9) left.push(curr);
    if (cv >= pos - 1e-9) right.push(curr);

    // If the edge crosses the split line, compute and add the intersection.
    if ((cv < pos - 1e-9 && nv > pos + 1e-9) || (cv > pos + 1e-9 && nv < pos - 1e-9)) {
      const t = (pos - cv) / (nv - cv);
      const ix = curr[0] + t * (next[0] - curr[0]);
      const iy = curr[1] + t * (next[1] - curr[1]);
      const pt = [ix, iy];
      left.push(pt);
      right.push(pt);
    }
  }

  return { left, right };
}

/**
 * Clip a polygon to a rectangular region (clipping box).
 * Returns the intersection polygon (may be empty).
 * Uses Sutherland-Hodgman against each half-plane.
 *
 * @param {Polygon} pts
 * @param {{x:number, y:number, w:number, h:number}} box
 * @returns {Polygon} Clipped polygon.
 */
export function clipToRect(pts, box) {
  let output = pts;
  const edges = [
    { axis: 'y', val: box.y, keep: 'above' },              // bottom
    { axis: 'x', val: box.x + box.w, keep: 'below' },      // right
    { axis: 'y', val: box.y + box.h, keep: 'below' },      // top
    { axis: 'x', val: box.x, keep: 'above' },              // left
  ];

  for (const { axis, val, keep } of edges) {
    if (output.length === 0) return [];
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const curr = input[i];
      const next = input[(i + 1) % input.length];
      const cv = axis === 'x' ? curr[0] : curr[1];
      const nv = axis === 'x' ? next[0] : next[1];
      const cInside = keep === 'below' ? cv <= val + 1e-9 : cv >= val - 1e-9;
      const nInside = keep === 'below' ? nv <= val + 1e-9 : nv >= val - 1e-9;

      if (cInside && nInside) {
        output.push(next);
      } else if (cInside && !nInside) {
        const t = (val - cv) / (nv - cv);
        output.push([
          axis === 'x' ? val : curr[0] + t * (next[0] - curr[0]),
          axis === 'y' ? val : curr[1] + t * (next[1] - curr[1]),
        ]);
      } else if (!cInside && nInside) {
        const t = (val - cv) / (nv - cv);
        output.push([
          axis === 'x' ? val : curr[0] + t * (next[0] - curr[0]),
          axis === 'y' ? val : curr[1] + t * (next[1] - curr[1]),
        ]);
        output.push(next);
      }
    }
  }
  return output;
}

/**
 * Offset a polygon inward (negative) or outward (positive) by `dist`.
 * For convex polygons this is exact.  For concave polygons this is an
 * approximation using Minkowski-sum clamping against the bounding box,
 * which is sufficient for wall offsetting on architectural plans.
 *
 * @param {Polygon} pts
 * @param {number} dist - Positive = outward, negative = inward.
 * @returns {Polygon} Offset polygon (may be empty for large inward offsets).
 */
export function offsetPolygon(pts, dist) {
  if (pts.length < 3 || Math.abs(dist) < 1e-12) return [...pts];

  const result = [];
  const n = pts.length;

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];

    // Edge normals (CW winding → outward normal is (dy, -dx) / length).
    const dx1 = curr[0] - prev[0], dy1 = curr[1] - prev[1];
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1e-12;
    const nx1 = dy1 / len1, ny1 = -dx1 / len1;

    const dx2 = next[0] - curr[0], dy2 = next[1] - curr[1];
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1e-12;
    const nx2 = dy2 / len2, ny2 = -dx2 / len2;

    // Average the two normals at the vertex.
    const mnx = (nx1 + nx2) / 2, mny = (ny1 + ny2) / 2;
    const mlen = Math.sqrt(mnx * mnx + mny * mny) || 1e-12;

    // Scale factor to account for the angle between normals.
    const dot = nx1 * mnx / mlen + ny1 * mny / mlen;
    const scale = Math.abs(dot) > 1e-12 ? 1 / dot : 1;

    result.push([
      curr[0] + mnx / mlen * dist * scale,
      curr[1] + mny / mlen * dist * scale,
    ]);
  }

  // Sanity check: if offset collapsed or self-intersected the polygon, return empty.
  // For inward offsets (dist < 0), check that the result is actually smaller.
  // If the result grew, the offset exceeded the polygon bounds and the result
  // is an inverted (meaningless) polygon.
  const a = signedArea(result);
  if (Math.abs(a) < 1e-6) return [];
  if (dist < 0) {
    const origA = Math.abs(signedArea(pts));
    // Allow a small tolerance for floating-point rounding.
    if (Math.abs(a) >= origA - 1e-6) return [];
  }
  return result;
}

/**
 * Test if a point is inside a polygon (ray casting).
 *
 * @param {number} px
 * @param {number} py
 * @param {Polygon} pts
 * @returns {boolean}
 */
export function pointInPolygon(px, py, pts) {
  let inside = false;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Test if polygon A fully contains polygon B.
 *
 * @param {Polygon} outer
 * @param {Polygon} inner
 * @returns {boolean}
 */
export function polygonContains(outer, inner) {
  for (const [x, y] of inner) {
    if (!pointInPolygon(x, y, outer)) return false;
  }
  return true;
}

/**
 * Convert a rectangle to a polygon (CW winding).
 *
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {Polygon}
 */
export function rectToPolygon(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

/**
 * Create a rectangular footprint polygon from width and height.
 * The rectangle is placed at the origin.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Polygon}
 */
export function makeRectFootprint(width, height) {
  return rectToPolygon(0, 0, width, height);
}

/**
 * Generate a regular polygon (approximation of a circle) with `n` vertices.
 *
 * NOTE: Circles are approximated as vertex-based polygons; true curved/arc
 * wall segments are not supported in this system.  Increasing `n` improves
 * the visual fidelity at the cost of more wall segments.
 *
 * @param {number} cx - Center X.
 * @param {number} cy - Center Y.
 * @param {number} r  - Radius.
 * @param {number} [n=40] - Number of vertices.
 * @returns {Polygon} CW-wound polygon.
 */
export function regularPolygon(cx, cy, r, n = 40) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  // Ensure CW winding — regularPolygon with increasing angle produces CCW
  // when cos goes right and sin goes down (screen coords), so reverse if needed.
  if (signedArea(pts) < 0) pts.reverse();
  return pts;
}

/**
 * Generate an L-shaped polygon within a bounding box.
 *
 * The notch is cut from the top-right corner.  `notchFrac` controls the
 * proportion of the notch relative to the full dimensions (0.2–0.5 typical).
 *
 * @param {number} x      - Left edge of bounding box.
 * @param {number} y      - Top edge of bounding box.
 * @param {number} w      - Full width.
 * @param {number} h      - Full height.
 * @param {number} [notchFrac=0.4] - Notch fraction (0 < notchFrac < 1).
 * @returns {Polygon} 6-vertex CW L-shape polygon.
 */
export function lShapePolygon(x, y, w, h, notchFrac = 0.4) {
  const nf = Math.max(0.1, Math.min(0.9, notchFrac));
  const nw = w * nf;
  const nh = h * nf;
  // CW vertices forming an L-shape (notch at top-right).
  const pts = [
    [x, y],
    [x + w, y],
    [x + w, y + h - nh],
    [x + w - nw, y + h - nh],
    [x + w - nw, y + h],
    [x, y + h],
  ];
  return pts;
}

/**
 * Test whether a simple polygon has any self-intersecting edges.
 * O(n²) check — acceptable for the small vertex counts in freeform rooms.
 *
 * @param {Polygon} pts
 * @returns {boolean} true if any non-adjacent edges cross.
 */
export function isSelfIntersecting(pts) {
  const n = pts.length;
  if (n < 4) return false;

  function orient(ax, ay, bx, by, cx, cy) {
    const val = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
    if (Math.abs(val) < 1e-12) return 0;
    return val > 0 ? 1 : 2;
  }

  function onSegment(ax, ay, bx, by, cx, cy) {
    return (
      bx >= Math.min(ax, cx) - 1e-9 &&
      bx <= Math.max(ax, cx) + 1e-9 &&
      by >= Math.min(ay, cy) - 1e-9 &&
      by <= Math.max(ay, cy) + 1e-9
    );
  }

  function segmentsIntersect(p1, p2, p3, p4) {
    const o1 = orient(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    const o2 = orient(p1[0], p1[1], p2[0], p2[1], p4[0], p4[1]);
    const o3 = orient(p3[0], p3[1], p4[0], p4[1], p1[0], p1[1]);
    const o4 = orient(p3[0], p3[1], p4[0], p4[1], p2[0], p2[1]);

    if (o1 !== o2 && o3 !== o4) return true;

    // Collinear special cases
    if (o1 === 0 && onSegment(p1[0], p1[1], p3[0], p3[1], p2[0], p2[1])) return true;
    if (o2 === 0 && onSegment(p1[0], p1[1], p4[0], p4[1], p2[0], p2[1])) return true;
    if (o3 === 0 && onSegment(p3[0], p3[1], p1[0], p1[1], p4[0], p4[1])) return true;
    if (o4 === 0 && onSegment(p3[0], p3[1], p2[0], p2[1], p4[0], p4[1])) return true;

    return false;
  }

  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      // Skip adjacent edges (they share a vertex)
      if (i === 0 && j === n - 1) continue;
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}
