import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ROOM_TYPES } from '../engine/constants.js';
import { area as polyArea, centroid as polyCentroid, bbox as polyBbox, isSelfIntersecting, regularPolygon, lShapePolygon, rectToPolygon } from '../engine/polygon.js';

const GRID_SIZE = 0.5;
const VERTEX_HIT_RADIUS = 8;

function snap(v, enabled) { return enabled ? Math.round(v * 2) / 2 : Math.round(v * 10) / 10; }

function ptsToWorld(pts) { return pts.map(p => [p.x, p.y]); }

export default function FreeformLayoutBuilder({
  freeformBoundary, freeformRooms, drawingMode, activeTool, snapToGrid, freeformWarnings,
  totalAreaFt, displayUnit, selectedRoomId, onSelectRoom,
  setFreeformBoundary, setFreeformBoundaryPolygon,
  addFreeformRectRoom, addFreeformPolygonRoom,
  liveMoveFreeformRoom, liveReshapeFreeformVertex, liveRotateFreeformRoom,
  deleteFreeformRoom, updateFreeformRoomProps,
  setActiveTool, setDrawingMode, toggleSnap,
  commitFreeformEdit, finalizeFreeformLayout,
  canUndo, canRedo, onUndo, onRedo,
  onCancel, onConfirm,
}) {
  const canvasRef = useRef(null);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [dragState, setDragState] = useState(null);
  const [drawVertices, setDrawVertices] = useState([]);
  const [hoverInfo, setHoverInfo] = useState(null);
  const [rotateState, setRotateState] = useState(null);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const selectedRoom = selectedRoomId ? freeformRooms.find(r => r.id === selectedRoomId) : null;

  // Compute boundary bbox for transform.
  const boundaryBbox = freeformBoundary
    ? polyBbox(freeformBoundary.points.map(p => [p.x, p.y]))
    : { x: 0, y: 0, w: 40, h: 30 };

  const boundaryForCanvas = { width: boundaryBbox.w, height: boundaryBbox.h };

  // --- Canvas rendering ---
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr;
    const cssH = canvas.height / dpr;
    const padX = 60, padY = 60;
    const availW = cssW - padX * 2, availH = cssH - padY * 2;
    const fitScale = Math.min(availW / Math.max(1, boundaryForCanvas.w), availH / Math.max(1, boundaryForCanvas.h));
    const finalScale = Math.max(0.01, fitScale * scale);
    const ox = (cssW - boundaryForCanvas.w * finalScale) / 2 + viewOffset.x;
    const oy = (cssH - boundaryForCanvas.h * finalScale) / 2 + viewOffset.y;
    const t = { finalScale, ox, oy, cssW, cssH, dpr };
    const tx = (v) => t.ox + v * t.finalScale;
    const ty = (v) => t.oy + v * t.finalScale;
    const ts = (v) => v * t.finalScale;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#F0EEEA';
    ctx.fillRect(0, 0, cssW, cssH);

    // Grid
    ctx.strokeStyle = '#EDEBE6'; ctx.lineWidth = 0.4;
    for (let gx = 0; gx <= boundaryForCanvas.w; gx += 1) {
      ctx.beginPath(); ctx.moveTo(tx(gx), ty(0)); ctx.lineTo(tx(gx), ty(boundaryForCanvas.h)); ctx.stroke();
    }
    for (let gy = 0; gy <= boundaryForCanvas.h; gy += 1) {
      ctx.beginPath(); ctx.moveTo(tx(0), ty(gy)); ctx.lineTo(tx(boundaryForCanvas.w), ty(gy)); ctx.stroke();
    }

    // Boundary polygon
    if (freeformBoundary) {
      const pts = freeformBoundary.points;
      ctx.fillStyle = '#FAFAF8';
      ctx.beginPath();
      ctx.moveTo(tx(pts[0].x), ty(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i].x), ty(pts[i].y));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#B0A99F';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Rooms
    freeformRooms.forEach(room => {
      const pts = room.points;
      const isSelected = room.id === selectedRoomId;
      const b = polyBbox(ptsToWorld(pts));

      ctx.fillStyle = isSelected ? 'rgba(200, 149, 108, 0.15)' : room.color || 'rgba(200, 149, 108, 0.08)';
      ctx.beginPath();
      ctx.moveTo(tx(pts[0].x), ty(pts[0].y));
      for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i].x), ty(pts[i].y));
      ctx.closePath();
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#C8956C';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // Vertex handles
        pts.forEach(p => {
          ctx.fillStyle = '#C8956C';
          ctx.beginPath();
          ctx.arc(tx(p.x), ty(p.y), 3.5, 0, Math.PI * 2);
          ctx.fill();
        });
        // Rotate handle
        const c = polyCentroid(ptsToWorld(pts));
        const radius = Math.max(b.w, b.h) / 2 + 3;
        const hx = c[0], hy = c[1] - radius;
        ctx.strokeStyle = '#C8956C';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(tx(c[0]), ty(c[1]));
        ctx.lineTo(tx(hx), ty(hy));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#C8956C';
        ctx.beginPath();
        ctx.arc(tx(hx), ty(hy), 5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Room label
      const cx = tx(b.x + b.w / 2), cy = ty(b.y + b.h / 2);
      if (ts(Math.min(b.w, b.h)) > 20) {
        ctx.fillStyle = '#1B2A4A';
        const fs = Math.max(8, Math.min(13, ts(1)));
        ctx.font = `600 ${fs}px "DM Sans", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(room.name, cx, cy - ts(0.4));
        ctx.fillStyle = '#9A9A9A';
        const afs = Math.max(7, Math.min(10, ts(0.75)));
        ctx.font = `400 ${afs}px "JetBrains Mono", monospace`;
        const areaSqFt = Math.round(polyArea(ptsToWorld(pts)));
        const areaDisp = displayUnit === 'm\u00B2' ? (areaSqFt * 0.092903).toFixed(1) + ' m\u00B2' : areaSqFt + ' ft\u00B2';
        ctx.fillText(areaDisp, cx, cy + ts(0.5));
      }
    });

    // Drawing in-progress polygon
    if (drawVertices.length > 0) {
      ctx.strokeStyle = '#C8956C';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(tx(drawVertices[0][0]), ty(drawVertices[0][1]));
      for (let i = 1; i < drawVertices.length; i++) ctx.lineTo(tx(drawVertices[i][0]), ty(drawVertices[i][1]));
      ctx.stroke();
      ctx.setLineDash([]);
      drawVertices.forEach(([x, y]) => {
        ctx.fillStyle = '#C8956C';
        ctx.beginPath();
        ctx.arc(tx(x), ty(y), 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    ctx.restore();
  }, [freeformBoundary, freeformRooms, selectedRoomId, drawVertices, viewOffset, scale, displayUnit, boundaryForCanvas]);

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
    return () => { clearTimeout(resizeTimer); window.removeEventListener('resize', resize); };
  }, [draw]);
  useEffect(() => { draw(); }, [draw]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    setScale(prev => Math.min(4, Math.max(0.25, prev * delta)));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Screen → world coordinates
  const screenToWorld = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.width / dpr, cssH = canvas.height / dpr;
    const padX = 60, padY = 60;
    const availW = cssW - padX * 2, availH = cssH - padY * 2;
    const fitScale = Math.min(availW / Math.max(1, boundaryForCanvas.w), availH / Math.max(1, boundaryForCanvas.h));
    const finalScale = Math.max(0.01, fitScale * scale);
    const ox = (cssW - boundaryForCanvas.w * finalScale) / 2 + viewOffset.x;
    const oy = (cssH - boundaryForCanvas.h * finalScale) / 2 + viewOffset.y;
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    return { x: (mx - ox) / finalScale, y: (my - oy) / finalScale };
  }, [viewOffset, scale, boundaryForCanvas]);

  // Hit test: find room under point
  const hitTestRoom = useCallback((wx, wy) => {
    for (let i = freeformRooms.length - 1; i >= 0; i--) {
      const r = freeformRooms[i];
      const pts = ptsToWorld(r.points);
      // Ray casting point-in-polygon
      let inside = false;
      for (let j = 0, k = pts.length - 1; j < pts.length; k = j++) {
        const [xi, yi] = pts[j], [xk, yk] = pts[k];
        if ((yi > wy) !== (yk > wy) && wx < (xk - xi) * (wy - yi) / (yk - yi) + xi) inside = !inside;
      }
      if (inside) return r;
    }
    return null;
  }, [freeformRooms]);

  // Hit test: find vertex near point
  const hitTestVertex = useCallback((wx, wy) => {
    if (!selectedRoom) return null;
    const pts = selectedRoom.points;
    for (let i = 0; i < pts.length; i++) {
      const dx = wx - pts[i].x, dy = wy - pts[i].y;
      if (Math.sqrt(dx * dx + dy * dy) * scale < VERTEX_HIT_RADIUS) return i;
    }
    return null;
  }, [selectedRoom, scale]);

  // Hit test: rotate handle
  const hitTestRotateHandle = useCallback((wx, wy) => {
    if (!selectedRoom) return false;
    const pts = ptsToWorld(selectedRoom.points);
    const c = polyCentroid(pts);
    const b = polyBbox(pts);
    const radius = Math.max(b.w, b.h) / 2 + 3;
    const hx = c[0], hy = c[1] - radius;
    const dx = wx - hx, dy = wy - hy;
    return Math.sqrt(dx * dx + dy * dy) * scale < VERTEX_HIT_RADIUS;
  }, [selectedRoom, scale]);

  // --- Mouse handlers ---
  const handleMouseDown = useCallback((e) => {
    const w = screenToWorld(e.clientX, e.clientY);

    // Drawing mode: add vertex
    if (activeTool === 'draw-boundary' || activeTool === 'draw-room') {
      setDrawVertices(prev => [...prev, [snap(w.x, snapToGrid), snap(w.y, snapToGrid)]]);
      return;
    }

    // Rotate tool: check rotate handle
    if (activeTool === 'rotate' && selectedRoom && hitTestRotateHandle(w.x, w.y)) {
      const pts = ptsToWorld(selectedRoom.points);
      const c = polyCentroid(pts);
      setRotateState({ roomId: selectedRoom.id, startAngle: Math.atan2(w.y - c[1], w.x - c[0]), startRotation: selectedRoom.rotation });
      return;
    }

    // Reshape tool: check vertex
    if (activeTool === 'reshape' && selectedRoom) {
      const vi = hitTestVertex(w.x, w.y);
      if (vi !== null) {
        setDragState({ type: 'reshape', roomId: selectedRoom.id, vertexIndex: vi });
        return;
      }
    }

    // Select / move tool
    const room = hitTestRoom(w.x, w.y);
    if (room) {
      onSelectRoom(room.id === selectedRoomId ? null : room.id);
      setDragState({ type: 'move', roomId: room.id, startX: e.clientX, startY: e.clientY, moved: false, lastWorldX: w.x, lastWorldY: w.y });
    } else {
      onSelectRoom(null);
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, [activeTool, selectedRoom, selectedRoomId, screenToWorld, hitTestRoom, hitTestVertex, hitTestRotateHandle, onSelectRoom, snapToGrid]);

  const handleMouseMove = useCallback((e) => {
    if (isPanning.current) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      setViewOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }

    const w = screenToWorld(e.clientX, e.clientY);

    if (dragState) {
      if (dragState.type === 'move') {
        const dx = Math.abs(e.clientX - dragState.startX), dy = Math.abs(e.clientY - dragState.startY);
        if (dx > 5 || dy > 5) {
          const worldDx = w.x - dragState.lastWorldX;
          const worldDy = w.y - dragState.lastWorldY;
          liveMoveFreeformRoom(dragState.roomId, worldDx, worldDy);
          setDragState(prev => ({ ...prev, moved: true, lastWorldX: w.x, lastWorldY: w.y }));
        }
      } else if (dragState.type === 'reshape') {
        liveReshapeFreeformVertex(dragState.roomId, dragState.vertexIndex, snap(w.x, snapToGrid), snap(w.y, snapToGrid));
      }
    }

    if (rotateState) {
      const room = freeformRooms.find(r => r.id === rotateState.roomId);
      if (room) {
        const c = polyCentroid(ptsToWorld(room.points));
        const currentAngle = Math.atan2(w.y - c[1], w.x - c[0]);
        const delta = currentAngle - rotateState.startAngle;
        // Snap rotation to 15-degree increments if snap is on
        const snappedDelta = snapToGrid ? Math.round(delta / (Math.PI / 12)) * (Math.PI / 12) : delta;
        liveRotateFreeformRoom(rotateState.roomId, snappedDelta - (room.rotation - rotateState.startRotation));
      }
    }
  }, [dragState, rotateState, screenToWorld, snapToGrid, freeformRooms, liveMoveFreeformRoom, liveReshapeFreeformVertex, liveRotateFreeformRoom]);

  const handleMouseUp = useCallback(() => {
    if (isPanning.current) { isPanning.current = false; return; }
    if (dragState || rotateState) {
      commitFreeformEdit();
    }
    setDragState(null);
    setRotateState(null);
  }, [dragState, rotateState, commitFreeformEdit]);

  const handleDoubleClick = useCallback((e) => {
    if ((activeTool === 'draw-boundary' || activeTool === 'draw-room') && drawVertices.length >= 3) {
      finishDrawing();
    }
  }, [activeTool, drawVertices]);

  // Keyboard
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onKey = (e) => {
      if (e.key === 'Enter' && drawVertices.length >= 3) finishDrawing();
      if (e.key === 'Escape') {
        if (drawVertices.length > 0) { setDrawVertices([]); return; }
        setActiveTool('select');
        setDrawingMode(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRoomId && activeTool === 'select') {
        deleteFreeformRoom(selectedRoomId);
        onSelectRoom(null);
      }
    };
    canvas.addEventListener('keydown', onKey);
    return () => canvas.removeEventListener('keydown', onKey);
  }, [drawVertices, selectedRoomId, activeTool]);

  function finishDrawing() {
    const pts = drawVertices;
    if (pts.length < 3) { setDrawVertices([]); return; }
    if (isSelfIntersecting(pts)) { setDrawVertices([]); return; }
    if (activeTool === 'draw-boundary') {
      setFreeformBoundaryPolygon(pts);
    } else if (activeTool === 'draw-room') {
      const rt = ROOM_TYPES.find(t => t.id === (drawingMode?.roomType || 'living'));
      addFreeformPolygonRoom(drawingMode?.roomType || 'living', rt, pts);
    }
    setDrawVertices([]);
    setDrawingMode(null);
    setActiveTool('select');
  }

  // --- Sidebar handlers ---
  function handleBoundaryPreset(preset) {
    setFreeformBoundary(preset, totalAreaFt);
    setActiveTool('select');
  }

  function handleAddRectRoom(roomType) {
    const rt = ROOM_TYPES.find(t => t.id === roomType);
    addFreeformRectRoom(roomType, rt);
  }

  function handleStartDrawRoom(roomType) {
    setActiveTool('draw-room');
    setDrawingMode({ roomType });
    setDrawVertices([]);
  }

  const totalArea = freeformRooms.reduce((sum, r) => sum + polyArea(ptsToWorld(r.points)), 0);
  const boundaryArea = freeformBoundary ? polyArea(freeformBoundary.points.map(p => [p.x, p.y])) : 0;

  return (
    <>
      {/* TOOLBAR */}
      <div className="main-toolbar">
        <span className="toolbar-label" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'none', fontSize: 13 }}>
          Freeform Layout Builder
        </span>
        <div className="toolbar-separator" />
        <span className="toolbar-label" style={{ whiteSpace: 'nowrap' }}>
          {freeformRooms.length} rooms · {Math.round(totalArea)} / {Math.round(boundaryArea)} ft²
        </span>
        <div style={{ flex: 1 }} />
        {activeTool !== 'select' && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setActiveTool('select'); setDrawingMode(null); setDrawVertices([]); }}>
            ✕ Cancel Draw
          </button>
        )}
        <button className={`btn btn-ghost btn-sm ${snapToGrid ? 'active' : ''}`} onClick={toggleSnap} title="Snap to 0.5 ft grid">
          {snapToGrid ? '⊞ Snap On' : '⊞ Snap'}
        </button>
        <div className="toolbar-separator" />
        <button className="btn btn-ghost btn-sm" onClick={onUndo} disabled={!canUndo} title="Undo">↩</button>
        <button className="btn btn-ghost btn-sm" onClick={onRedo} disabled={!canRedo} title="Redo">↪</button>
        <div className="toolbar-separator" />
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>← Layouts</button>
        <button className="btn btn-primary btn-sm" onClick={() => { finalizeFreeformLayout(); onConfirm(); }}>Use This Layout →</button>
      </div>

      <div className="main-canvas">
        {/* Canvas */}
        <canvas
          ref={canvasRef}
          className="canvas-2d"
          tabIndex={0}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onMouseLeave={() => { setDragState(null); setRotateState(null); isPanning.current = false; }}
        />

        {/* Sidebar panel */}
        <div className="custom-builder-panel" style={{ width: 260 }}>
          {!freeformBoundary ? (
            /* Boundary shape selection */
            <>
              <div className="cb-title">Choose boundary shape</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
                {[
                  { id: 'rectangle', label: 'Rectangle' },
                  { id: 'l-shape', label: 'L-Shape' },
                  { id: 'circle', label: 'Circle' },
                  { id: 'custom', label: 'Draw Custom' },
                ].map(p => (
                  <button key={p.id} className="btn btn-secondary btn-sm" style={{ fontSize: 11 }}
                    onClick={() => {
                      if (p.id === 'custom') { setActiveTool('draw-boundary'); setDrawVertices([]); }
                      else handleBoundaryPreset(p.id);
                    }}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="cb-hint" style={{ marginTop: 8 }}>
                Select a preset or draw your own boundary shape. Area: {Math.round(totalAreaFt)} ft²
              </div>
            </>
          ) : (
            <>
              {/* Tool bar */}
              <div className="cb-title">Tools</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                {[
                  { id: 'select', label: '↖ Select' },
                  { id: 'reshape', label: '◇ Reshape' },
                  { id: 'rotate', label: '⟳ Rotate' },
                ].map(tool => (
                  <button key={tool.id}
                    className={`btn btn-sm ${activeTool === tool.id ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ fontSize: 10, flex: '1 1 0' }}
                    onClick={() => setActiveTool(tool.id)}>
                    {tool.label}
                  </button>
                ))}
              </div>

              {/* Add rooms */}
              <div className="cb-title" style={{ marginTop: 8 }}>Add rooms</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                {ROOM_TYPES.slice(0, 8).map(rt => (
                  <div key={rt.id} style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, flex: 1, textAlign: 'left' }}
                      onClick={() => handleAddRectRoom(rt.id)}>
                      + {rt.label}
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: 9 }}
                      onClick={() => handleStartDrawRoom(rt.id)} title={`Draw ${rt.label} shape`}>
                      ✏
                    </button>
                  </div>
                ))}
              </div>

              {/* Room list */}
              <div className="cb-title" style={{ marginTop: 8 }}>Rooms · {freeformRooms.length}</div>
              <div className="cb-list" style={{ maxHeight: 140 }}>
                {freeformRooms.map(room => (
                  <div key={room.id}
                    className={`cb-item ${selectedRoomId === room.id ? 'selected' : ''}`}
                    onClick={() => onSelectRoom(room.id === selectedRoomId ? null : room.id)}>
                    <span className="cb-item-swatch" style={{ background: room.color }} />
                    <span className="cb-item-name">{room.name}</span>
                    <span className="cb-item-dims">{Math.round(polyArea(ptsToWorld(room.points)))} ft²</span>
                  </div>
                ))}
              </div>

              {/* Selected room properties */}
              {selectedRoom && (
                <div className="cb-edit">
                  <div className="cb-edit-title">
                    <span className="cb-item-swatch" style={{ background: selectedRoom.color, display: 'inline-block', marginRight: 6 }} />
                    <input
                      type="text"
                      value={selectedRoom.name}
                      onChange={(e) => updateFreeformRoomProps(selectedRoom.id, { name: e.target.value })}
                      style={{ border: 'none', background: 'transparent', fontWeight: 600, fontSize: 12, color: 'var(--color-primary)', width: '100%' }}
                    />
                  </div>
                  <div className="cb-field">
                    <label>Type</label>
                    <select
                      value={selectedRoom.roomType}
                      onChange={(e) => {
                        const rt = ROOM_TYPES.find(t => t.id === e.target.value);
                        updateFreeformRoomProps(selectedRoom.id, { roomType: e.target.value, color: rt?.color || selectedRoom.color });
                      }}
                    >
                      {ROOM_TYPES.map(rt => <option key={rt.id} value={rt.id}>{rt.label}</option>)}
                    </select>
                  </div>
                  <div className="cb-field">
                    <label>Area</label>
                    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
                      {Math.round(polyArea(ptsToWorld(selectedRoom.points)))} ft²
                    </div>
                  </div>
                  <button className="btn btn-secondary btn-sm btn-full" onClick={() => { deleteFreeformRoom(selectedRoom.id); onSelectRoom(null); }}>
                    Delete Room
                  </button>
                </div>
              )}

              {/* Warnings */}
              {freeformWarnings.length > 0 && (
                <div style={{ marginTop: 6, padding: '6px 8px', background: 'rgba(200,149,108,0.08)', borderRadius: 4, fontSize: 10, color: '#8B6914' }}>
                  {freeformWarnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="canvas-hint">
        {activeTool === 'draw-boundary' || activeTool === 'draw-room'
          ? 'Click to place vertices · Double-click or Enter to finish · Esc to cancel'
          : activeTool === 'reshape'
          ? 'Click a vertex handle and drag to reshape'
          : activeTool === 'rotate'
          ? 'Drag the rotate handle above the selected room'
          : 'Click a room to select · Drag to move · Scroll to zoom'}
      </div>
    </>
  );
}
