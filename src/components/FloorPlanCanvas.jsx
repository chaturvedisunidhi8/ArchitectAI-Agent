import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { CATALOG } from '../engine/furniture.js';
import { generateWallQuads } from '../engine/geometry.js';

const WALL_FILL = '#1B2A4A';
const FLOOR_FILL = '#F5F3EF';
const ZONING_COLORS = true;
const SELECTED_STROKE = '#C8956C';
const DOOR_COLOR = '#C8956C';
const WINDOW_COLOR = '#6BA3C7';

function computeTransform(canvas, boundary, scale, viewOffset) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  const padX = 80;
  const padY = 80;
  const availW = cssW - padX * 2;
  const availH = cssH - padY * 2;
  const fitScale = Math.min(availW / Math.max(1, boundary.width), availH / Math.max(1, boundary.height));
  const finalScale = Math.max(0.01, fitScale * scale);
  const ox = (cssW - boundary.width * finalScale) / 2 + viewOffset.x;
  const oy = (cssH - boundary.height * finalScale) / 2 + viewOffset.y;
  return { finalScale, ox, oy, cssW, cssH, dpr };
}

function tx(v, t) { return t.ox + v * t.finalScale; }
function ty(v, t) { return t.oy + v * t.finalScale; }
function ts(v, t) { return v * t.finalScale; }

