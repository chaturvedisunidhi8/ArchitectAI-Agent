/**
 * energyAnalyzer.js — Natural light and ventilation analysis for floor plans.
 *
 * Scores each room based on window placement, exterior wall exposure,
 * and room proportions for natural lighting and cross-ventilation.
 */

import { WINDOWED_ROOMS } from './constants.js';

function roomExteriorWalls(room, boundary) {
  const sides = [];
  const tol = 0.5;
  if (Math.abs(room.y) < tol) sides.push('bottom');
  if (Math.abs((room.y + room.h) - boundary.height) < tol) sides.push('top');
  if (Math.abs(room.x) < tol) sides.push('left');
  if (Math.abs((room.x + room.w) - boundary.width) < tol) sides.push('right');
  return sides;
}

function scoreNaturalLight(room, layout) {
  if (!WINDOWED_ROOMS.has(room.type)) return { score: 100, note: 'Naturally lit room type' };

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
  if (room.type === 'balcony' || room.type === 'garden') score += 10;

  return {
    score: Math.min(100, score),
    note: hasOpposing
      ? 'Cross-ventilation possible (windows on opposing walls)'
      : exteriorSides.length > 1 ? 'Multiple exterior walls available' : 'Limited ventilation — single exterior wall',
  };
}

export function analyzeEnergy(layout) {
  if (!layout || !layout.rooms) return null;

  const roomAnalyses = layout.rooms.map(room => {
    const light = scoreNaturalLight(room, layout);
    const ventilation = scoreVentilation(room, layout);
    const overall = Math.round((light.score + ventilation.score) / 2);

    return {
      id: room.id,
      label: room.label,
      type: room.type,
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
