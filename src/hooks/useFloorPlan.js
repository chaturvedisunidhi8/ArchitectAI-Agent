import { useState, useCallback, useMemo, useEffect } from 'react';
import { ROOM_TYPES, SQFT_TO_SQM, SQM_TO_SQFT } from '../engine/constants.js';
import { generateWalls } from '../engine/geometry.js';
import { defaultFurnishings, newFurnishingId } from '../engine/furniture.js';
import { generateVariants } from '../engine/layoutVariants.js';
import { getTheme } from '../engine/themes.js';

function withWalls(layout, rooms) {
  const { walls, doors, windows } = generateWalls(
    rooms.map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, type: r.type })),
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
    if (!layout) return;
    const data = { step, totalArea, unit, roomSpecs, layout, selectedTheme, extractedStyle, version: 2 };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('Failed to save:', e);
    }
  }, [step, totalArea, unit, roomSpecs, layout, selectedTheme, extractedStyle]);

  const loadFromLocal = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data.version) return false;
      if (data.step) setStep(data.step);
      if (data.totalArea) setTotalArea(data.totalArea);
      if (data.unit) setUnit(data.unit);
      if (data.roomSpecs) setRoomSpecs(data.roomSpecs);
      if (data.selectedTheme) setSelectedTheme(data.selectedTheme);
      if (data.extractedStyle) setExtractedStyle(data.extractedStyle);
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
  };
}