const FloorPlanCanvas = forwardRef(function FloorPlanCanvas({ layout, selectedRoomId, onSelectRoom, onSwapRooms, onMoveRoom, displayUnit, totalAreaFt }, ref) {
  const canvasRef = useRef(null);
  const [dragState, setDragState] = useState(null);
  const [hoveredRoom, setHoveredRoom] = useState(null);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [showMeasure, setShowMeasure] = useState(false);
  const [measureStart, setMeasureStart] = useState(null);
  const [measureEnd, setMeasureEnd] = useState(null);
  const [showZoning, setShowZoning] = useState(false);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    toggleMeasure: () => setShowMeasure(v => !v),
    isMeasuring: () => showMeasure,
  }));

  const { boundary, rooms, walls, doors } = layout;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const t = computeTransform(canvas, boundary, scale, viewOffset);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(t.dpr, t.dpr);

    // Background
    ctx.fillStyle = '#F0EEEA';
    ctx.fillRect(0, 0, t.cssW, t.cssH);

    // Boundary fill
    ctx.fillStyle = '#FAFAF8';
    ctx.fillRect(tx(0, t), ty(0, t), ts(boundary.width, t), ts(boundary.height, t));

    // Grid (subtle)
    ctx.strokeStyle = '#EDEBE6';
    ctx.lineWidth = 0.4;
    for (let gx = 0; gx <= boundary.width; gx += 1) {
      ctx.beginPath();
      ctx.moveTo(tx(gx, t), ty(0, t));
      ctx.lineTo(tx(gx, t), ty(boundary.height, t));
      ctx.stroke();
    }
    for (let gy = 0; gy <= boundary.height; gy += 1) {
      ctx.beginPath();
      ctx.moveTo(tx(0, t), ty(gy, t));
      ctx.lineTo(tx(boundary.width, t), ty(gy, t));
      ctx.stroke();
    }

    // Major grid every 5ft
    ctx.strokeStyle = '#E0DED8';
    ctx.lineWidth = 0.6;
    for (let gx = 0; gx <= boundary.width; gx += 5) {
      ctx.beginPath();
      ctx.moveTo(tx(gx, t), ty(0, t));
      ctx.lineTo(tx(gx, t), ty(boundary.height, t));
      ctx.stroke();
    }
    for (let gy = 0; gy <= boundary.height; gy += 5) {
      ctx.beginPath();
      ctx.moveTo(tx(0, t), ty(gy, t));
      ctx.lineTo(tx(boundary.width, t), ty(gy, t));
      ctx.stroke();
    }

    // --- Room fills (floors) ---
    rooms.forEach((room) => {
      const isSelected = room.id === selectedRoomId;
      const isHovered = room.id === hoveredRoom;
      const isDragging = dragState && dragState.roomId === room.id && dragState.moved;

      // Floor fill — light neutral by default, color when zoning overlay is on.
      if (showZoning) {
        ctx.fillStyle = room.color;
      } else {
        ctx.fillStyle = FLOOR_FILL;
      }

      // Draw room polygon.
      const poly = room.polygon || [
        [room.x, room.y], [room.x + room.w, room.y],
        [room.x + room.w, room.y + room.h], [room.x, room.y + room.h],
      ];
      ctx.beginPath();
      ctx.moveTo(tx(poly[0][0], t), ty(poly[0][1], t));
      for (let i = 1; i < poly.length; i++) {
        ctx.lineTo(tx(poly[i][0], t), ty(poly[i][1], t));
      }
      ctx.closePath();
      ctx.fill();

      // Subtle inner shadow for depth
      ctx.save();
      ctx.clip();
      const grad = ctx.createLinearGradient(tx(room.x, t), ty(room.y, t), tx(room.x, t), ty(room.y + room.h, t));
      grad.addColorStop(0, 'rgba(255,255,255,0.12)');
      grad.addColorStop(1, 'rgba(0,0,0,0.03)');
      ctx.fillStyle = grad;
      ctx.fillRect(tx(room.x, t), ty(room.y, t), ts(room.w, t), ts(room.h, t));
      ctx.restore();

      if (isHovered && !isSelected) {
        ctx.fillStyle = 'rgba(200, 149, 108, 0.1)';
        ctx.beginPath();
        ctx.moveTo(tx(poly[0][0], t), ty(poly[0][1], t));
        for (let i = 1; i < poly.length; i++) ctx.lineTo(tx(poly[i][0], t), ty(poly[i][1], t));
        ctx.closePath();
        ctx.fill();
      }

      if (isSelected) {
        ctx.strokeStyle = SELECTED_STROKE;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(tx(poly[0][0], t), ty(poly[0][1], t));
        for (let i = 1; i < poly.length; i++) ctx.lineTo(tx(poly[i][0], t), ty(poly[i][1], t));
        ctx.closePath();
        ctx.stroke();

        // Corner handles
        const corners = [
          [room.x, room.y], [room.x + room.w, room.y],
          [room.x, room.y + room.h], [room.x + room.w, room.y + room.h],
        ];
        corners.forEach(([cx, cy]) => {
          ctx.fillStyle = SELECTED_STROKE;
          ctx.beginPath();
          ctx.arc(tx(cx, t), ty(cy, t), 3.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      if (isDragging) {
        ctx.fillStyle = 'rgba(200, 149, 108, 0.15)';
        ctx.beginPath();
        ctx.moveTo(tx(poly[0][0], t), ty(poly[0][1], t));
        for (let i = 1; i < poly.length; i++) ctx.lineTo(tx(poly[i][0], t), ty(poly[i][1], t));
        ctx.closePath();
        ctx.fill();
      }

      // Room label + area — hide if cell is too small on screen.
      const cx = tx(room.x + room.w / 2, t);
      const cy = ty(room.y + room.h / 2, t);
      const screenW = ts(room.w, t);
      const screenH = ts(room.h, t);

      if (screenW > 30 && screenH > 20) {
        // Label
        ctx.fillStyle = WALL_FILL;
        const fontSize = Math.max(8, Math.min(14, ts(1.1, t)));
        ctx.font = `600 ${fontSize}px "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(room.label, cx, cy - ts(0.6, t));

        // Area
        ctx.fillStyle = '#9A9A9A';
        const areaFontSize = Math.max(7, Math.min(11, ts(0.85, t)));
        ctx.font = `400 ${areaFontSize}px "JetBrains Mono", monospace`;
        const areaSqFt = Math.round(room.w * room.h);
        const areaDisplay = displayUnit === 'm\u00B2'
          ? (areaSqFt * 0.092903).toFixed(1) + ' m\u00B2'
          : areaSqFt + ' ft\u00B2';
        ctx.fillText(areaDisplay, cx, cy + ts(0.6, t));
      }

      // Dimension labels along edges
      if (screenW > 25) {
        const dimFontSize = Math.max(6, Math.min(9, ts(0.6, t)));
        ctx.font = `300 ${dimFontSize}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#B0A99F';
        ctx.textAlign = 'center';
        const wLabel = displayUnit === 'm\u00B2'
          ? (room.w * 0.3048).toFixed(1) + 'm'
          : room.w.toFixed(1) + '\'';
        ctx.fillText(wLabel, cx, ty(room.y + room.h + 0.5, t));
      }
      if (screenH > 25) {
        const dimFontSize = Math.max(6, Math.min(9, ts(0.6, t)));
        ctx.font = `300 ${dimFontSize}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#B0A99F';
        const hLabel = displayUnit === 'm\u00B2'
          ? (room.h * 0.3048).toFixed(1) + 'm'
          : room.h.toFixed(1) + '\'';
        ctx.save();
        ctx.translate(tx(room.x - 0.5, t), cy);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(hLabel, 0, 0);
        ctx.restore();
      }
    });

    // --- Doors (gap + swing arc) ---
    if (doors) {
      doors.forEach(door => {
        ctx.save();
        ctx.strokeStyle = DOOR_COLOR;
        ctx.lineWidth = 1.5;

        if (door.horizontal) {
          const dx = tx(door.x, t);
          const dy = ty(door.y, t);
          const dw = Math.abs(ts(door.width, t));
          if (dw < 2) { ctx.restore(); return; }

          // Gap in wall (white fill to "erase" wall behind door).
          ctx.fillStyle = '#FAFAF8';
          ctx.fillRect(dx, dy - ts(0.3, t), dw, ts(0.6, t));

          // Door leaf line.
          ctx.beginPath();
          ctx.moveTo(dx, dy);
          ctx.lineTo(dx + dw, dy);
          ctx.stroke();

          // Swing arc.
          const dir = door.swingDir === 'in' ? -1 : 1;
          ctx.fillStyle = 'rgba(200, 149, 108, 0.12)';
          ctx.beginPath();
          ctx.moveTo(dx, dy);
          ctx.arc(dx + dw, dy, dw, Math.PI, Math.PI + dir * Math.PI / 2, door.swingDir === 'in');
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(dx, dy);
          ctx.arc(dx + dw, dy, dw, Math.PI, Math.PI + dir * Math.PI / 2, door.swingDir === 'in');
          ctx.stroke();
        } else {
          const dx = tx(door.x, t);
          const dy = ty(door.y, t);
          const dh = Math.abs(ts(door.width, t));
          if (dh < 2) { ctx.restore(); return; }

          // Gap in wall.
          ctx.fillStyle = '#FAFAF8';
          ctx.fillRect(dx - ts(0.3, t), dy, ts(0.6, t), dh);

          // Door leaf line.
          ctx.beginPath();
          ctx.moveTo(dx, dy);
          ctx.lineTo(dx, dy + dh);
          ctx.stroke();

          // Swing arc.
          const dir = door.swingDir === 'in' ? 1 : -1;
          ctx.fillStyle = 'rgba(200, 149, 108, 0.12)';
          ctx.beginPath();
          ctx.moveTo(dx, dy + dh);
          ctx.arc(dx, dy + dh, dh, -Math.PI / 2, -Math.PI / 2 + dir * Math.PI / 2, door.swingDir !== 'in');
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(dx, dy + dh);
          ctx.arc(dx, dy + dh, dh, -Math.PI / 2, -Math.PI / 2 + dir * Math.PI / 2, door.swingDir !== 'in');
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    // --- Windows (double line within wall) ---
    if (layout.windows) {
      layout.windows.forEach(win => {
        ctx.save();
        ctx.strokeStyle = WINDOW_COLOR;
        ctx.setLineDash([]);
        const wallThickness = ts(0.15, t); // Visual window thickness.

        if (win.horizontal) {
          const wx = tx(win.x, t);
          const wy = ty(win.y, t);
          const ww = ts(win.width, t);
          // Double line.
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(wx, wy - wallThickness);
          ctx.lineTo(wx + ww, wy - wallThickness);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(wx, wy + wallThickness);
          ctx.lineTo(wx + ww, wy + wallThickness);
          ctx.stroke();
          // End caps.
          ctx.beginPath();
          ctx.moveTo(wx, wy - wallThickness);
          ctx.lineTo(wx, wy + wallThickness);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(wx + ww, wy - wallThickness);
          ctx.lineTo(wx + ww, wy + wallThickness);
          ctx.stroke();
        } else {
          const wx = tx(win.x, t);
          const wy = ty(win.y, t);
          const wh = ts(win.width, t);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(wx - wallThickness, wy);
          ctx.lineTo(wx - wallThickness, wy + wh);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(wx + wallThickness, wy);
          ctx.lineTo(wx + wallThickness, wy + wh);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(wx - wallThickness, wy);
          ctx.lineTo(wx + wallThickness, wy);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(wx - wallThickness, wy + wh);
          ctx.lineTo(wx + wallThickness, wy + wh);
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    // --- Furniture items ---
    if (layout.furnishings && layout.furnishings.length) {
      layout.furnishings.forEach(f => {
        const meta = CATALOG[f.kind];
        if (!meta) return;
        const fw = meta.w;
        const fd = meta.d;
        const rot = f.rot || 0;
        const s = f.scale || 1;
        const rw = fw * s;
        const rh = fd * s;

        ctx.save();
        const cx = tx(f.x, t);
        const cy = ty(f.y, t);

        const hw = ts(rw, t) / 2;
        const hh = ts(rh, t) / 2;
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const corners = [
          [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
        ].map(([dx, dy]) => [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]);

        const catColors = {
          Bedroom: 'rgba(200, 160, 100, 0.18)',
          Living: 'rgba(120, 140, 170, 0.18)',
          Dining: 'rgba(160, 130, 170, 0.18)',
          Kitchen: 'rgba(130, 170, 120, 0.18)',
          Bath: 'rgba(120, 170, 200, 0.18)',
          Office: 'rgba(140, 140, 160, 0.18)',
          Decor: 'rgba(100, 170, 130, 0.18)',
          Misc: 'rgba(160, 160, 160, 0.18)',
        };
        ctx.fillStyle = catColors[meta.category] || 'rgba(160,160,160,0.15)';
        ctx.beginPath();
        ctx.moveTo(corners[0][0], corners[0][1]);
        corners.forEach(([px, py]) => ctx.lineTo(px, py));
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = 'rgba(100, 80, 60, 0.35)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        if (ts(Math.min(rw, rh), t) > 14) {
          const fontSize = Math.max(6, Math.min(9, ts(0.6, t)));
          ctx.font = `400 ${fontSize}px "DM Sans", sans-serif`;
          ctx.fillStyle = 'rgba(80, 60, 40, 0.6)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(meta.label, cx, cy);
        }

        ctx.restore();
      });
    }

    // --- Walls (solid filled poché) ---
    if (walls) {
      const wallQuads = generateWallQuads(walls);
      ctx.fillStyle = WALL_FILL;

      wallQuads.forEach((quad) => {
        ctx.beginPath();
        ctx.moveTo(tx(quad[0][0], t), ty(quad[0][1], t));
        for (let i = 1; i < quad.length; i++) {
          ctx.lineTo(tx(quad[i][0], t), ty(quad[i][1], t));
        }
        ctx.closePath();
        ctx.fill();
      });
    }

    // --- Exterior dimension strings ---
    drawDimensionStrings(ctx, boundary, t, displayUnit);

    // --- Measurement tool ---
    if (showMeasure && measureStart && measureEnd) {
      const sx = tx(measureStart.x, t), sy = ty(measureStart.y, t);
      const ex = tx(measureEnd.x, t), ey = ty(measureEnd.y, t);

      ctx.strokeStyle = '#C8956C';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);

      [{ x: sx, y: sy }, { x: ex, y: ey }].forEach(p => {
        ctx.fillStyle = '#C8956C';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      const dxFt = measureEnd.x - measureStart.x;
      const dyFt = measureEnd.y - measureStart.y;
      const distFt = Math.sqrt(dxFt * dxFt + dyFt * dyFt);
      const dist = displayUnit === 'm\u00B2' ? (distFt * 0.3048).toFixed(2) + ' m' : distFt.toFixed(1) + ' ft';
      const mx = (sx + ex) / 2, my = (sy + ey) / 2;
      ctx.fillStyle = 'rgba(27, 42, 74, 0.85)';
      const tw = ctx.measureText(dist).width;
      ctx.fillRect(mx - tw / 2 - 4, my - 10, tw + 8, 18);
      ctx.fillStyle = '#fff';
      ctx.font = `500 11px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(dist, mx, my - 1);
    }

    ctx.restore();
  }, [layout, selectedRoomId, hoveredRoom, viewOffset, scale, displayUnit, boundary, rooms, walls, doors, dragState, showMeasure, measureStart, measureEnd, showZoning]);

  // --- Exterior dimension strings ---
  function drawDimensionStrings(ctx, boundary, t, displayUnit) {
    const offset = 2.5; // Distance from building edge.
    const witLen = 1.0;  // Witness line length.

    ctx.strokeStyle = '#B0A99F';
    ctx.lineWidth = 0.8;
    ctx.fillStyle = '#B0A99F';
    ctx.font = `400 9px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Bottom dimension string.
    const bx1 = 0, bx2 = boundary.width;
    const by = boundary.height + offset;
    drawDimLine(ctx, tx(bx1, t), ty(by, t), tx(bx2, t), ty(by, t),
      tx(0, t), ty(boundary.height, t), tx(0, t), ty(boundary.height + offset + witLen, t),
      tx(boundary.width, t), ty(boundary.height, t), tx(boundary.width, t), ty(boundary.height + offset + witLen, t),
      formatDim(bx2 - bx1, displayUnit), t);

    // Right dimension string.
    const ry1 = 0, ry2 = boundary.height;
    const rx = boundary.width + offset;
    drawDimLine(ctx, tx(rx, t), ty(ry1, t), tx(rx, t), ty(ry2, t),
      tx(boundary.width, t), ty(0, t), tx(boundary.width + offset + witLen, t), ty(0, t),
      tx(boundary.width, t), ty(boundary.height, t), tx(boundary.width + offset + witLen, t), ty(boundary.height, t),
      formatDim(ry2 - ry1, displayUnit), t, true);
  }

  function drawDimLine(ctx, x1, y1, x2, y2, wx1, wy1, wx2, wy2, wx3, wy3, wx4, wy4, label, t, vertical) {
    // Witness lines.
    ctx.beginPath();
    ctx.moveTo(wx1, wy1); ctx.lineTo(wx2, wy2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wx3, wy3); ctx.lineTo(wx4, wy4); ctx.stroke();

    // Dimension line.
    ctx.beginPath();
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    // Arrowheads.
    const arrowSize = 3;
    if (vertical) {
      // Up arrow.
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x1 - arrowSize, y1 + arrowSize); ctx.lineTo(x1 + arrowSize, y1 + arrowSize); ctx.closePath(); ctx.fill();
      // Down arrow.
      ctx.beginPath();
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - arrowSize, y2 - arrowSize); ctx.lineTo(x2 + arrowSize, y2 - arrowSize); ctx.closePath(); ctx.fill();
    } else {
      // Left arrow.
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x1 + arrowSize, y1 - arrowSize); ctx.lineTo(x1 + arrowSize, y1 + arrowSize); ctx.closePath(); ctx.fill();
      // Right arrow.
      ctx.beginPath();
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - arrowSize, y2 - arrowSize); ctx.lineTo(x2 - arrowSize, y2 + arrowSize); ctx.closePath(); ctx.fill();
    }

    // Label.
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    ctx.save();
    ctx.fillStyle = '#7A7570';
    ctx.font = `400 9px "JetBrains Mono", monospace`;
    if (vertical) {
      ctx.translate(mx + 8, my);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, mx, my - 3);
    }
    ctx.restore();
  }

  function formatDim(feet, displayUnit) {
    if (displayUnit === 'm\u00B2') return (feet * 0.3048).toFixed(1) + 'm';
    return feet.toFixed(0) + '\'';
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let resizeTimer;
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const rect = canvas.parentElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        draw();
      }, 16);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      clearTimeout(resizeTimer);
      window.removeEventListener('resize', resize);
    };
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  // Keyboard shortcuts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onKey = (e) => {
      if (e.key === 'm' || e.key === 'M') {
        setShowMeasure(v => !v);
        setMeasureStart(null);
        setMeasureEnd(null);
      }
      if (e.key === 'Escape') {
        setShowMeasure(false);
        setMeasureStart(null);
        setMeasureEnd(null);
      }
      if (e.key === 'z' || e.key === 'Z') {
        setShowZoning(v => !v);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRoomId) {
        onSelectRoom(null);
      }
    };
    canvas.addEventListener('keydown', onKey);
    return () => canvas.removeEventListener('keydown', onKey);
  }, [selectedRoomId, onSelectRoom]);

  const screenToRoom = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    const t = computeTransform(canvas, boundary, scale, viewOffset);
    const roomX = (mx - t.ox) / t.finalScale;
    const roomY = (my - t.oy) / t.finalScale;

    for (let i = rooms.length - 1; i >= 0; i--) {
      const r = rooms[i];
      if (roomX >= r.x && roomX <= r.x + r.w && roomY >= r.y && roomY <= r.y + r.h) {
        return r;
      }
    }
    return null;
  }, [boundary, rooms, viewOffset, scale]);

  const handleMouseDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const t = computeTransform(canvas, boundary, scale, viewOffset);
    const planX = (mx - t.ox) / t.finalScale;
    const planY = (my - t.oy) / t.finalScale;

    if (showMeasure) {
      if (!measureStart) {
        setMeasureStart({ x: planX, y: planY });
        setMeasureEnd({ x: planX, y: planY });
      } else {
        setMeasureEnd({ x: planX, y: planY });
        setMeasureStart(null);
      }
      return;
    }

    const room = screenToRoom(e.clientX, e.clientY);
    if (room) {
      onSelectRoom(room.id === selectedRoomId ? null : room.id);
      const roomX = (mx - t.ox) / t.finalScale;
      const roomY = (my - t.oy) / t.finalScale;
      const offsetX = roomX - room.x;
      const offsetY = roomY - room.y;
      setDragState({ roomId: room.id, startX: e.clientX, startY: e.clientY, moved: false, offsetX, offsetY });
    } else {
      onSelectRoom(null);
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, [screenToRoom, onSelectRoom, selectedRoomId, boundary, scale, viewOffset, showMeasure, measureStart]);

  const handleMouseMove = useCallback((e) => {
    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setViewOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }

    if (showMeasure && measureStart) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = computeTransform(canvas, boundary, scale, viewOffset);
      setMeasureEnd({ x: (mx - t.ox) / t.finalScale, y: (my - t.oy) / t.finalScale });
      return;
    }

    const room = screenToRoom(e.clientX, e.clientY);
    setHoveredRoom(room ? room.id : null);

    if (dragState) {
      const dx = Math.abs(e.clientX - dragState.startX);
      const dy = Math.abs(e.clientY - dragState.startY);
      if (dx > 5 || dy > 5) {
        setDragState(prev => ({ ...prev, moved: true }));
      }
    }
  }, [screenToRoom, dragState, boundary, scale, viewOffset, showMeasure, measureStart]);

  const handleMouseUp = useCallback((e) => {
    if (isPanning.current) {
      isPanning.current = false;
      return;
    }
    if (dragState && dragState.moved) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = computeTransform(canvas, boundary, scale, viewOffset);
      const roomX = (mx - t.ox) / t.finalScale;
      const roomY = (my - t.oy) / t.finalScale;

      let targetRoom = null;
      for (let i = rooms.length - 1; i >= 0; i--) {
        const r = rooms[i];
        if (r.id !== dragState.roomId && roomX >= r.x && roomX <= r.x + r.w && roomY >= r.y && roomY <= r.y + r.h) {
          targetRoom = r;
          break;
        }
      }

      if (targetRoom) {
        onSwapRooms(dragState.roomId, targetRoom.id);
      } else if (onMoveRoom) {
        const newX = roomX - dragState.offsetX;
        const newY = roomY - dragState.offsetY;
        const origRoom = rooms.find(r => r.id === dragState.roomId);
        if (origRoom) {
          const dx = newX - origRoom.x;
          const dy = newY - origRoom.y;
          if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
            onMoveRoom(dragState.roomId, dx, dy);
          }
        }
      }
    }
    setDragState(null);
  }, [dragState, boundary, rooms, viewOffset, scale, onSwapRooms, onMoveRoom]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    setScale(prev => Math.min(4, Math.max(0.25, prev * delta)));
  }, []);

  const handleDoubleClick = useCallback((e) => {
    const room = screenToRoom(e.clientX, e.clientY);
    if (room) onSelectRoom(room.id);
  }, [screenToRoom, onSelectRoom]);

  // Bound natively rather than via onWheel so the listener can be non-passive
  // and preventDefault the page scroll. Must sit below handleWheel's
  // declaration — a dep array is evaluated during render, so referencing it
  // any earlier hits the temporal dead zone.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  return (
    <canvas
      ref={canvasRef}
      className={`canvas-2d ${showMeasure ? 'canvas-measure' : ''}`}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onMouseLeave={() => { setHoveredRoom(null); setDragState(null); isPanning.current = false; }}
    />
  );
});

export default FloorPlanCanvas;
