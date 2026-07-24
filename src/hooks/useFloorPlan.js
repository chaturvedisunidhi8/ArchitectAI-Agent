import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ROOM_TYPES, SQFT_TO_SQM, SQM_TO_SQFT } from '../engine/constants.js';
import { generateWalls } from '../engine/geometry.js';
import { defaultFurnishings, newFurnishingId } from '../engine/furniture.js';
import { generateVariants } from '../engine/layoutVariants.js';
import { getTheme } from '../engine/themes.js';
import { migrateLegacyRoom, createRoomCell } from '../engine/roomCell.js';
import { runAutoDesign, PIPELINE_STAGES } from '../engine/aiDesigner.js';
import { area as polyArea, centroid as polyCentroid, bbox as polyBbox, rectToPolygon, polygonContains, isSelfIntersecting, regularPolygon, lShapePolygon } from '../engine/polygon.js';
import { checkReachability } from '../engine/adjacency.js';

const SCHEMA_VERSION = 4;

function withWalls(layout, rooms) {
  const { walls, doors, windows } = generateWalls(
    rooms.map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, type: r.roomType || r.type, polygon: r.polygon })),
    layout.boundary,
  );
  return { ...layout, rooms, walls, doors, windows };
}

const INITIAL_ROOMS = ROOM_TYPES.map(t => ({
  type: t.id,
  label: t.label,
  color: t.color,
  area: t.defaultArea,
  count: 0,
  minArea: t.minArea,
}));

const MAX_HISTORY = 50;

