import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { buildModel, buildLabels } from '../engine/model3d.js';
import { catalogByCategory, CATALOG } from '../engine/furniture.js';
import { getTheme } from '../engine/themes.js';

const RECOLOR_SWATCHES = [
  '#c9b7a0', '#8a5a37', '#b06a55', '#7c8895', '#4a7c59', '#5b6ee1',
  '#d4874d', '#b84a4a', '#33383e', '#f3f2ee', '#c9a24a', '#6b4f8a',
];

const ROOM_COLORS = [
  '#E8D5B7', '#B7D5E8', '#D5E8B7', '#E8E0D0', '#E0D5E8', '#D0E8D5',
  '#D5D5D5', '#E8D5D5', '#E8E0B7', '#B7E0E8', '#C8C8C8', '#B7E8C0',
  '#F5E6D0', '#D0E6F5', '#E6F5D0', '#F5D0E6', '#D0F5E6', '#F5F5D0',
];

const FLOOR_TYPES = [
  { value: null, label: 'Default' },
  { value: 'wood', label: 'Wood' },
  { value: 'tile', label: 'Tile' },
  { value: 'marble', label: 'Marble' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'grass', label: 'Grass' },
];

const FloorPlan3D = forwardRef(function FloorPlan3D({ layout, editor, theme }, ref) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const groupsRef = useRef(null);
  const labelsRef = useRef(null);
  const apiRef = useRef(null);
  const modeRef = useRef('orbit');

  // persisted across scene rebuilds
  const orbitStateRef = useRef(null);
  const walkStateRef = useRef(null);
  const selectionRef = useRef(null);   // { type, id }
  const editorRef = useRef(editor);
  const layoutRef = useRef(layout);
  editorRef.current = editor;
  layoutRef.current = layout;

  const [cameraMode, setCameraMode] = useState('orbit');
  const [showRoof, setShowRoof] = useState(false);
  const [showCeiling, setShowCeiling] = useState(false);
  const [showFurniture, setShowFurniture] = useState(true);
  const [selection, setSelection] = useState(null);   // { type, id }
  const [gizmoMode, setGizmoMode] = useState('translate');
  const [showCatalog, setShowCatalog] = useState(false);
  const [timeOfDay, setTimeOfDay] = useState(12); // 0-24 hours
  const [cameraPreset, setCameraPreset] = useState('orbit'); // orbit, walk, birdsEye, roomView

  const gizmoModeRef = useRef(gizmoMode);
  gizmoModeRef.current = gizmoMode;

  const lightsRef = useRef(null); // { sun, ambient, hemi }

  useImperativeHandle(ref, () => ({ getScene: () => sceneRef.current }));

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !layout) return;

    const width = mount.clientWidth || 800;
    const height = mount.clientHeight || 600;
    const { boundary, rooms } = layout;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef1f4);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);
    const canvas = renderer.domElement;

    // lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8f8a7f, 0.55);
    scene.add(hemi);
    const ambient = new THREE.AmbientLight(0xfff4e6, 0.25);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff0dd, 1.0);
    const span = Math.max(boundary.width, boundary.height);
    sun.position.set(boundary.width * 0.6, span * 1.4, -boundary.height * 0.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = span * 4;
    sun.shadow.camera.left = -span; sun.shadow.camera.right = span;
    sun.shadow.camera.top = span; sun.shadow.camera.bottom = -span;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    lightsRef.current = { sun, ambient, hemi };

    const cx = boundary.width / 2;
    const cz = boundary.height / 2;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(boundary.width + 40, boundary.height + 40),
      new THREE.MeshStandardMaterial({ color: 0xdad6cc, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.55, cz);
    ground.receiveShadow = true;
    scene.add(ground);

    const themeData = theme ? getTheme(theme) : null;
    const { root, groups, dispose } = buildModel(layout, { forExport: false, themeData });
    groupsRef.current = groups;
    groups.roof.visible = showRoof;
    groups.ceilings.visible = showCeiling;
    groups.furniture.visible = showFurniture;
    scene.add(root);

    const labelGroup = new THREE.Group();
    labelGroup.name = 'Labels';
    buildLabels(rooms).forEach((s) => labelGroup.add(s));
    labelGroup.visible = modeRef.current === 'orbit';
    labelsRef.current = labelGroup;
    scene.add(labelGroup);

    // ---------------- selection + editing ----------------
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let selectedObj = null;
    let helper = null;

    const tc = new TransformControls(camera, canvas);
    tc.setSize(0.8);
    tc.addEventListener('dragging-changed', (e) => { draggingGizmo = e.value; });
    tc.addEventListener('mouseUp', () => commitTransform());
    scene.add(tc);
    let draggingGizmo = false;

    const applyGizmoAxes = () => {
      const sel = selectionRef.current;
      if (!sel) return;
      if (sel.type === 'room') {
        tc.setMode('translate');
        tc.showX = true; tc.showY = false; tc.showZ = true;
        return;
      }
      const mode = gizmoModeRef.current;
      tc.setMode(mode);
      if (mode === 'translate') { tc.showX = true; tc.showY = false; tc.showZ = true; }
      else if (mode === 'rotate') { tc.showX = false; tc.showY = true; tc.showZ = false; }
      else { tc.showX = true; tc.showY = true; tc.showZ = true; }
    };

    const setHelper = (obj) => {
      if (helper) { scene.remove(helper); helper.geometry.dispose(); helper = null; }
      if (obj) { helper = new THREE.BoxHelper(obj, 0xc8956c); scene.add(helper); }
    };

    const selectObject = (obj, type, id) => {
      selectedObj = obj;
      selectionRef.current = { type, id };
      setSelection({ type, id });
      tc.attach(obj);
      tc.visible = true;
      applyGizmoAxes();
      setHelper(obj);
    };

    const deselect = () => {
      selectedObj = null;
      selectionRef.current = null;
      setSelection(null);
      tc.detach();
      tc.visible = false;
      setHelper(null);
    };

    const findSelectable = (object) => {
      let o = object;
      while (o) {
        if (o.userData && o.userData.selectable) return o;
        o = o.parent;
      }
      return null;
    };

    const pick = (e) => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects([groups.furniture, groups.floors, groups.doors, groups.windows], true);
      for (const h of hits) {
        const node = findSelectable(h.object);
        if (node) {
          return { node, type: node.userData.selectable, id: node.userData.furnishingId || node.userData.roomId };
        }
      }
      return null;
    };

    const groundPoint = (e) => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      const p = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, p);
      return p;
    };

    const commitTransform = () => {
      const sel = selectionRef.current;
      if (!sel || !selectedObj) return;
      const ed = editorRef.current;
      if (sel.type === 'furniture') {
        const s = (selectedObj.scale.x + selectedObj.scale.y + selectedObj.scale.z) / 3;
        ed.updateFurnishing(sel.id, {
          x: Math.round(selectedObj.position.x * 10) / 10,
          y: Math.round(selectedObj.position.z * 10) / 10,
          rot: selectedObj.rotation.y,
          scale: Math.round(Math.max(0.2, s) * 100) / 100,
        });
      } else if (sel.type === 'room') {
        const room = layoutRef.current.rooms.find(r => r.id === sel.id);
        if (room) ed.editRoom(sel.id, { x: selectedObj.position.x - room.w / 2, y: selectedObj.position.z - room.h / 2 });
      }
    };

    // ---------------- camera state ----------------
    const maxDim = Math.max(boundary.width, boundary.height);
    const orbit = orbitStateRef.current || { radius: maxDim * 1.5, theta: Math.PI / 4, phi: Math.PI / 3.2 };
    orbitStateRef.current = orbit;
    const target = new THREE.Vector3(cx, 0, cz);
    const updateOrbit = () => {
      camera.position.set(
        target.x + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta),
        target.y + orbit.radius * Math.cos(orbit.phi),
        target.z + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta),
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
    };

    const walk = walkStateRef.current || { x: cx, z: cz + maxDim * 0.4, yaw: Math.PI, pitch: -0.05 };
    walkStateRef.current = walk;
    const walkKeys = { f: 0, b: 0, l: 0, r: 0 };
    const updateWalk = () => {
      const speed = 0.22;
      const dx = Math.sin(walk.yaw), dz = Math.cos(walk.yaw);
      const sx = Math.sin(walk.yaw + Math.PI / 2), sz = Math.cos(walk.yaw + Math.PI / 2);
      const mv = walkKeys.f - walkKeys.b, st = walkKeys.r - walkKeys.l;
      walk.x = Math.max(-3, Math.min(boundary.width + 3, walk.x + (dx * mv + sx * st) * speed));
      walk.z = Math.max(-3, Math.min(boundary.height + 3, walk.z + (dz * mv + sz * st) * speed));
      camera.position.set(walk.x, 5.5, walk.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(walk.x + Math.sin(walk.yaw) * Math.cos(walk.pitch), 5.5 + Math.sin(walk.pitch), walk.z + Math.cos(walk.yaw) * Math.cos(walk.pitch));
    };
    updateOrbit();

    // ---------------- pointer handling ----------------
    let orbiting = false, lastX = 0, lastY = 0;
    let freeDrag = null; // { type, id, moved }

    const onDown = (e) => {
      if (modeRef.current !== 'orbit') return;
      if (draggingGizmo || tc.axis) return;   // gizmo has priority
      const hit = pick(e);
      if (hit) {
        selectObject(hit.node, hit.type, hit.id);
        freeDrag = { type: hit.type, id: hit.id, moved: false };
      } else {
        deselect();
        orbiting = true; lastX = e.clientX; lastY = e.clientY;
      }
    };
    const onMove = (e) => {
      if (modeRef.current !== 'orbit') return;
      if (freeDrag && selectedObj) {
        const p = groundPoint(e);
        if (p) {
          selectedObj.position.x = Math.max(0, Math.min(boundary.width, p.x));
          selectedObj.position.z = Math.max(0, Math.min(boundary.height, p.z));
          freeDrag.moved = true;
          if (helper) helper.update();
        }
        return;
      }
      if (orbiting && !draggingGizmo) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        orbit.theta -= dx * 0.005;
        orbit.phi = Math.min(Math.max(orbit.phi - dy * 0.005, 0.12), Math.PI / 2 - 0.03);
        updateOrbit();
      }
    };
    const onUp = () => {
      if (freeDrag) {
        if (freeDrag.moved) commitTransform();
        freeDrag = null;
      }
      orbiting = false;
    };
    const onWheel = (e) => {
      if (modeRef.current !== 'orbit') return;
      orbit.radius = Math.min(Math.max(orbit.radius + e.deltaY * 0.02, maxDim * 0.2), maxDim * 4);
      updateOrbit();
      e.preventDefault();
    };

    // walk look
    const onCanvasClick = () => { if (modeRef.current === 'walk') canvas.requestPointerLock?.(); };
    const onLook = (e) => {
      if (modeRef.current !== 'walk' || document.pointerLockElement !== canvas) return;
      walk.yaw -= e.movementX * 0.0025;
      walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - e.movementY * 0.0025));
    };
    const keyMap = { w: 'f', s: 'b', a: 'l', d: 'r', arrowup: 'f', arrowdown: 'b', arrowleft: 'l', arrowright: 'r' };
    const onKeyDown = (e) => {
      if (modeRef.current === 'walk') {
        const k = keyMap[e.key.toLowerCase()];
        if (k) { walkKeys[k] = 1; e.preventDefault(); return; }
      }
      if (modeRef.current === 'orbit' && selectionRef.current) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (selectionRef.current.type === 'furniture') { editorRef.current.removeFurnishing(selectionRef.current.id); deselect(); }
        } else if (e.key === 'Escape') {
          deselect();
        } else if (e.key === 'g') setGizmoMode('translate');
        else if (e.key === 'r') setGizmoMode('rotate');
        else if (e.key === 't') setGizmoMode('scale');
      }
    };
    const onKeyUp = (e) => { const k = keyMap[e.key.toLowerCase()]; if (k) walkKeys[k] = 0; };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('click', onCanvasClick);
    document.addEventListener('mousemove', onLook);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    apiRef.current = {
      enterOrbit: () => {
        modeRef.current = 'orbit';
        setCameraPreset('orbit');
        if (document.pointerLockElement === canvas) document.exitPointerLock?.();
        if (labelsRef.current) labelsRef.current.visible = true;
        tc.enabled = true; tc.visible = !!selectedObj;
        updateOrbit();
      },
      enterWalk: () => {
        modeRef.current = 'walk';
        setCameraPreset('walk');
        if (labelsRef.current) labelsRef.current.visible = false;
        tc.enabled = false; tc.visible = false;
        updateWalk();
      },
      enterBirdsEye: () => {
        modeRef.current = 'orbit';
        setCameraPreset('birdsEye');
        if (document.pointerLockElement === canvas) document.exitPointerLock?.();
        if (labelsRef.current) labelsRef.current.visible = true;
        tc.enabled = false; tc.visible = false;
        // Bird's eye: high Y, looking straight down
        camera.position.set(cx, Math.max(boundary.width, boundary.height) * 1.5, cz);
        camera.up.set(0, 0, -1);
        camera.lookAt(cx, 0, cz);
        orbit.radius = Math.max(boundary.width, boundary.height) * 1.5;
        orbit.phi = 0.05; // nearly top-down
        orbit.theta = 0;
      },
      enterRoomView: () => {
        modeRef.current = 'orbit';
        setCameraPreset('roomView');
        if (document.pointerLockElement === canvas) document.exitPointerLock?.();
        if (labelsRef.current) labelsRef.current.visible = true;
        tc.enabled = true; tc.visible = !!selectedObj;
        // Default: look from one corner into the house
        camera.position.set(-5, 6, -5);
        camera.up.set(0, 1, 0);
        camera.lookAt(cx, 3, cz);
        orbit.radius = maxDim * 0.6;
        orbit.phi = Math.PI / 3.5;
        orbit.theta = Math.PI / 4;
      },
      screenshot: () => {
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'floor-plan-3d.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      },
      reselect: () => {
        const sel = selectionRef.current;
        if (!sel) return;
        let found = null;
        const target2 = sel.type === 'furniture' ? groups.furniture : groups.floors;
        target2.traverse((o) => {
          if (found) return;
          if (o.userData && (o.userData.furnishingId === sel.id || o.userData.roomId === sel.id)) found = o;
        });
        if (found) { selectObject(found, sel.type, sel.id); } else { deselect(); }
      },
      setGizmo: () => applyGizmoAxes(),
    };
    if (modeRef.current === 'walk') apiRef.current.enterWalk(); else apiRef.current.enterOrbit();
    apiRef.current.reselect();

    let frameId;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      if (modeRef.current === 'walk') updateWalk();
      if (helper) helper.update();
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('mousemove', onLook);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onCanvasClick);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      if (helper) { scene.remove(helper); helper.geometry.dispose(); }
      tc.detach(); tc.dispose();
      dispose();
      ground.geometry.dispose(); ground.material.dispose();
      labelGroup.traverse((o) => { if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
      if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      renderer.dispose();
      sceneRef.current = null; groupsRef.current = null; apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  useEffect(() => {
    if (!apiRef.current) return;
    if (cameraMode === 'walk') apiRef.current.enterWalk();
    else if (cameraMode === 'birdsEye') apiRef.current.enterBirdsEye();
    else if (cameraMode === 'roomView') apiRef.current.enterRoomView();
    else apiRef.current.enterOrbit();
  }, [cameraMode]);

  useEffect(() => { apiRef.current?.setGizmo(); }, [gizmoMode]);

  // Time-of-day lighting
  useEffect(() => {
    const lights = lightsRef.current;
    if (!lights) return;
    const t = timeOfDay / 24; // 0..1
    const sunAngle = (t - 0.25) * Math.PI * 2; // noon at top
    const sunHeight = Math.sin(sunAngle);
    const sunHoriz = Math.cos(sunAngle);

    // Sun position
    const span = 30;
    lights.sun.position.set(span * sunHoriz, Math.max(0.5, span * sunHeight), -span * 0.4);

    // Intensity based on height
    const dayIntensity = Math.max(0, sunHeight);
    lights.sun.intensity = 0.3 + dayIntensity * 0.9;

    // Color temperature: warm at sunrise/sunset, white at noon
    const warmth = 1 - dayIntensity;
    lights.sun.color.setRGB(1, 0.95 - warmth * 0.15, 0.9 - warmth * 0.2);

    // Ambient
    lights.ambient.intensity = 0.1 + dayIntensity * 0.2;
    lights.ambient.color.setRGB(1, 0.98 - warmth * 0.1, 0.94 - warmth * 0.15);

    // Hemisphere
    lights.hemi.intensity = 0.2 + dayIntensity * 0.4;

    // Background color shifts with time
    if (sceneRef.current) {
      const nightBlue = new THREE.Color(0x1a2040);
      const dayBlue = new THREE.Color(0xeef1f4);
      const sunsetOrange = new THREE.Color(0xf0d8c0);
      let bgColor;
      if (dayIntensity < 0.1) bgColor = nightBlue;
      else if (dayIntensity < 0.3) bgColor = sunsetOrange.clone().lerp(nightBlue, (0.3 - dayIntensity) / 0.2);
      else if (dayIntensity < 0.5) bgColor = sunsetOrange.clone().lerp(dayBlue, (dayIntensity - 0.3) / 0.2);
      else bgColor = dayBlue;
      sceneRef.current.background = bgColor;
    }
  }, [timeOfDay]);

  useEffect(() => {
    const g = groupsRef.current;
    if (!g) return;
    g.roof.visible = showRoof;
    g.ceilings.visible = showCeiling;
    g.furniture.visible = showFurniture;
  }, [showRoof, showCeiling, showFurniture, layout]);

  // ---- derived selection detail ----
  const selFurn = selection?.type === 'furniture' ? (layout?.furnishings || []).find(f => f.id === selection.id) : null;
  const selRoom = selection?.type === 'room' ? (layout?.rooms || []).find(r => r.id === selection.id) : null;
  const selDoor = selection?.type === 'door' ? (layout?.doors || []).find(d => d.roomId === selection.id && d.side === selection.side) : null;
  const selWindow = selection?.type === 'window' ? (layout?.windows || []).find(w => w.roomId === selection.id && w.side === selection.side) : null;

  const addFromCatalog = (kind) => {
    const meta = CATALOG[kind];
    let x = layout.boundary.width / 2, y = layout.boundary.height / 2, roomId = null;
    if (selRoom) { x = selRoom.x + selRoom.w / 2; y = selRoom.y + selRoom.h / 2; roomId = selRoom.id; }
    else if (selFurn) { x = selFurn.x + 1.5; y = selFurn.y + 1.5; roomId = selFurn.roomId; }
    const id = editor.addFurnishing(kind, x, y, roomId);
    selectionRef.current = { type: 'furniture', id };
    setSelection({ type: 'furniture', id });
    setShowCatalog(false);
  };

  const catalog = catalogByCategory();

  return (
    <div className="three-wrap">
      <div ref={mountRef} className="three-container" />

      <div className="vp-controls">
        <div className="vp-group">
          <span className="vp-label">Camera</span>
          <div className="toggle-group">
            <button className={`toggle-btn ${cameraMode === 'orbit' ? 'active' : ''}`} onClick={() => setCameraMode('orbit')}>Orbit</button>
            <button className={`toggle-btn ${cameraMode === 'walk' ? 'active' : ''}`} onClick={() => setCameraMode('walk')}>Walk</button>
            <button className={`toggle-btn ${cameraMode === 'birdsEye' ? 'active' : ''}`} onClick={() => setCameraMode('birdsEye')} title="Top-down view">Top</button>
            <button className={`toggle-btn ${cameraMode === 'roomView' ? 'active' : ''}`} onClick={() => setCameraMode('roomView')} title="Interior perspective">Room</button>
          </div>
        </div>
        <div className="vp-group">
          <span className="vp-label">Show</span>
          <label className="vp-check"><input type="checkbox" checked={showFurniture} onChange={(e) => setShowFurniture(e.target.checked)} /> Furniture</label>
          <label className="vp-check"><input type="checkbox" checked={showCeiling} onChange={(e) => setShowCeiling(e.target.checked)} /> Ceilings</label>
          <label className="vp-check"><input type="checkbox" checked={showRoof} onChange={(e) => setShowRoof(e.target.checked)} /> Roof</label>
        </div>
        {cameraMode === 'orbit' && (
          <button className="btn btn-primary btn-sm btn-full" onClick={() => setShowCatalog(v => !v)}>＋ Add object</button>
        )}
        <button className="btn btn-secondary btn-sm btn-full" onClick={() => apiRef.current?.screenshot()}>
          📷 Screenshot
        </button>
        <div className="vp-group">
          <span className="vp-label">Time of Day</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>☀</span>
            <input type="range" min="0" max="24" step="0.5" value={timeOfDay}
              onChange={(e) => setTimeOfDay(parseFloat(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--color-accent)' }}
            />
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', minWidth: 36 }}>
              {Math.floor(timeOfDay)}:{String(Math.round((timeOfDay % 1) * 60)).padStart(2, '0')}
            </span>
          </div>
        </div>
      </div>

      {/* Catalog palette */}
      {showCatalog && cameraMode === 'orbit' && (
        <div className="vp-catalog">
          <div className="vp-catalog-head">
            <span>Add object{selRoom ? ` to ${selRoom.label}` : ''}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowCatalog(false)}>✕</button>
          </div>
          <div className="vp-catalog-body">
            {Object.entries(catalog).map(([cat, items]) => (
              <div key={cat} className="vp-cat">
                <div className="vp-cat-title">{cat}</div>
                <div className="vp-cat-items">
                  {items.map(it => (
                    <button key={it.kind} className="vp-cat-item" onClick={() => addFromCatalog(it.kind)}>{it.label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selection / properties panel */}
      {cameraMode === 'orbit' && (selFurn || selRoom || selDoor || selWindow) && (
        <div className="vp-edit">
          {selFurn && (
            <>
              <div className="vp-edit-head">{CATALOG[selFurn.kind]?.label || selFurn.kind}</div>
              <div className="vp-label">Transform</div>
              <div className="toggle-group vp-full">
                <button className={`toggle-btn ${gizmoMode === 'translate' ? 'active' : ''}`} onClick={() => setGizmoMode('translate')}>Move</button>
                <button className={`toggle-btn ${gizmoMode === 'rotate' ? 'active' : ''}`} onClick={() => setGizmoMode('rotate')}>Rotate</button>
                <button className={`toggle-btn ${gizmoMode === 'scale' ? 'active' : ''}`} onClick={() => setGizmoMode('scale')}>Scale</button>
              </div>
              <div className="vp-row">
                <button className="btn btn-secondary btn-sm" onClick={() => editor.updateFurnishing(selFurn.id, { rot: (selFurn.rot || 0) + Math.PI / 2 })}>⟳ 90°</button>
                <button className="btn btn-secondary btn-sm" onClick={() => editor.updateFurnishing(selFurn.id, { scale: Math.round(Math.min(3, (selFurn.scale || 1) + 0.1) * 100) / 100 })}>＋</button>
                <button className="btn btn-secondary btn-sm" onClick={() => editor.updateFurnishing(selFurn.id, { scale: Math.round(Math.max(0.3, (selFurn.scale || 1) - 0.1) * 100) / 100 })}>－</button>
              </div>
              <div className="vp-label">Color</div>
              <div className="vp-swatches">
                {RECOLOR_SWATCHES.map(c => (
                  <button key={c} className={`vp-swatch ${selFurn.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => editor.updateFurnishing(selFurn.id, { color: c })} />
                ))}
                <button className={`vp-swatch vp-swatch-reset ${!selFurn.color ? 'active' : ''}`} title="Default" onClick={() => editor.updateFurnishing(selFurn.id, { color: null })}>↺</button>
              </div>
              <div className="vp-row">
                <button className="btn btn-secondary btn-sm" onClick={() => { const id = editor.duplicateFurnishing(selFurn.id); if (id) { selectionRef.current = { type: 'furniture', id }; setSelection({ type: 'furniture', id }); } }}>Duplicate</button>
                <button className="btn btn-danger-outline btn-sm" onClick={() => { editor.removeFurnishing(selFurn.id); selectionRef.current = null; setSelection(null); }}>Delete</button>
              </div>
            </>
          )}
          {selRoom && (
            <>
              <div className="vp-edit-head">{selRoom.label} <span className="vp-edit-sub">room</span></div>
              <div className="vp-label">Drag the arrows to move · resize below</div>
              <div className="vp-row">
                <label className="vp-num">W<input type="number" value={selRoom.w} step="0.5" min="3" onChange={(e) => editor.editRoom(selRoom.id, { w: parseFloat(e.target.value) || selRoom.w })} /></label>
                <label className="vp-num">H<input type="number" value={selRoom.h} step="0.5" min="3" onChange={(e) => editor.editRoom(selRoom.id, { h: parseFloat(e.target.value) || selRoom.h })} /></label>
              </div>
              <div className="vp-row">
                <button className="btn btn-secondary btn-sm" onClick={() => editor.rotateRoom(selRoom.id)}>⟳ Rotate 90°</button>
              </div>
              <div className="vp-label">Room Color</div>
              <div className="vp-swatches">
                {ROOM_COLORS.map(c => (
                  <button key={c} className={`vp-swatch ${selRoom.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => editor.updateRoomProps(selRoom.id, { color: c })} />
                ))}
              </div>
              <div className="vp-label">Floor Material</div>
              <div className="toggle-group vp-full">
                {FLOOR_TYPES.map(ft => (
                  <button key={ft.value || 'default'} className={`toggle-btn ${(selRoom.floorType || null) === ft.value ? 'active' : ''}`} onClick={() => editor.updateRoomProps(selRoom.id, { floorType: ft.value })}>{ft.label}</button>
                ))}
              </div>
            </>
          )}
          {selDoor && (
            <>
              <div className="vp-edit-head">Door <span className="vp-edit-sub">{selDoor.side} wall</span></div>
              <div className="vp-label">Position: {selDoor.x.toFixed(1)}, {selDoor.y.toFixed(1)} ft</div>
              <div className="vp-row">
                <button className="btn btn-secondary btn-sm" onClick={() => editor.moveDoor(selDoor.roomId, selDoor.side, -0.5)}>← Shift</button>
                <button className="btn btn-secondary btn-sm" onClick={() => editor.moveDoor(selDoor.roomId, selDoor.side, 0.5)}>Shift →</button>
              </div>
              <div className="vp-row">
                <button className="btn btn-danger-outline btn-sm" onClick={() => { editor.removeDoor(selDoor.roomId, selDoor.side); selectionRef.current = null; setSelection(null); }}>Delete Door</button>
              </div>
            </>
          )}
          {selWindow && (
            <>
              <div className="vp-edit-head">Window <span className="vp-edit-sub">{selWindow.side} wall</span></div>
              <div className="vp-label">Position: {selWindow.x.toFixed(1)}, {selWindow.y.toFixed(1)} ft · Width: {selWindow.width.toFixed(1)} ft</div>
              <div className="vp-row">
                <button className="btn btn-secondary btn-sm" onClick={() => editor.moveWindow(selWindow.roomId, selWindow.side, -0.5)}>← Shift</button>
                <button className="btn btn-secondary btn-sm" onClick={() => editor.moveWindow(selWindow.roomId, selWindow.side, 0.5)}>Shift →</button>
              </div>
              <div className="vp-row">
                <button className="btn btn-danger-outline btn-sm" onClick={() => { editor.removeWindow(selWindow.roomId, selWindow.side); selectionRef.current = null; setSelection(null); }}>Delete Window</button>
              </div>
            </>
          )}
          <button className="btn btn-ghost btn-sm vp-full" onClick={() => { selectionRef.current = null; setSelection(null); }}>Deselect</button>
        </div>
      )}

      {cameraMode === 'walk' ? (
        <div className="vp-walk-hint">Click to look · <b>W A S D</b> / arrows to move · <b>Esc</b> to release</div>
      ) : (
        <div className="vp-walk-hint vp-edit-hint">Click an object to select · drag it or use the handles · <b>Del</b> removes · <b>＋ Add</b> for more</div>
      )}
    </div>
  );
});

export default FloorPlan3D;
