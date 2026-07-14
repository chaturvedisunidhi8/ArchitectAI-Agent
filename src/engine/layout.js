import { WALL_THICKNESS_FT } from './constants.js';

export function computeBoundary(totalAreaFt, forcedWidth, forcedHeight) {
  if (forcedWidth && forcedHeight) {
    return {
      width: Math.round(forcedWidth * 10) / 10,
      height: Math.round(forcedHeight * 10) / 10,
    };
  }
  const aspect = 1.35;
  const h = Math.sqrt(totalAreaFt / aspect);
  const w = totalAreaFt / h;
  return { width: Math.round(w * 10) / 10, height: Math.round(h * 10) / 10 };
}

export function packRooms(totalAreaFt, roomSpecs, forcedWidth, forcedHeight) {
  const boundary = computeBoundary(totalAreaFt, forcedWidth, forcedHeight);
  const wallGap = WALL_THICKNESS_FT;
  const pad = 0.3;

  const expanded = [];
  roomSpecs.forEach(spec => {
    for (let i = 0; i < spec.count; i++) {
      expanded.push({
        id: `${spec.type}_${i + 1}`,
        type: spec.type,
        label: spec.count > 1 ? `${spec.label} ${i + 1}` : spec.label,
        targetArea: spec.area,
        color: spec.color,
        aspectTarget: spec.aspectTarget || 1.2,
      });
    }
  });

  expanded.sort((a, b) => b.targetArea - a.targetArea);

  const totalRoomArea = expanded.reduce((s, r) => s + r.targetArea, 0);
  const wallAreaEstimate = (boundary.width + boundary.height) * wallGap * 2;
  const usableArea = (boundary.width * boundary.height) - wallAreaEstimate;
  const areaScale = Math.min(1.1, Math.sqrt(Math.max(0.5, usableArea / totalRoomArea)));

  const placed = [];
  let shelfY = pad;
  let shelfHeight = 0;
  let cursorX = pad;
  let shelfRow = [];
  const maxW = boundary.width - pad * 2;
  const maxH = boundary.height - pad * 2;

  function flushShelf() {
    if (shelfRow.length === 0) return;
    const rowWidth = boundary.width - pad * 2;
    const actualUsed = shelfRow.reduce((s, r) => s + r.w, 0) + (shelfRow.length - 1) * wallGap;
    const slack = rowWidth - actualUsed;

    if (slack > 0.5 && shelfRow.length > 1) {
      const stretchFactor = rowWidth / actualUsed;
      let ex = pad;
      shelfRow.forEach(r => {
        const newW = r.w * stretchFactor;
        const stretch = newW / r.w;
        const newH = r.h * stretch;
        if (shelfY + newH <= maxH + pad) {
          r.w = Math.round(newW * 10) / 10;
          r.h = Math.round(Math.min(newH, maxH - shelfY + pad) * 10) / 10;
        }
        r.x = Math.round(ex * 10) / 10;
        ex += r.w + wallGap;
      });
    }

    shelfRow = [];
  }

  expanded.forEach((room) => {
    const scaledArea = room.targetArea * areaScale;
    const aspect = room.aspectTarget;

    let rw, rh;
    if (scaledArea >= 120) {
      rh = Math.sqrt(scaledArea / aspect);
      rw = scaledArea / rh;
      rh = Math.max(7, Math.min(16, rh));
      rw = Math.max(6, Math.min(maxW * 0.6, rw));
    } else if (scaledArea >= 40) {
      rh = Math.sqrt(scaledArea / aspect);
      rw = scaledArea / rh;
      rh = Math.max(4, Math.min(10, rh));
      rw = Math.max(4, Math.min(maxW * 0.5, rw));
    } else {
      rh = Math.sqrt(scaledArea / 1.0);
      rw = scaledArea / rh;
      rh = Math.max(3, Math.min(6, rh));
      rw = Math.max(3, Math.min(maxW * 0.4, rw));
    }

    if (cursorX + rw > maxW + 0.5) {
      flushShelf();
      cursorX = pad;
      shelfY += shelfHeight + wallGap;
      shelfHeight = 0;
    }

    if (shelfY + rh > maxH + pad) {
      rh = maxH + pad - shelfY;
      rw = scaledArea / rh;
      if (rw < 2 || rh < 2) return;
    }

    const roomObj = {
      ...room,
      x: Math.round(cursorX * 10) / 10,
      y: Math.round(shelfY * 10) / 10,
      w: Math.round(rw * 10) / 10,
      h: Math.round(rh * 10) / 10,
    };

    placed.push(roomObj);
    shelfRow.push(roomObj);

    cursorX += rw + wallGap;
    shelfHeight = Math.max(shelfHeight, rh);
  });

  flushShelf();

  return { boundary, rooms: placed };
}

export function relayout(totalAreaFt, roomSpecs, forcedWidth, forcedHeight) {
  return packRooms(totalAreaFt, roomSpecs, forcedWidth, forcedHeight);
}