export default function useFloorPlan() {
  const [step, setStep] = useState(0);
  const [totalArea, setTotalArea] = useState(1200);
  const [unit, setUnit] = useState('sqft');
  const [roomSpecs, setRoomSpecs] = useState(INITIAL_ROOMS);
  const [layout, setLayoutState] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // New state for AI agent features
  const [promptText, setPromptText] = useState('');
  const [extractedStyle, setExtractedStyle] = useState('modern');
  const [extractedDirection, setExtractedDirection] = useState(null);
  const [layoutVariants, setLayoutVariants] = useState([]);
  const [selectedLayoutIndex, setSelectedLayoutIndex] = useState(0);
  const [selectedTheme, setSelectedTheme] = useState('modern');

  // Auto-design (AI) state
  const [designMode, setDesignMode] = useState(null); // 'ai' | 'manual' | null
  const [aiRunning, setAiRunning] = useState(false);
  const [aiProgress, setAiProgress] = useState(null);  // { stageId, index, total, info }
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState(null);

  // Freeform layout state
  const [freeformBoundary, setFreeformBoundaryState] = useState(null);
  const [freeformRooms, setFreeformRoomsState] = useState([]);
  const [drawingMode, setDrawingMode] = useState(null);
  const [activeTool, setActiveTool] = useState('select');
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [freeformWarnings, setFreeformWarnings] = useState([]);

  const totalAreaFt = unit === 'sqm' ? totalArea * SQM_TO_SQFT : totalArea;
  const displayUnit = unit === 'sqft' ? 'ft²' : 'm²';

  const totalUsedArea = useMemo(() => {
    return roomSpecs.reduce((sum, r) => sum + r.area * r.count, 0);
  }, [roomSpecs]);

  const areaRemaining = totalArea - totalUsedArea;
  const areaPercent = totalArea > 0 ? Math.min(100, (totalUsedArea / totalArea) * 100) : 0;

  const activeRooms = useMemo(() => roomSpecs.filter(r => r.count > 0), [roomSpecs]);

  const pushHistory = useCallback((newLayout) => {
    setHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1);
      const next = [...trimmed, newLayout];
      if (next.length > MAX_HISTORY) next.shift();
      return next;
    });
    setHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY - 1));
  }, [historyIndex]);

  const setLayout = useCallback((newLayout, recordHistory = true) => {
    setLayoutState(newLayout);
    if (recordHistory && newLayout) {
      pushHistory(newLayout);
    }
  }, [pushHistory]);

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const prev = historyIndex - 1;
      setHistoryIndex(prev);
      setLayoutState(history[prev]);
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const next = historyIndex + 1;
      setHistoryIndex(next);
      setLayoutState(history[next]);
    }
  }, [history, historyIndex]);

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  const mutateLayout = useCallback((fn) => {
    setLayoutState(prev => {
      if (!prev) return prev;
      const next = fn(prev);
      if (!next || next === prev) return prev;
      pushHistory(next);
      return next;
    });
  }, [pushHistory]);

  const swapRooms = useCallback((idA, idB) => {
    mutateLayout(prev => {
      const rooms = [...prev.rooms];
      const idxA = rooms.findIndex(r => r.id === idA);
      const idxB = rooms.findIndex(r => r.id === idB);
      if (idxA === -1 || idxB === -1) return prev;
      const tempX = rooms[idxA].x, tempY = rooms[idxA].y;
      rooms[idxA] = { ...rooms[idxA], x: rooms[idxB].x, y: rooms[idxB].y };
      rooms[idxB] = { ...rooms[idxB], x: tempX, y: tempY };
      return withWalls(prev, rooms);
    });
  }, [mutateLayout]);

  const moveRoom = useCallback((roomId, dx, dy) => {
    mutateLayout(prev => {
      const room = prev.rooms.find(r => r.id === roomId);
      if (!room) return prev;
      const newX = Math.round(Math.max(0, Math.min(prev.boundary.width - room.w, room.x + dx)) * 10) / 10;
      const newY = Math.round(Math.max(0, Math.min(prev.boundary.height - room.h, room.y + dy)) * 10) / 10;
      const rdx = newX - room.x, rdy = newY - room.y;
      const rooms = prev.rooms.map(r => (r.id === roomId ? { ...r, x: newX, y: newY } : r));
      const furnishings = (prev.furnishings || []).map(f =>
        f.roomId === roomId ? { ...f, x: Math.round((f.x + rdx) * 10) / 10, y: Math.round((f.y + rdy) * 10) / 10 } : f,
      );
      return { ...withWalls(prev, rooms), furnishings };
    });
  }, [mutateLayout]);

  const editRoom = useCallback((roomId, patch) => {
    mutateLayout(prev => {
      const room = prev.rooms.find(r => r.id === roomId);
      if (!room) return prev;
      const b = prev.boundary;
      const w = Math.max(3, Math.round((patch.w ?? room.w) * 10) / 10);
      const h = Math.max(3, Math.round((patch.h ?? room.h) * 10) / 10);
      const x = Math.round(Math.max(0, Math.min(b.width - w, patch.x ?? room.x)) * 10) / 10;
      const y = Math.round(Math.max(0, Math.min(b.height - h, patch.y ?? room.y)) * 10) / 10;
      const rdx = x - room.x, rdy = y - room.y;
      const rooms = prev.rooms.map(r => (r.id === roomId ? { ...r, x, y, w, h } : r));
      const furnishings = (prev.furnishings || []).map(f =>
        f.roomId === roomId ? { ...f, x: Math.round((f.x + rdx) * 10) / 10, y: Math.round((f.y + rdy) * 10) / 10 } : f,
      );
      return { ...withWalls(prev, rooms), furnishings };
    });
  }, [mutateLayout]);

  const rotateRoom = useCallback((roomId) => {
    mutateLayout(prev => {
      const room = prev.rooms.find(r => r.id === roomId);
      if (!room) return prev;
      const newW = room.h;
      const newH = room.w;
      const cx = room.x + room.w / 2;
      const cy = room.y + room.h / 2;
      const newX = Math.round(Math.max(0, Math.min(prev.boundary.width - newW, cx - newW / 2)) * 10) / 10;
      const newY = Math.round(Math.max(0, Math.min(prev.boundary.height - newH, cy - newH / 2)) * 10) / 10;
      const rooms = prev.rooms.map(r => (r.id === roomId ? { ...r, x: newX, y: newY, w: newW, h: newH } : r));
      const furnishings = (prev.furnishings || []).map(f => {
        if (f.roomId !== roomId) return f;
        const rx = f.x - cx;
        const ry = f.y - cy;
        return { ...f, x: Math.round((cx + ry) * 10) / 10, y: Math.round((cy - rx) * 10) / 10, rot: Math.round((f.rot || 0) + Math.PI / 2) };
      });
      return { ...withWalls(prev, rooms), furnishings };
    });
  }, [mutateLayout]);

  const updateRoomProps = useCallback((roomId, props) => {
    mutateLayout(prev => {
      const rooms = prev.rooms.map(r => (r.id === roomId ? { ...r, ...props } : r));
      return { ...prev, rooms };
    });
  }, [mutateLayout]);

  const addFurnishing = useCallback((kind, x, y, roomId = null) => {
    const id = newFurnishingId(kind);
    mutateLayout(prev => {
      const item = { id, kind, roomId, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, rot: 0, scale: 1, color: null };
      return { ...prev, furnishings: [...(prev.furnishings || []), item] };
    });
    return id;
  }, [mutateLayout]);

  const updateFurnishing = useCallback((id, changes) => {
    mutateLayout(prev => ({
      ...prev,
      furnishings: (prev.furnishings || []).map(f => (f.id === id ? { ...f, ...changes } : f)),
    }));
  }, [mutateLayout]);

  const removeFurnishing = useCallback((id) => {
    mutateLayout(prev => ({
      ...prev,
      furnishings: (prev.furnishings || []).filter(f => f.id !== id),
    }));
  }, [mutateLayout]);

  const moveDoor = useCallback((roomId, side, delta) => {
    mutateLayout(prev => {
      const doors = (prev.doors || []).map(d => {
        if (d.roomId !== roomId || d.side !== side) return d;
        if (d.horizontal) return { ...d, x: Math.round((d.x + delta) * 10) / 10 };
        return { ...d, y: Math.round((d.y + delta) * 10) / 10 };
      });
      return { ...prev, doors };
    });
  }, [mutateLayout]);

  const removeDoor = useCallback((roomId, side) => {
    mutateLayout(prev => ({
      ...prev,
      doors: (prev.doors || []).filter(d => !(d.roomId === roomId && d.side === side)),
    }));
  }, [mutateLayout]);

  const moveWindow = useCallback((roomId, side, delta) => {
    mutateLayout(prev => {
      const windows = (prev.windows || []).map(w => {
        if (w.roomId !== roomId || w.side !== side) return w;
        if (w.horizontal) return { ...w, x: Math.round((w.x + delta) * 10) / 10 };
        return { ...w, y: Math.round((w.y + delta) * 10) / 10 };
      });
      return { ...prev, windows };
    });
  }, [mutateLayout]);

  const removeWindow = useCallback((roomId, side) => {
    mutateLayout(prev => ({
      ...prev,
      windows: (prev.windows || []).filter(w => !(w.roomId === roomId && w.side === side)),
    }));
  }, [mutateLayout]);

  const duplicateFurnishing = useCallback((id) => {
    const newId = newFurnishingId('dup');
    mutateLayout(prev => {
      const src = (prev.furnishings || []).find(f => f.id === id);
      if (!src) return prev;
      const copy = { ...src, id: newId, x: Math.round((src.x + 1.5) * 10) / 10, y: Math.round((src.y + 1.5) * 10) / 10 };
      return { ...prev, furnishings: [...prev.furnishings, copy] };
    });
    return newId;
  }, [mutateLayout]);

  // ---------------------------------------------------------------------------
  // Freeform layout handlers
  // ---------------------------------------------------------------------------

  const _freeformIdSeqRef = useRef(0);
  const nextFreeformId = useCallback(() => `ff_${++_freeformIdSeqRef.current}`, []);

  const snapVal = useCallback((v) => {
    if (!snapToGrid) return Math.round(v * 10) / 10;
    return Math.round(v * 2) / 2; // nearest 0.5 ft
  }, [snapToGrid]);

  const setFreeformBoundary = useCallback((preset, totalAreaFtVal) => {
    const area = totalAreaFtVal || totalAreaFt;
    const side = Math.sqrt(area);
    let pts;
    switch (preset) {
      case 'rectangle':
        pts = rectToPolygon(0, 0, side * 1.2, side / 1.2);
        break;
      case 'l-shape':
        pts = lShapePolygon(0, 0, side * 1.2, side / 1.2, 0.4);
        break;
      case 'circle': {
        const r = Math.sqrt(area / Math.PI);
        const b = polyBbox(regularPolygon(0, 0, r, 40));
        const center = [b.w / 2, b.h / 2];
        pts = regularPolygon(center[0], center[1], r, 40);
        break;
      }
      default:
        return; // 'custom' — user draws it
    }
    const boundary = { id: 'boundary_0', type: 'boundary', points: pts };
    setFreeformBoundaryState(boundary);
    setFreeformRoomsState([]);
    setFreeformWarnings([]);
  }, [totalAreaFt]);

  const setFreeformBoundaryPolygon = useCallback((pts) => {
    if (!pts || pts.length < 3) return;
    const boundary = { id: 'boundary_0', type: 'boundary', points: pts.map(([x, y]) => ({ x, y })) };
    setFreeformBoundaryState(boundary);
    setFreeformRoomsState([]);
    setFreeformWarnings([]);
  }, []);

  const addFreeformRectRoom = useCallback((roomType, rtDef) => {
    if (!freeformBoundary) return;
    const bPts = freeformBoundary.points.map(p => [p.x, p.y]);
    const c = polyCentroid(bPts);
    const existingCount = freeformRooms.length;
    const offset = existingCount * 2;
    const w = rtDef ? Math.sqrt(rtDef.defaultArea) * 1.1 : 12;
    const h = rtDef ? rtDef.defaultArea / w : 10;
    const pts = rectToPolygon(
      snapVal(c[0] - w / 2 + offset),
      snapVal(c[1] - h / 2 + offset),
      snapVal(w),
      snapVal(h),
    ).map(([x, y]) => ({ x, y }));
    const room = {
      id: nextFreeformId(),
      name: rtDef ? rtDef.label : roomType,
      roomType,
      color: rtDef ? rtDef.color : '#cccccc',
      points: pts,
      rotation: 0,
    };
    setFreeformRoomsState(prev => [...prev, room]);
  }, [freeformBoundary, freeformRooms, snapVal, nextFreeformId]);

  const addFreeformPolygonRoom = useCallback((roomType, rtDef, pts) => {
    if (!pts || pts.length < 3) return;
    const roomPts = pts.map(([x, y]) => ({ x: snapVal(x), y: snapVal(y) }));
    const room = {
      id: nextFreeformId(),
      name: rtDef ? rtDef.label : roomType,
      roomType,
      color: rtDef ? rtDef.color : '#cccccc',
      points: roomPts,
      rotation: 0,
    };
    setFreeformRoomsState(prev => [...prev, room]);
  }, [snapVal, nextFreeformId]);

  // Live update handlers — update freeformRooms directly for visual feedback.
  // These do NOT push to history; commitFreeformEdit handles that on pointerup.
  const liveMoveFreeformRoom = useCallback((roomId, dx, dy) => {
    setFreeformRoomsState(prev => prev.map(r => {
      if (r.id !== roomId) return r;
      return { ...r, points: r.points.map(p => ({ x: snapVal(p.x + dx), y: snapVal(p.y + dy) })) };
    }));
  }, [snapVal]);

  const liveReshapeFreeformVertex = useCallback((roomId, vertexIndex, x, y) => {
    setFreeformRoomsState(prev => prev.map(r => {
      if (r.id !== roomId) return r;
      const newPts = r.points.map((p, i) => i === vertexIndex ? { x: snapVal(x), y: snapVal(y) } : { ...p });
      if (isSelfIntersecting(newPts.map(p => [p.x, p.y]))) return r;
      return { ...r, points: newPts };
    }));
  }, [snapVal]);

  const liveRotateFreeformRoom = useCallback((roomId, angleDelta) => {
    setFreeformRoomsState(prev => prev.map(r => {
      if (r.id !== roomId) return r;
      const c = polyCentroid(r.points.map(p => [p.x, p.y]));
      const cos = Math.cos(angleDelta), sin = Math.sin(angleDelta);
      const newPts = r.points.map(p => {
        const dx = p.x - c[0], dy = p.y - c[1];
        return { x: snapVal(c[0] + dx * cos - dy * sin), y: snapVal(c[1] + dx * sin + dy * cos) };
      });
      if (isSelfIntersecting(newPts.map(p => [p.x, p.y]))) return r;
      return { ...r, points: newPts, rotation: r.rotation + angleDelta };
    }));
  }, [snapVal]);

  const deleteFreeformRoom = useCallback((roomId) => {
    setFreeformRoomsState(prev => prev.filter(r => r.id !== roomId));
  }, []);

  const updateFreeformRoomProps = useCallback((roomId, props) => {
    setFreeformRoomsState(prev => prev.map(r => r.id === roomId ? { ...r, ...props } : r));
  }, []);

  // Commit freeform edits to history (called on pointerup / drag-end).
  const commitFreeformEdit = useCallback(() => {
    if (!freeformBoundary) return;
    finalizeFreeformLayout();
  }, [freeformBoundary, freeformRooms]);

  // Finalize freeform layout: convert freeform state → canonical layout.
  const finalizeFreeformLayout = useCallback(() => {
    if (!freeformBoundary || freeformRooms.length === 0) return;

    const bPts = freeformBoundary.points.map(p => [p.x, p.y]);
    const bBbox = polyBbox(bPts);
    const boundaryObj = {
      width: bBbox.w,
      height: bBbox.h,
      polygon: bPts,
    };

    const MIN_AREA = 0.5;
    const warnings = [];

    const roomCells = freeformRooms
      .filter(r => {
        const a = polyArea(r.points.map(p => [p.x, p.y]));
        if (a < MIN_AREA) {
          warnings.push(`Room "${r.name}" dropped (area ${a.toFixed(1)} sqft < ${MIN_AREA} sqft minimum)`);
          return false;
        }
        return true;
      })
      .map(r => {
        const pts = r.points.map(p => [p.x, p.y]);
        return createRoomCell({
          id: r.id,
          roomType: r.roomType,
          label: r.name,
          polygon: pts,
          targetArea: polyArea(pts),
          color: r.color,
        });
      });

    // Convert to flat format for generateWalls.
    const roomsForWalls = roomCells.map(r => ({
      id: r.id,
      x: r.x, y: r.y, w: r.w, h: r.h,
      type: r.roomType,
      polygon: r.polygon,
    }));

    const { walls, doors, windows } = generateWalls(roomsForWalls, boundaryObj);
    const furnishings = defaultFurnishings(roomCells, doors);

    // Reachability check.
    const reachability = checkReachability(roomCells);
    if (!reachability.reachable) {
      warnings.push(`Some rooms are unreachable from the entry: ${reachability.violations.join(', ')}`);
    }

    const newLayout = {
      footprint: { polygon: bPts, width: bBbox.w, height: bBbox.h },
      boundary: boundaryObj,
      rooms: roomCells,
      walls,
      doors,
      windows,
      furnishings,
      isFreeform: true,
    };

    setFreeformWarnings(warnings);
    setLayout(newLayout, true);
  }, [freeformBoundary, freeformRooms, setLayout]);

  const toggleSnap = useCallback(() => setSnapToGrid(prev => !prev), []);

  // Generate layout variants (new: generates multiple options)
  const generateLayoutVariants = useCallback(() => {
    const specs = roomSpecs
      .filter(r => r.count > 0)
      .map(r => ({
        type: r.type,
        label: r.label,
        color: r.color,
        area: unit === 'sqm' ? r.area * SQM_TO_SQFT : r.area,
        count: r.count,
        aspectTarget: ROOM_TYPES.find(t => t.id === r.type)?.aspectTarget || 1.2,
      }));

    if (specs.length === 0) return;

    const variants = generateVariants(totalAreaFt, specs);
    setLayoutVariants(variants);
    setSelectedLayoutIndex(0);

    // Set the first variant as the current layout
    if (variants.length > 0) {
      const firstLayout = variants[0].layout;
      setLayout(firstLayout, true);
    }
  }, [roomSpecs, totalAreaFt, unit]);

  // Apply a selected variant
  const applyVariant = useCallback((index) => {
    if (layoutVariants[index]) {
      const variantLayout = layoutVariants[index].layout;
      setLayout(variantLayout, true);
      setSelectedLayoutIndex(index);
    }
  }, [layoutVariants]);

  // Apply NLP result from prompt
  const applyNlpResult = useCallback((nlpResult) => {
    if (nlpResult && nlpResult.success) {
      setRoomSpecs(nlpResult.roomSpecs);
      if (nlpResult.extracted.totalArea) {
        setTotalArea(nlpResult.extracted.totalArea);
      }
      setExtractedStyle(nlpResult.extracted.style || 'modern');
      setExtractedDirection(nlpResult.extracted.direction);
      setStep(2); // Go to room config
    }
  }, []);

  // Apply theme to current layout
  const applyTheme = useCallback((themeId) => {
    setSelectedTheme(themeId);
  }, []);

  // ---------------------------------------------------------------------------
  // Automated (AI) design
  // ---------------------------------------------------------------------------

  /**
   * Run the full auto-design pipeline for a description and land the user on
   * the finished plan.  Everything between the prompt and the 2D/3D view —
   * room schedule, layout search, theme, furniture — is decided by the engine.
   */
  const startAutoDesign = useCallback(async (prompt, seed) => {
    const text = (prompt ?? promptText ?? '').trim();
    if (!text) {
      setAiError('Describe the property first.');
      return null;
    }

    setDesignMode('ai');
    setPromptText(text);
    setAiRunning(true);
    setAiError(null);
    setAiProgress({ stageId: PIPELINE_STAGES[0].id, index: 0, total: PIPELINE_STAGES.length, info: null });

    try {
      const result = await runAutoDesign(text, {
        seed,
        onProgress: (stageId, index, total, info) => {
          setAiProgress({ stageId, index, total, info });
        },
      });

      if (!result.ok) {
        setAiError(result.error);
        setAiRunning(false);
        setAiProgress(null);
        return null;
      }

      // Push every derived decision back into the normal editing state, so the
      // user can drop into manual mode from here and everything lines up.
      setAiResult(result);
      setRoomSpecs(result.brief.roomSpecs);
      setTotalArea(result.brief.totalAreaFt);
      setUnit('sqft');
      setExtractedStyle(result.brief.style);
      setExtractedDirection(result.brief.direction);
      setSelectedTheme(result.theme);
      setLayoutVariants(result.variants);
      setSelectedLayoutIndex(0);
      setLayout(result.layout, true);
      setSelectedRoomId(null);
      setStep(5);

      setAiRunning(false);
      setAiProgress(null);
      return result;
    } catch (e) {
      console.error('Auto-design failed:', e);
      setAiError('The designer hit an unexpected error. Try adjusting your description.');
      setAiRunning(false);
      setAiProgress(null);
      return null;
    }
  }, [promptText, setLayout]);

  /** Re-run the pipeline with a fresh seed — a different plan, same brief. */
  const regenerateAutoDesign = useCallback(() => {
    return startAutoDesign(promptText, (Date.now() | 0));
  }, [startAutoDesign, promptText]);

  /** Switch the plan to one of the ranked alternatives the AI kept. */
  const applyAiVariant = useCallback((index) => {
    const variant = layoutVariants[index];
    if (!variant) return;
    setLayout(variant.layout, true);
    setSelectedLayoutIndex(index);
    setSelectedRoomId(null);
  }, [layoutVariants, setLayout]);

  /** Leave AI mode and hand control back to the step-by-step flow. */
  const startManualDesign = useCallback((nlpResult) => {
    setDesignMode('manual');
    setAiResult(null);
    setAiError(null);
    if (nlpResult && nlpResult.success) {
      applyNlpResult(nlpResult);
    } else {
      setStep(1);
    }
  }, [applyNlpResult]);

  const updateRoomSpec = useCallback((type, field, value) => {
    setRoomSpecs(prev => prev.map(r =>
      r.type === type ? { ...r, [field]: value } : r
    ));
  }, []);

  const incrementRoom = useCallback((type) => {
    setRoomSpecs(prev => prev.map(r =>
      r.type === type ? { ...r, count: Math.min(r.count + 1, 5) } : r
    ));
  }, []);

  const decrementRoom = useCallback((type) => {
    setRoomSpecs(prev => prev.map(r =>
      r.type === type ? { ...r, count: Math.max(r.count - 1, 0) } : r
    ));
  }, []);

  const convertArea = useCallback((value) => {
    if (unit === 'sqm') return Math.round(value * SQFT_TO_SQM * 10) / 10;
    return Math.round(value);
  }, [unit]);

  const goNext = useCallback(() => {
    if (step === 0) setStep(1);
    else if (step === 1) setStep(2);
    else if (step === 2) {
      generateLayoutVariants();
      setStep(3);
    }
    else if (step === 3) {
      // Layout selected, go to theme selection
      setStep(4);
    }
    else if (step === 4) {
      // Theme selected, go to final plan view
      setStep(5);
    }
  }, [step, generateLayoutVariants]);

  const goBack = useCallback(() => {
    if (step > 0) setStep(step - 1);
  }, [step]);

  // Save / Load (localStorage)
  const STORAGE_KEY = 'floorplan_autosave';

  const saveToLocal = useCallback(() => {
    const data = {
      step, totalArea, unit, roomSpecs, layout, selectedTheme, extractedStyle,
      freeformBoundary, freeformRooms, activeTool, snapToGrid,
      designMode, promptText,
      // Persist the report but not the alternative layouts — those are large
      // and cheap to regenerate, and would risk blowing the storage quota.
      aiSummary: aiResult ? {
        score: aiResult.score,
        strengths: aiResult.strengths,
        weaknesses: aiResult.weaknesses,
        decisions: aiResult.decisions,
        stats: aiResult.stats,
        theme: aiResult.theme,
        brief: { ...aiResult.brief, roomSpecs: undefined },
      } : null,
      version: SCHEMA_VERSION,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save:', e);
    }
  }, [step, totalArea, unit, roomSpecs, layout, selectedTheme, extractedStyle,
      freeformBoundary, freeformRooms, activeTool, snapToGrid,
      designMode, promptText, aiResult]);

  const loadFromLocal = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.version) return false;

      if (data.step) setStep(data.step);
      if (data.totalArea) setTotalArea(data.totalArea);
      if (data.unit) setUnit(data.unit);
      if (data.selectedTheme) setSelectedTheme(data.selectedTheme);
      if (data.extractedStyle) setExtractedStyle(data.extractedStyle);
      if (data.designMode) setDesignMode(data.designMode);
      if (data.promptText) setPromptText(data.promptText);
      // The saved report has no `variants` — the alternatives UI hides itself
      // when the list is empty, so the rest of the report still renders.
      if (data.aiSummary) setAiResult({ ...data.aiSummary, ok: true, variants: [] });

      // Restore freeform state
      if (data.freeformBoundary) setFreeformBoundaryState(data.freeformBoundary);
      if (data.freeformRooms) {
        setFreeformRoomsState(data.freeformRooms);
        const maxId = data.freeformRooms.reduce((max, r) => {
          const m = r.id && r.id.match(/^ff_(\d+)$/);
          return m ? Math.max(max, parseInt(m[1], 10)) : max;
        }, 0);
        if (maxId >= _freeformIdSeqRef.current) _freeformIdSeqRef.current = maxId;
      }
      if (data.activeTool) setActiveTool(data.activeTool);
      if (data.snapToGrid !== undefined) setSnapToGrid(data.snapToGrid);

      // --- Schema migration ---
      if (data.version < SCHEMA_VERSION && data.layout) {
        // Migrate rooms to the new RoomCell shape with polygon + bbox getters.
        // Clear undo history — the old entries are incompatible shapes.
        data.layout.rooms = (data.layout.rooms || []).map(r =>
          r.polygon ? r : migrateLegacyRoom(r),
        );
        // Re-derive walls from the migrated rooms so they are consistent.
        const { walls, doors, windows } = generateWalls(
          data.layout.rooms.map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, type: r.roomType })),
          data.layout.boundary,
        );
        data.layout.walls = walls;
        data.layout.doors = doors;
        data.layout.windows = windows;

        if (data.roomSpecs) setRoomSpecs(data.roomSpecs);
        setLayoutState(data.layout);
        setHistory([data.layout]);
        setHistoryIndex(0);
        return true;
      }

      // --- Current version: direct restore ---
      if (data.roomSpecs) setRoomSpecs(data.roomSpecs);
      if (data.layout) {
        setLayoutState(data.layout);
        setHistory([data.layout]);
        setHistoryIndex(0);
      }
      return true;
    } catch (e) {
      console.warn('Failed to load:', e);
      return false;
    }
  }, []);

  const clearLocal = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    if (layout) saveToLocal();
  }, [layout, saveToLocal]);

  return {
    step, setStep,
    totalArea, setTotalArea,
    unit, setUnit,
    roomSpecs,
    activeRooms,
    totalUsedArea,
    areaRemaining,
    areaPercent,
    displayUnit,
    totalAreaFt,
    layout, setLayout,
    selectedRoomId, setSelectedRoomId,
    generateLayout: generateLayoutVariants,
    updateRoomSpec,
    incrementRoom,
    decrementRoom,
    convertArea,
    moveRoom,
    swapRooms,
    editRoom,
    rotateRoom,
    updateRoomProps,
    addFurnishing,
    updateFurnishing,
    removeFurnishing,
    duplicateFurnishing,
    moveDoor,
    removeDoor,
    moveWindow,
    removeWindow,
    undo, redo, canUndo, canRedo,
    goNext, goBack,
    saveToLocal, loadFromLocal, clearLocal,
    // New AI agent features
    promptText, setPromptText,
    extractedStyle, setExtractedStyle,
    extractedDirection, setExtractedDirection,
    layoutVariants, setLayoutVariants,
    selectedLayoutIndex, setSelectedLayoutIndex,
    selectedTheme, setSelectedTheme,
    applyNlpResult,
    applyVariant,
    applyTheme,
    // Automated (AI) design
    designMode, setDesignMode,
    aiRunning, aiProgress, aiResult, aiError,
    startAutoDesign,
    regenerateAutoDesign,
    applyAiVariant,
    startManualDesign,
    // Freeform layout
    freeformBoundary,
    freeformRooms,
    drawingMode, setDrawingMode,
    activeTool, setActiveTool,
    snapToGrid,
    freeformWarnings,
    setFreeformBoundary,
    setFreeformBoundaryPolygon,
    addFreeformRectRoom,
    addFreeformPolygonRoom,
    liveMoveFreeformRoom,
    liveReshapeFreeformVertex,
    liveRotateFreeformRoom,
    deleteFreeformRoom,
    updateFreeformRoomProps,
    commitFreeformEdit,
    finalizeFreeformLayout,
    toggleSnap,
  };
}
