/**
 * energyAnalyzer.js — Natural light and ventilation analysis for floor plans.
 *
 * Scores each room based on window placement, exterior wall exposure,
 * and room proportions for natural lighting and cross-ventilation.
 */

import { WINDOWED_ROOMS } from './constants.js';

function edgesOverlap(x1, y1, x2, y2, bx1, by1, bx2, by2, tol) {
  // Project room edge endpoints onto boundary edge parameter range.
  const edx = bx2 - bx1, edy = by2 - by1;
  const elen2 = edx * edx + edy * edy;
  if (elen2 < 1e-10) return false;
  const t1 = ((x1 - bx1) * edx + (y1 - by1) * edy) / elen2;
  const t2 = ((x2 - bx1) * edx + (y2 - by1) * edy) / elen2;
  const tMin = Math.min(t1, t2), tMax = Math.max(t1, t2);
  const overlapStart = Math.max(tMin, 0), overlapEnd = Math.min(tMax, 1);
  if (overlapEnd - overlapStart < 1e-6) return false;
  const cx = (Math.max(tMin, 0) + Math.min(tMax, 1)) / 2;
  const px = bx1 + cx * edx, py = by1 + cx * edy;
  const ax = (x1 + x2) / 2, ay = (y1 + y2) / 2;
  return Math.hypot(ax - px, ay - py) < tol;
}

export function roomExteriorWalls(room, boundary) {
  const sides = [];
  const tol = 0.5;

  // Polygon-aware check, used only when the envelope is itself a polygon.
  // Rectangular envelopes (everything the subdivision engine produces) carry
  // width/height only — without this guard the loop below found nothing and
  // every room reported zero exterior walls.
  const bPoly = boundary.polygon;
  if (room.polygon && room.polygon.length >= 3 && bPoly && bPoly.length >= 3) {
    const poly = room.polygon;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      // Check if this room edge overlaps / is near any boundary edge.
      for (let j = 0; j < bPoly.length; j++) {
        const [bx1, by1] = bPoly[j];
        const [bx2, by2] = bPoly[(j + 1) % bPoly.length];
        if (edgesOverlap(x1, y1, x2, y2, bx1, by1, bx2, by2, tol)) {
          sides.push(`edge${i}`);
          break;
        }
      }
    }
    return sides;
  }

  // Bbox fallback for rectangular rooms.
  if (Math.abs(room.y) < tol) sides.push('bottom');
  if (Math.abs((room.y + room.h) - boundary.height) < tol) sides.push('top');
  if (Math.abs(room.x) < tol) sides.push('left');
  if (Math.abs((room.x + room.w) - boundary.width) < tol) sides.push('right');
  return sides;
}

function scoreNaturalLight(room, layout) {
  const rt = room.roomType || room.type;
  if (!WINDOWED_ROOMS.has(rt)) return { score: 100, note: 'Naturally lit room type' };

  const exteriorSides = roomExteriorWalls(room, layout.boundary);
  const windows = (layout.windows || []).filter(w => w.roomId === room.id);

  let score = 0;

  // Exterior wall exposure
  score += Math.min(40, exteriorSides.length * 20);

  // Window count
  score += Math.min(30, windows.length * 15);

  // Window width relative to wall length
  const totalWindowWidth = windows.reduce((s, w) => s + w.width, 0);
  const perimeter = 2 * (room.w + room.h);
  const windowRatio = totalWindowWidth / perimeter;
  score += Math.min(20, Math.round(windowRatio * 100));

  // Room depth (distance from window to far wall)
  const depth = Math.min(room.w, room.h);
  if (depth < 12) score += 10; // Good depth for light penetration
  else if (depth < 18) score += 5;

  return {
    score: Math.min(100, score),
    note: windows.length > 0
      ? `${windows.length} window(s) on ${exteriorSides.length} exterior wall(s)`
      : exteriorSides.length > 0 ? 'Has exterior wall but no window' : 'No exterior walls — needs artificial light',
  };
}

function scoreVentilation(room, layout) {
  const rt = room.roomType || room.type;
  const exteriorSides = roomExteriorWalls(room, layout.boundary);
  const windows = (layout.windows || []).filter(w => w.roomId === room.id);

  let score = 0;

  // Cross ventilation: windows on opposing walls
  const hasOpposing = exteriorSides.length >= 2;
  if (hasOpposing) score += 40;
  else if (exteriorSides.length === 1) score += 20;

  // Window count for air flow
  score += Math.min(30, windows.length * 15);

  // Room size vs window area
  const roomArea = room.w * room.h;
  const windowArea = windows.reduce((s, w) => s + w.width * 3, 0); // approximate window area
  const ratio = roomArea > 0 ? windowArea / roomArea : 0;
  if (ratio > 0.1) score += 20;
  else if (ratio > 0.05) score += 10;

  // Balcony/garden bonus
  if (rt === 'balcony' || rt === 'garden') score += 10;

  return {
    score: Math.min(100, score),
    note: hasOpposing
      ? 'Cross-ventilation possible (windows on opposing walls)'
      : exteriorSides.length > 1 ? 'Multiple exterior walls available' : 'Limited ventilation — single exterior wall',
  };
}

export function analyzeEnergy(layout) {
  if (!layout || !layout.rooms || layout.rooms.length === 0) return null;

  const roomAnalyses = layout.rooms.map(room => {
    const light = scoreNaturalLight(room, layout);
    const ventilation = scoreVentilation(room, layout);
    const overall = Math.round((light.score + ventilation.score) / 2);

    return {
      id: room.id,
      label: room.label,
      // RoomCells carry `roomType`; legacy/freeform rooms carry `type`.
      type: room.roomType || room.type,
      light,
      ventilation,
      overall,
    };
  });

  const avgLight = Math.round(roomAnalyses.reduce((s, r) => s + r.light.score, 0) / roomAnalyses.length);
  const avgVent = Math.round(roomAnalyses.reduce((s, r) => s + r.ventilation.score, 0) / roomAnalyses.length);
  const avgOverall = Math.round((avgLight + avgVent) / 2);

  // Find rooms that need attention
  const needsAttention = roomAnalyses.filter(r => r.overall < 50);

  return {
    rooms: roomAnalyses,
    averages: { light: avgLight, ventilation: avgVent, overall: avgOverall },
    needsAttention,
    tips: generateTips(roomAnalyses, layout),
  };
}

function generateTips(analyses, layout) {
  const tips = [];

  analyses.forEach(a => {
    if (a.light.score < 40 && WINDOWED_ROOMS.has(a.type)) {
      tips.push({
        room: a.label,
        type: 'light',
        text: `${a.label} needs more natural light — consider adding or widening windows`,
      });
    }
    if (a.ventilation.score < 30) {
      tips.push({
        room: a.label,
        type: 'ventilation',
        text: `${a.label} has poor ventilation — add windows on opposing walls if possible`,
      });
    }
  });

  // General tips
  const totalWindows = (layout.windows || []).length;
  const windowedRooms = layout.rooms.filter(r => WINDOWED_ROOMS.has(r.type)).length;
  if (totalWindows < windowedRooms) {
    tips.push({
      room: null,
      type: 'general',
      text: 'Some windowable rooms lack windows — add them for better natural lighting',
    });
  }

  return tips;
}
