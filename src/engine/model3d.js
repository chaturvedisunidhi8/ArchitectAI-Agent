import * as THREE from 'three';
import {
  CEILING_HEIGHT_FT, FLOOR_SLAB_FT, CEILING_SLAB_FT, ROOF_SLAB_FT,
  PARAPET_HEIGHT_FT, DOOR_HEIGHT_FT,
  WINDOW_SILL_FT, WINDOW_HEIGHT_FT,
} from './constants.js';
import { defaultFurnishings } from './furniture.js';

/**
 * model3d.js — builds a clean, well-named THREE.Group tree from a 2D layout.
 *
 * Coordinate convention (matches the viewer): plan X -> world X, plan Y -> world
 * Z, height -> world Y (up). One plan foot == one world unit, so exported
 * GLTF/GLB/OBJ/STL come out in feet with correct proportions.
 *
 * The returned root contains only real building geometry organised into named
 * sub-groups (Floors, Walls, Ceilings, Roof, Doors, Windows, Furniture) so it
 * reads well in Blender / CAD. Ground plane, lights and text labels are the
 * viewer's responsibility and are intentionally NOT part of the model.
 */

const H = CEILING_HEIGHT_FT;
const EPS = 0.001;

// ---------------------------------------------------------------------------
// Procedural textures (built once, shared across all models)
// ---------------------------------------------------------------------------
function makeCanvasTexture(draw, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

let _tex = null;
function textures() {
  if (_tex) return _tex;
  const wood = makeCanvasTexture((ctx, s) => {
    ctx.fillStyle = '#b98d5f';
    ctx.fillRect(0, 0, s, s);
    const planks = 4;
    const pw = s / planks;
    for (let i = 0; i < planks; i++) {
      const shade = 200 + Math.floor(Math.random() * 30) - 15;
      ctx.fillStyle = `rgb(${shade - 20},${Math.floor((shade - 20) * 0.68)},${Math.floor((shade - 20) * 0.42)})`;
      ctx.fillRect(i * pw, 0, pw - 1, s);
      // grain lines
      ctx.strokeStyle = 'rgba(90,60,35,0.18)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 6; g++) {
        const gy = Math.random() * s;
        ctx.beginPath();
        ctx.moveTo(i * pw, gy);
        ctx.lineTo(i * pw + pw, gy + (Math.random() * 6 - 3));
        ctx.stroke();
      }
    }
    // plank seams
    ctx.strokeStyle = 'rgba(60,40,25,0.4)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= planks; i++) {
      ctx.beginPath();
      ctx.moveTo(i * pw, 0);
      ctx.lineTo(i * pw, s);
      ctx.stroke();
    }
  });

  const tile = makeCanvasTexture((ctx, s) => {
    ctx.fillStyle = '#e4e7e6';
    ctx.fillRect(0, 0, s, s);
    const tiles = 4;
    const tw = s / tiles;
    ctx.strokeStyle = '#c2c7c6';
    ctx.lineWidth = 2;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath(); ctx.moveTo(i * tw, 0); ctx.lineTo(i * tw, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * tw); ctx.lineTo(s, i * tw); ctx.stroke();
    }
  });

  const grass = makeCanvasTexture((ctx, s) => {
    ctx.fillStyle = '#5f8a4a';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 900; i++) {
      const g = 60 + Math.floor(Math.random() * 90);
      ctx.fillStyle = `rgba(${Math.floor(g * 0.5)},${g},${Math.floor(g * 0.4)},0.5)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });

  _tex = { wood, tile, grass };
  return _tex;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
function makeMaterials() {
  const t = textures();
  const std = (opts) => new THREE.MeshStandardMaterial(opts);
  return {
    wall: std({ color: 0xf1ede5, roughness: 0.94, metalness: 0.0 }),
    wallExt: std({ color: 0xe7ded0, roughness: 0.95, metalness: 0.0 }),
    ceiling: std({ color: 0xfbfbf8, roughness: 1.0, metalness: 0.0 }),
    roof: std({ color: 0xb7b0a3, roughness: 0.9, metalness: 0.05 }),
    floorWood: std({ map: t.wood.clone(), roughness: 0.72, metalness: 0.02 }),
    floorTile: std({ map: t.tile.clone(), roughness: 0.4, metalness: 0.02 }),
    grass: std({ map: t.grass.clone(), roughness: 1.0, metalness: 0.0 }),
    glass: std({ color: 0xbdd8e8, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.32 }),
    frame: std({ color: 0x6b5844, roughness: 0.6, metalness: 0.1 }),
    door: std({ color: 0xa9805a, roughness: 0.55, metalness: 0.05 }),
    handle: std({ color: 0xc9b17a, roughness: 0.3, metalness: 0.8 }),
    fabric: std({ color: 0x7c8895, roughness: 0.9, metalness: 0.0 }),
    fabricLight: std({ color: 0xd9d2c4, roughness: 0.9, metalness: 0.0 }),
    wood: std({ color: 0x8a5a37, roughness: 0.6, metalness: 0.05 }),
    woodLight: std({ color: 0xb08a5e, roughness: 0.6, metalness: 0.05 }),
    white: std({ color: 0xf3f2ee, roughness: 0.5, metalness: 0.0 }),
    metal: std({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.85 }),
    dark: std({ color: 0x33383e, roughness: 0.5, metalness: 0.2 }),
    rug: std({ color: 0xb06a55, roughness: 0.95, metalness: 0.0 }),
    plant: std({ color: 0x4a7c59, roughness: 0.9, metalness: 0.0 }),
  };
}

function floorMaterialFor(type, mats, floorType) {
  if (floorType === 'marble') return new THREE.MeshStandardMaterial({ color: 0xe8e0d8, roughness: 0.15, metalness: 0.1 });
  if (floorType === 'concrete') return new THREE.MeshStandardMaterial({ color: 0xa0a0a0, roughness: 0.85, metalness: 0.0 });
  if (floorType === 'tile') return mats.floorTile;
  if (floorType === 'grass') return mats.grass;
  if (type === 'bathroom' || type === 'laundry' || type === 'kitchen') return mats.floorTile;
  if (type === 'garden' || type === 'balcony') return mats.grass;
  return mats.floorWood;
}

// Scale a box geometry's UVs so a tiling texture keeps a constant real-world size.
function scaleTopUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------
function box(w, h, d, mat, name) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (name) mesh.name = name;
  return mesh;
}

function at(mesh, x, y, z) {
  mesh.position.set(x, y, z);
  return mesh;
}

// A wall/opening box laid out along an axis `u` at fixed cross position.
// orientation 'h' -> runs along world X (thickness along Z at `fixed`)
// orientation 'v' -> runs along world Z (thickness along X at `fixed`)
function segBox(orientation, uS, uE, vB, vT, fixed, depth, mat, name) {
  const len = uE - uS;
  const height = vT - vB;
  if (len <= EPS || height <= EPS) return null;
  let mesh;
  if (orientation === 'h') {
    mesh = box(len, height, depth, mat, name);
    mesh.position.set((uS + uE) / 2, (vB + vT) / 2, fixed);
  } else {
    mesh = box(depth, height, len, mat, name);
    mesh.position.set(fixed, (vB + vT) / 2, (uS + uE) / 2);
  }
  return mesh;
}

// ---------------------------------------------------------------------------
// Floors + ceilings
// ---------------------------------------------------------------------------
function buildFloors(rooms, mats) {
  const group = new THREE.Group();
  group.name = 'Floors';
  rooms.forEach((room) => {
    const mat = floorMaterialFor(room.type, mats, room.floorType);
    const ft = room.floorType || room.type;
    const scale = ft === 'garden' || ft === 'balcony' || ft === 'grass' ? 6 : (ft === 'tile' || ft === 'bathroom' || ft === 'laundry' || ft === 'kitchen' ? 2 : 3);

    let mesh;
    if (room.polygon && room.polygon.length >= 3) {
      const cx = room.w / 2, cy = room.h / 2;
      const shape = new THREE.Shape();
      shape.moveTo(room.polygon[0][0] - room.x - cx, room.polygon[0][1] - room.y - cy);
      for (let i = 1; i < room.polygon.length; i++) {
        shape.lineTo(room.polygon[i][0] - room.x - cx, room.polygon[i][1] - room.y - cy);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: FLOOR_SLAB_FT, bevelEnabled: false });
      mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.rotation.x = -Math.PI / 2;
      if (room.rotation) {
        mesh.rotation.z = room.rotation;
      }
      mesh.position.set(room.x + cx, -FLOOR_SLAB_FT / 2, room.y + cy);
    } else {
      const geo = new THREE.BoxGeometry(room.w, FLOOR_SLAB_FT, room.h);
      scaleTopUV(geo, room.w / scale, room.h / scale);
      mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.position.set(room.x + room.w / 2, -FLOOR_SLAB_FT / 2, room.y + room.h / 2);
    }
    mesh.name = `Floor_${room.id}`;
    mesh.userData = { selectable: 'room', roomId: room.id };
    group.add(mesh);
  });
  return group;
}

function buildCeilings(rooms, mats) {
  const group = new THREE.Group();
  group.name = 'Ceilings';
  rooms.forEach((room) => {
    if (room.type === 'balcony' || room.type === 'garden') return;
    let mesh;
    if (room.polygon && room.polygon.length >= 3) {
      const cx = room.w / 2, cy = room.h / 2;
      const shape = new THREE.Shape();
      shape.moveTo(room.polygon[0][0] - room.x - cx, room.polygon[0][1] - room.y - cy);
      for (let i = 1; i < room.polygon.length; i++) {
        shape.lineTo(room.polygon[i][0] - room.x - cx, room.polygon[i][1] - room.y - cy);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: CEILING_SLAB_FT, bevelEnabled: false });
      mesh = new THREE.Mesh(geo, mats.ceiling);
      mesh.castShadow = false;
      mesh.rotation.x = -Math.PI / 2;
      if (room.rotation) {
        mesh.rotation.z = room.rotation;
      }
      mesh.position.set(room.x + cx, H + CEILING_SLAB_FT / 2, room.y + cy);
    } else {
      mesh = box(room.w - 0.1, CEILING_SLAB_FT, room.h - 0.1, mats.ceiling, `Ceiling_${room.id}`);
      mesh.castShadow = false;
      mesh.position.set(room.x + room.w / 2, H + CEILING_SLAB_FT / 2, room.y + room.h / 2);
    }
    if (mesh) {
      mesh.name = `Ceiling_${room.id}`;
      group.add(mesh);
    }
  });
  return group;
}

function buildRoof(boundary, mats) {
  const group = new THREE.Group();
  group.name = 'Roof';
  const cx = boundary.width / 2;
  const cz = boundary.height / 2;
  const top = H + CEILING_SLAB_FT;
  const over = 0.8; // small overhang

  const slab = box(boundary.width + over * 2, ROOF_SLAB_FT, boundary.height + over * 2, mats.roof, 'RoofSlab');
  slab.position.set(cx, top + ROOF_SLAB_FT / 2, cz);
  group.add(slab);

  // parapet
  const py = top + ROOF_SLAB_FT + PARAPET_HEIGHT_FT / 2;
  const th = 0.5;
  const w = boundary.width + over * 2;
  const d = boundary.height + over * 2;
  const parapets = [
    at(box(w, PARAPET_HEIGHT_FT, th, mats.roof, 'Parapet_S'), cx, py, cz - d / 2 + th / 2),
    at(box(w, PARAPET_HEIGHT_FT, th, mats.roof, 'Parapet_N'), cx, py, cz + d / 2 - th / 2),
    at(box(th, PARAPET_HEIGHT_FT, d, mats.roof, 'Parapet_W'), cx - w / 2 + th / 2, py, cz),
    at(box(th, PARAPET_HEIGHT_FT, d, mats.roof, 'Parapet_E'), cx + w / 2 - th / 2, py, cz),
  ];
  parapets.forEach(p => group.add(p));
  return group;
}

// ---------------------------------------------------------------------------
// Walls with door / window openings
// ---------------------------------------------------------------------------
function openingsOnWall(orientation, u0, u1, fixed, doors, windows) {
  const tol = 0.2;
  const result = [];
  const collect = (list, vB, vT, kind) => {
    list.forEach((op) => {
      const isH = op.horizontal;
      if (orientation === 'h' && !isH) return;
      if (orientation === 'v' && isH) return;
      const opFixed = orientation === 'h' ? op.y : op.x;
      if (Math.abs(opFixed - fixed) > tol) return;
      const oS = orientation === 'h' ? op.x : op.y;
      const oE = oS + op.width;
      if (oE < u0 - tol || oS > u1 + tol) return;
      result.push({
        us: Math.max(oS, u0), ue: Math.min(oE, u1), vb: vB, vt: vT, kind, ref: op,
      });
    });
  };
  collect(doors, 0, DOOR_HEIGHT_FT, 'door');
  collect(windows, WINDOW_SILL_FT, WINDOW_SILL_FT + WINDOW_HEIGHT_FT, 'window');
  result.sort((a, b) => a.us - b.us);
  return result;
}

function buildWalls(layout, mats) {
  const { walls, doors = [], windows = [], boundary } = layout;
  const wallsGroup = new THREE.Group(); wallsGroup.name = 'Walls';
  const doorsGroup = new THREE.Group(); doorsGroup.name = 'Doors';
  const windowsGroup = new THREE.Group(); windowsGroup.name = 'Windows';

  let wIdx = 0;
  walls.forEach((wall) => {
    const horizontal = Math.abs(wall.y1 - wall.y2) < 0.01;
    const vertical = Math.abs(wall.x1 - wall.x2) < 0.01;

    // Diagonal wall: create a simple box along the wall direction.
    if (!horizontal && !vertical) {
      const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < EPS) return;
      const th = wall.thickness || 0.375;
      const exterior = wall.kind === 'exterior';
      const wallMat = exterior ? mats.wallExt : mats.wall;
      const geo = new THREE.BoxGeometry(len, H, th);
      const mesh = new THREE.Mesh(geo, wallMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(
        (wall.x1 + wall.x2) / 2,
        H / 2,
        (wall.y1 + wall.y2) / 2,
      );
      mesh.rotation.y = -Math.atan2(dy, dx);
      mesh.name = `Wall_D${++wIdx}`;
      wallsGroup.add(mesh);
      return;
    }

    const orientation = horizontal ? 'h' : 'v';
    const u0 = horizontal ? Math.min(wall.x1, wall.x2) : Math.min(wall.y1, wall.y2);
    const u1 = horizontal ? Math.max(wall.x1, wall.x2) : Math.max(wall.y1, wall.y2);
    const fixed = horizontal ? wall.y1 : wall.x1;
    if (u1 - u0 < EPS) return;

    const exterior = wall.kind === 'exterior' || Math.abs(fixed) < 0.6 ||
      (horizontal ? Math.abs(fixed - boundary.height) < 0.6 : Math.abs(fixed - boundary.width) < 0.6);
    const wallMat = exterior ? mats.wallExt : mats.wall;
    const th = wall.thickness || 0.375;

    const ops = openingsOnWall(orientation, u0, u1, fixed, doors, windows);
    wIdx += 1;
    const tag = `${orientation === 'h' ? 'H' : 'V'}${wIdx}`;

    let cursor = u0;
    let piece = 0;
    const addWallBox = (uS, uE, vB, vT) => {
      const m = segBox(orientation, uS, uE, vB, vT, fixed, th, wallMat, `Wall_${tag}_${++piece}`);
      if (m) wallsGroup.add(m);
    };

    ops.forEach((op) => {
      if (op.us > cursor + EPS) addWallBox(cursor, op.us, 0, H);     // pier before opening
      if (op.vb > EPS) addWallBox(op.us, op.ue, 0, op.vb);           // sill under window
      if (op.vt < H - EPS) addWallBox(op.us, op.ue, op.vt, H);       // lintel over opening
      if (op.kind === 'door') {
        buildDoorInOpening(orientation, op, fixed, th, mats, doorsGroup, tag);
      } else {
        buildWindowInOpening(orientation, op, fixed, th, mats, windowsGroup, tag);
      }
      cursor = Math.max(cursor, op.ue);
    });
    if (cursor < u1 - EPS) addWallBox(cursor, u1, 0, H);             // final pier

    if (ops.length === 0) addWallBox(u0, u1, 0, H);                  // solid wall
  });

  return { wallsGroup, doorsGroup, windowsGroup };
}

function buildDoorInOpening(orientation, op, fixed, wallTh, mats, group, tag) {
  const jt = 0.14;
  const depth = wallTh + 0.06;
  const g = new THREE.Group();
  g.name = `Door_${tag}_${op.ref.roomId}`;
  g.userData = { selectable: 'door', doorId: op.ref.roomId, doorSide: op.ref.side };
  const add = (uS, uE, vB, vT, mat, depthOverride, name) => {
    const m = segBox(orientation, uS, uE, vB, vT, fixed, depthOverride ?? depth, mat, name);
    if (m) g.add(m);
  };
  // frame: two jambs + head
  add(op.us, op.us + jt, 0, DOOR_HEIGHT_FT, mats.frame, undefined, 'DoorJambL');
  add(op.ue - jt, op.ue, 0, DOOR_HEIGHT_FT, mats.frame, undefined, 'DoorJambR');
  add(op.us, op.ue, DOOR_HEIGHT_FT - jt, DOOR_HEIGHT_FT, mats.frame, undefined, 'DoorHead');
  // leaf (closed), thinner than wall so it reads as a panel
  add(op.us + jt, op.ue - jt, 0.05, DOOR_HEIGHT_FT - jt, mats.door, 0.14, 'DoorLeaf');
  // handle
  const hy = 3.2;
  const handle = box(0.25, 0.25, 0.25, mats.handle, 'DoorHandle');
  const hu = op.ue - jt - 0.4;
  if (orientation === 'h') handle.position.set(hu, hy, fixed + 0.12);
  else handle.position.set(fixed + 0.12, hy, hu);
  g.add(handle);
  group.add(g);
}

function buildWindowInOpening(orientation, op, fixed, wallTh, mats, group, tag) {
  const jt = 0.12;
  const depth = wallTh + 0.06;
  const g = new THREE.Group();
  g.name = `Window_${tag}_${op.ref.roomId}`;
  g.userData = { selectable: 'window', windowId: op.ref.roomId, windowSide: op.ref.side };
  const add = (uS, uE, vB, vT, mat, depthOverride, name) => {
    const m = segBox(orientation, uS, uE, vB, vT, fixed, depthOverride ?? depth, mat, name);
    if (m) g.add(m);
  };
  const { us, ue, vb, vt } = op;
  // frame border
  add(us, ue, vb, vb + jt, mats.frame, undefined, 'WinBottom');
  add(us, ue, vt - jt, vt, mats.frame, undefined, 'WinTop');
  add(us, us + jt, vb, vt, mats.frame, undefined, 'WinLeft');
  add(ue - jt, ue, vb, vt, mats.frame, undefined, 'WinRight');
  // mullions
  const midU = (us + ue) / 2;
  const midV = (vb + vt) / 2;
  add(midU - 0.05, midU + 0.05, vb + jt, vt - jt, mats.frame, wallTh * 0.6, 'WinMullionV');
  add(us + jt, ue - jt, midV - 0.05, midV + 0.05, mats.frame, wallTh * 0.6, 'WinMullionH');
  // glass
  add(us + jt, ue - jt, vb + jt, vt - jt, mats.glass, 0.08, 'Glass');
  group.add(g);
}

// ---------------------------------------------------------------------------
// Furniture — a registry of per-kind builders. Each returns a THREE.Group
// centred on the origin in X/Z with its base on the floor (y = 0); ceiling
// fixtures build themselves near CEILING_HEIGHT_FT. Placement (x, y, rotation,
// scale) is applied by buildFurnishings from the furnishing data.
// ---------------------------------------------------------------------------
const CH = CEILING_HEIGHT_FT;

function mk(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, seg = 16) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function grp(...children) {
  const g = new THREE.Group();
  children.forEach(c => c && g.add(c));
  return g;
}
function P(mesh, x, y, z) { mesh.position.set(x, y, z); return mesh; }

const BUILDERS = {
  bed: (m) => grp(
    P(mk(5, 0.7, 6.7, m.woodLight), 0, 0.35, 0),
    P(mk(4.8, 0.7, 6.5, m.fabricLight), 0, 1.0, 0),
    P(mk(5, 2.4, 0.3, m.wood), 0, 1.2, -3.35),
    P(mk(1.7, 0.4, 1.5, m.white), -1.1, 1.45, -2.4),
    P(mk(1.7, 0.4, 1.5, m.white), 1.1, 1.45, -2.4),
  ),
  bunk_bed: (m) => grp(
    P(mk(4, 0.4, 6.7, m.wood), 0, 0.5, 0), P(mk(3.8, 0.5, 6.5, m.fabricLight), 0, 0.95, 0),
    P(mk(4, 0.4, 6.7, m.wood), 0, 3.6, 0), P(mk(3.8, 0.5, 6.5, m.fabricLight), 0, 4.05, 0),
    ...[[-1.9, -3.3], [1.9, -3.3], [-1.9, 3.3], [1.9, 3.3]].map(([x, z]) => P(mk(0.3, 5.5, 0.3, m.wood), x, 2.75, z)),
  ),
  crib: (m) => grp(
    P(mk(2.6, 0.5, 4.2, m.woodLight), 0, 1.2, 0),
    P(mk(2.4, 0.4, 4.0, m.fabricLight), 0, 1.6, 0),
    P(mk(2.6, 1.4, 0.15, m.woodLight), 0, 2.2, -2.1),
    P(mk(2.6, 1.4, 0.15, m.woodLight), 0, 2.2, 2.1),
  ),
  nightstand: (m) => grp(P(mk(1.6, 1.9, 1.6, m.wood), 0, 0.95, 0), P(mk(1.3, 0.1, 0.1, m.handle), 0, 1.2, 0.8)),
  wardrobe: (m) => grp(P(mk(4, 6, 2, m.wood), 0, 3, 0), P(mk(0.1, 1.5, 0.1, m.handle), -0.3, 3, 1.05), P(mk(0.1, 1.5, 0.1, m.handle), 0.3, 3, 1.05)),
  dresser: (m) => grp(P(mk(3, 2.8, 1.6, m.wood), 0, 1.4, 0), P(mk(2.6, 0.1, 0.1, m.handle), 0, 1.8, 0.85), P(mk(2.6, 0.1, 0.1, m.handle), 0, 1.0, 0.85)),

  sofa: (m) => grp(
    P(mk(7, 1.4, 3, m.fabric), 0, 0.7, 0.2),
    P(mk(7, 2.4, 0.6, m.fabric), 0, 1.2, -1.2),
    P(mk(0.6, 1.6, 3, m.fabric), -3.2, 0.9, 0.2),
    P(mk(0.6, 1.6, 3, m.fabric), 3.2, 0.9, 0.2),
  ),
  armchair: (m) => grp(
    P(mk(3, 1.4, 3, m.fabric), 0, 0.7, 0.2),
    P(mk(3, 2.2, 0.5, m.fabric), 0, 1.2, -1.25),
    P(mk(0.5, 1.4, 3, m.fabric), -1.25, 0.9, 0.2),
    P(mk(0.5, 1.4, 3, m.fabric), 1.25, 0.9, 0.2),
  ),
  coffee_table: (m) => grp(
    P(mk(3.5, 0.3, 1.8, m.wood), 0, 1.3, 0),
    ...[[-1.6, -0.75], [1.6, -0.75], [-1.6, 0.75], [1.6, 0.75]].map(([x, z]) => P(mk(0.2, 1.3, 0.2, m.wood), x, 0.65, z)),
  ),
  side_table: (m) => grp(P(mk(1.6, 0.2, 1.6, m.wood), 0, 1.7, 0), P(cyl(0.2, 0.2, 1.7, m.wood), 0, 0.85, 0)),
  tv_console: (m) => grp(P(mk(5, 1.6, 1.2, m.dark), 0, 0.8, 0)),
  tv: (m) => grp(P(mk(4, 2.4, 0.15, m.dark), 0, 3, 0), P(mk(1.4, 0.1, 0.6, m.dark), 0, 1.85, 0)),
  bookshelf: (m) => grp(
    P(mk(3, 6, 1, m.wood), 0, 3, 0),
    ...[1.2, 2.6, 4.0, 5.2].map((y, i) => P(mk(2.8, 0.1, 0.9, m.woodLight), 0, y, 0.02)),
  ),
  rug: (m) => grp(P(mk(8, 0.08, 6, m.rug), 0, 0.05, 0)),
  floor_lamp: (m) => grp(P(cyl(0.7, 0.9, 1, m.fabricLight), 0, 5.2, 0), P(cyl(0.07, 0.07, 5, m.metal), 0, 2.6, 0), P(cyl(0.5, 0.5, 0.1, m.metal), 0, 0.05, 0)),
  piano: (m) => grp(P(mk(4.5, 3.2, 3, m.dark), 0, 1.6, -0.2), P(mk(3.6, 0.3, 0.9, m.white), 0, 2.5, 1.2)),

  dining_table: (m) => grp(
    P(mk(5, 0.3, 3, m.wood), 0, 2.4, 0),
    ...[[-2.2, -1.2], [2.2, -1.2], [-2.2, 1.2], [2.2, 1.2]].map(([x, z]) => P(mk(0.25, 2.4, 0.25, m.wood), x, 1.2, z)),
  ),
  dining_chair: (m) => grp(
    P(mk(1.5, 0.2, 1.5, m.woodLight), 0, 1.5, 0),
    P(mk(1.5, 1.7, 0.2, m.woodLight), 0, 2.35, -0.65),
    ...[[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].map(([x, z]) => P(mk(0.15, 1.5, 0.15, m.woodLight), x, 0.75, z)),
  ),
  bar_stool: (m) => grp(P(cyl(0.7, 0.7, 0.25, m.woodLight), 0, 2.5, 0), P(cyl(0.1, 0.1, 2.5, m.metal), 0, 1.25, 0), P(cyl(0.6, 0.6, 0.1, m.metal), 0, 0.05, 0)),

  kitchen_counter: (m) => grp(P(mk(4, 2.9, 2, m.white), 0, 1.45, 0), P(mk(4, 0.2, 2, m.dark), 0, 3.0, 0)),
  kitchen_island: (m) => grp(P(mk(5, 2.9, 3, m.white), 0, 1.45, 0), P(mk(5, 0.2, 3, m.dark), 0, 3.0, 0)),
  fridge: (m) => grp(P(mk(2.5, 5.5, 2.5, m.metal), 0, 2.75, 0), P(mk(0.1, 1, 0.1, m.handle), -1.1, 3.6, 1.25), P(mk(2.4, 0.1, 0.1, m.dark), 0, 3.2, 1.26)),
  oven: (m) => grp(P(mk(2.5, 3, 2.5, m.metal), 0, 1.5, 0), P(mk(1.8, 1.5, 0.1, m.glass), 0, 1.4, 1.25), P(mk(2.2, 0.15, 0.15, m.handle), 0, 2.5, 1.3)),
  stove: (m) => grp(
    P(mk(2.5, 3, 2, m.white), 0, 1.5, 0), P(mk(2.5, 0.15, 2, m.dark), 0, 3.05, 0),
    ...[[-0.6, -0.5], [0.6, -0.5], [-0.6, 0.5], [0.6, 0.5]].map(([x, z]) => P(cyl(0.35, 0.35, 0.08, m.dark), x, 3.15, z)),
  ),
  microwave: (m) => grp(P(mk(1.5, 1.2, 1.2, m.metal), 0, 0.6, 0), P(mk(1.0, 0.9, 0.05, m.glass), 0.15, 0.6, 0.6)),
  dishwasher: (m) => grp(P(mk(2, 3, 2, m.metal), 0, 1.5, 0), P(mk(1.8, 0.15, 0.1, m.handle), 0, 2.6, 1.0)),
  sink: (m) => grp(P(mk(2, 3, 1.6, m.white), 0, 1.5, 0), P(mk(1.4, 0.4, 1.0, m.metal), 0, 2.9, 0), P(cyl(0.08, 0.08, 1, m.metal), 0, 3.4, -0.4)),

  toilet: (m) => grp(P(mk(1.3, 1.2, 1.5, m.white), 0, 0.6, 0.3), P(cyl(0.7, 0.6, 0.5, m.white), 0, 1.1, 0.3), P(mk(1.6, 2, 0.7, m.white), 0, 1.5, -0.85)),
  bathtub: (m) => grp(P(mk(5, 2, 2.5, m.white), 0, 1, 0), P(mk(4.4, 1.4, 1.9, m.fabricLight), 0, 1.3, 0)),
  shower: (m) => grp(
    P(mk(3, 0.2, 3, m.floorTile), 0, 0.1, 0),
    P(mk(0.1, 6.5, 3, m.glass), 1.5, 3.25, 0),
    P(mk(3, 6.5, 0.1, m.glass), 0, 3.25, 1.5),
    P(cyl(0.4, 0.4, 0.1, m.metal), 0.8, 6, -0.8),
  ),
  vanity: (m) => grp(P(mk(3, 2.6, 1.6, m.white), 0, 1.3, 0), P(mk(3, 0.2, 1.6, m.dark), 0, 2.7, 0), P(mk(2, 2, 0.1, m.glass), 0, 4.4, -0.75)),
  mirror: (m) => grp(P(mk(2, 3, 0.15, m.frame), 0, 3.5, 0), P(mk(1.7, 2.7, 0.05, m.glass), 0, 3.5, 0.08)),
  washer: (m) => grp(P(mk(2.2, 3, 2.2, m.white), 0, 1.5, 0), P(cyl(0.7, 0.7, 0.1, m.glass), 0, 1.6, 1.1, 20)),

  desk: (m) => grp(
    P(mk(4, 0.25, 2, m.wood), 0, 2.4, 0),
    P(mk(0.2, 2.4, 1.8, m.wood), -1.9, 1.2, 0), P(mk(0.2, 2.4, 1.8, m.wood), 1.9, 1.2, 0),
    P(mk(3.8, 1.4, 0.2, m.wood), 0, 1.5, -0.9),
  ),
  office_chair: (m) => grp(P(cyl(0.9, 0.9, 0.25, m.dark), 0, 1.6, 0), P(mk(1.6, 2, 0.2, m.dark), 0, 2.7, -0.6), P(cyl(0.12, 0.12, 1.4, m.metal), 0, 0.9, 0), P(cyl(1.0, 1.0, 0.15, m.metal, 5), 0, 0.15, 0)),
  treadmill: (m) => grp(P(mk(2.5, 0.6, 5, m.dark), 0, 0.3, 0), P(mk(2.3, 0.1, 4, m.metal), 0, 0.65, 0.3), P(mk(2, 1.2, 0.3, m.dark), 0, 3, -2.2), P(mk(0.15, 3, 0.15, m.metal), -1, 1.8, -2), P(mk(0.15, 3, 0.15, m.metal), 1, 1.8, -2)),

  plant: (m) => grp(P(cyl(0.6, 0.5, 1.2, m.handle), 0, 0.6, 0), new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), m.plant).translateY(1.9)),
  ceiling_fan: (m) => grp(
    P(cyl(0.1, 0.1, 1, m.metal), 0, CH - 0.5, 0),
    P(cyl(0.4, 0.4, 0.4, m.dark), 0, CH - 1, 0),
    ...[0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].map((a) => {
      const b = P(mk(2.4, 0.08, 0.5, m.woodLight), Math.cos(a) * 1.4, CH - 1, Math.sin(a) * 1.4);
      b.rotation.y = a; return b;
    }),
  ),
  chandelier: (m) => grp(
    P(cyl(0.06, 0.06, 1.2, m.metal), 0, CH - 0.6, 0),
    P(cyl(0.9, 0.6, 0.5, m.handle), 0, CH - 1.3, 0),
    ...[0, 1, 2, 3, 4, 5].map((i) => {
      const a = (i / 6) * Math.PI * 2;
      return P(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), m.fabricLight), Math.cos(a) * 0.8, CH - 1.5, Math.sin(a) * 0.8);
    }),
  ),
  wall_art: (m) => grp(P(mk(2.5, 2, 0.1, m.frame), 0, 4, 0), P(mk(2.2, 1.7, 0.05, m.fabricLight), 0, 4, 0.06)),
  bush: (m) => grp(P(new THREE.Mesh(new THREE.IcosahedronGeometry(1.0, 1), m.plant), 0, 1, 0)),

  ottoman: (m) => grp(P(mk(2, 1.2, 2, m.fabric), 0, 0.6, 0), P(mk(1.8, 0.3, 1.8, m.fabricLight), 0, 1.35, 0)),
  vanity_table: (m) => grp(
    P(mk(3.5, 2.6, 1.8, m.wood), 0, 1.3, 0),
    P(mk(3.3, 0.2, 1.6, m.woodLight), 0, 2.7, 0),
    P(mk(2.2, 2.5, 0.1, m.glass), 0, 4, -0.85),
    P(cyl(0.5, 0.5, 0.1, m.metal), 0, 2.85, 0.6),
  ),

  entertainment_center: (m) => grp(
    P(mk(6, 4, 1.8, m.wood), 0, 2, 0),
    P(mk(5.5, 0.15, 1.5, m.woodLight), 0, 1.5, 0.1),
    P(mk(5.5, 0.15, 1.5, m.woodLight), 0, 3, 0.1),
    P(mk(5.5, 0.15, 1.5, m.woodLight), 0, 4.2, 0.1),
  ),
  floor_cushion: (m) => grp(P(mk(2, 0.5, 2, m.fabric), 0, 0.25, 0)),
  loveseat: (m) => grp(
    P(mk(5, 1.2, 2.8, m.fabric), 0, 0.6, 0.2),
    P(mk(5, 2, 0.5, m.fabric), 0, 1, -1.1),
    P(mk(0.5, 1.4, 2.8, m.fabric), -2.2, 0.7, 0.2),
    P(mk(0.5, 1.4, 2.8, m.fabric), 2.2, 0.7, 0.2),
  ),
  recliner: (m) => grp(
    P(mk(3.2, 1.4, 3.5, m.fabric), 0, 0.7, 0),
    P(mk(3.2, 2.8, 0.6, m.fabric), 0, 1.4, -1.45),
    P(mk(0.5, 1.2, 3.5, m.fabric), -1.35, 0.8, 0),
    P(mk(0.5, 1.2, 3.5, m.fabric), 1.35, 0.8, 0),
    P(mk(3, 0.8, 2, m.fabric), 0, 1.2, 1.5),
  ),

  buffet: (m) => grp(P(mk(5, 3, 1.8, m.wood), 0, 1.5, 0), P(mk(5, 0.2, 1.8, m.woodLight), 0, 3.1, 0)),
  wine_rack: (m) => grp(
    P(mk(2, 4, 1.2, m.wood), 0, 2, 0),
    ...[0.8, 1.6, 2.4, 3.2].map((y) => P(mk(1.8, 0.1, 1, m.woodLight), 0, y, 0)),
  ),

  kitchen_cabinet: (m) => grp(P(mk(3, 3, 1.5, m.wood), 0, 1.5, 0), P(mk(2.6, 0.1, 0.1, m.handle), 0, 2, 0.8)),
  water_purifier: (m) => grp(P(mk(1.2, 3, 1.2, m.white), 0, 1.5, 0), P(cyl(0.15, 0.15, 0.5, m.metal), 0, 3.2, 0.4)),

  towel_rack: (m) => grp(
    P(mk(2, 0.1, 0.15, m.metal), 0, 3.2, 0),
    P(mk(2, 0.1, 0.15, m.metal), 0, 2.4, 0),
    P(mk(0.1, 0.8, 0.15, m.metal), -0.9, 2.8, 0),
    P(mk(0.1, 0.8, 0.15, m.metal), 0.9, 2.8, 0),
  ),
  bath_mat: (m) => grp(P(mk(2.5, 0.08, 1.8, m.rug), 0, 0.04, 0)),
  toilet_bidet: (m) => grp(P(mk(1.3, 1, 1.5, m.white), 0, 0.5, 0.3), P(cyl(0.5, 0.4, 0.4, m.white), 0, 0.9, 0.3), P(mk(1.4, 1.5, 0.5, m.white), 0, 1, -0.75)),

  filing_cabinet: (m) => grp(P(mk(1.8, 3.5, 2, m.metal), 0, 1.75, 0), P(mk(0.6, 0.1, 0.1, m.handle), 0, 2.5, 1.05), P(mk(0.6, 0.1, 0.1, m.handle), 0, 1.5, 1.05)),
  whiteboard: (m) => grp(P(mk(4, 3, 0.15, m.white), 0, 4.5, 0), P(mk(0.1, 0.1, 0.15, m.metal), -1.8, 3, 0.1)),
  standing_desk: (m) => grp(
    P(mk(4.5, 0.25, 2.5, m.wood), 0, 3.6, 0),
    P(mk(0.2, 3.6, 2.3, m.metal), -2, 1.8, 0), P(mk(0.2, 3.6, 2.3, m.metal), 2, 1.8, 0),
  ),

  bench: (m) => grp(
    P(mk(5, 0.25, 2, m.wood), 0, 1.6, 0),
    P(mk(5, 0.25, 0.3, m.wood), 0, 2.8, -0.85),
    P(mk(0.2, 1.6, 2, m.wood), -2.3, 0.8, 0), P(mk(0.2, 1.6, 2, m.wood), 2.3, 0.8, 0),
  ),
  swing: (m) => grp(
    P(mk(0.3, 6, 0.3, m.metal), -2.3, 3, 0), P(mk(0.3, 6, 0.3, m.metal), 2.3, 3, 0),
    P(mk(5, 0.3, 0.3, m.metal), 0, 6, 0),
    P(mk(2.5, 0.15, 2, m.fabric), 0, 2, 0),
  ),
  fence: (m) => grp(
    P(mk(6, 3, 0.15, m.wood), 0, 1.5, 0),
    ...[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((x) => P(mk(0.15, 3.5, 0.15, m.wood), x, 1.75, 0)),
  ),
  garden_shed: (m) => grp(
    P(mk(6, 4, 4, m.woodLight), 0, 2, 0),
    P(mk(6.2, 0.3, 4.2, m.wood), 0, 4.15, 0),
    P(mk(1.5, 3, 0.1, m.door), 0, 1.5, 2.05),
  ),
  fire_pit: (m) => grp(
    P(cyl(1.5, 1.5, 0.8, m.dark), 0, 0.4, 0, 24),
    P(cyl(1.2, 1.2, 0.1, m.metal), 0, 0.85, 0, 24),
    ...[0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2; return P(new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 6), m.fabric), Math.cos(a) * 0.6, 1.2, Math.sin(a) * 0.6); }),
  ),
  outdoor_table: (m) => grp(
    P(mk(4, 0.2, 4, m.wood), 0, 2.4, 0),
    P(mk(0.2, 2.4, 0.2, m.wood), -1.7, 1.2, -1.7), P(mk(0.2, 2.4, 0.2, m.wood), 1.7, 1.2, -1.7),
    P(mk(0.2, 2.4, 0.2, m.wood), -1.7, 1.2, 1.7), P(mk(0.2, 2.4, 0.2, m.wood), 1.7, 1.2, 1.7),
  ),
  umbrella: (m) => grp(
    P(cyl(0.08, 0.08, 5, m.metal), 0, 2.5, 0),
    P(new THREE.Mesh(new THREE.ConeGeometry(2.5, 1.5, 16, 1, true), m.fabric), 0, 5, 0),
  ),
  hammock: (m) => grp(
    P(mk(0.2, 5, 0.2, m.metal), -2.8, 2.5, 0), P(mk(0.2, 5, 0.2, m.metal), 2.8, 2.5, 0),
    P(mk(4, 0.1, 2, m.fabric), 0, 1.5, 0),
  ),

  wall_shelf: (m) => grp(
    P(mk(3, 0.15, 0.4, m.wood), 0, 4, 0),
    P(mk(0.15, 0.8, 0.4, m.wood), -1.4, 3.6, 0), P(mk(0.15, 0.8, 0.4, m.wood), 1.4, 3.6, 0),
  ),
  hanging_planter: (m) => grp(
    P(cyl(0.06, 0.06, 1.5, m.metal), 0, CH - 0.75, 0),
    P(cyl(0.5, 0.35, 0.5, m.handle), 0, CH - 2, 0),
    new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), m.plant).translateY(CH - 1.7),
  ),
  clock: (m) => grp(P(cyl(0.7, 0.7, 0.15, m.dark), 0, 5, 0, 24), P(cyl(0.06, 0.06, 0.4, m.metal), 0, 5, 0.12)),
  aquarium: (m) => grp(
    P(mk(3, 2, 1.5, m.glass), 0, 1.5, 0),
    P(mk(3, 0.3, 1.5, m.dark), 0, 0.15, 0),
    P(mk(2.8, 1.5, 0.08, m.glass), 0, 1.5, 0.7),
  ),
  coat_rack: (m) => grp(
    P(cyl(0.12, 0.12, 5, m.wood), 0, 2.5, 0),
    P(cyl(0.8, 0.8, 0.1, m.wood), 0, 0.05, 0),
    ...[0, 1, 2, 3].map((i) => { const a = (i / 4) * Math.PI * 2; return P(mk(0.1, 0.8, 0.1, m.wood), Math.cos(a) * 0.6, 4.5, Math.sin(a) * 0.6); }),
  ),
  shoe_rack: (m) => grp(
    P(mk(2.5, 2, 1, m.wood), 0, 1, 0),
    P(mk(2.3, 0.1, 0.9, m.woodLight), 0, 1.2, 0.02),
    P(mk(2.3, 0.1, 0.9, m.woodLight), 0, 2.2, 0.02),
  ),

  washing_line: (m) => grp(
    P(mk(0.15, 4, 0.15, m.metal), -1.8, 2, 0), P(mk(0.15, 4, 0.15, m.metal), 1.8, 2, 0),
    P(mk(3.6, 0.08, 0.08, m.metal), 0, 3.9, 0),
    P(mk(3.6, 0.08, 0.08, m.metal), 0, 3.5, 0),
  ),
  water_tank: (m) => grp(P(cyl(1.5, 1.5, 3, m.white), 0, 1.5, 0, 20)),
  solar_panel: (m) => grp(
    P(mk(3.5, 0.1, 2, m.dark), 0, 3.5, 0),
    P(mk(0.1, 3.5, 0.1, m.metal), -1.5, 1.75, -0.8), P(mk(0.1, 3.5, 0.1, m.metal), 1.5, 1.75, -0.8),
    P(mk(0.1, 3.5, 0.1, m.metal), -1.5, 1.75, 0.8), P(mk(0.1, 3.5, 0.1, m.metal), 1.5, 1.75, 0.8),
  ),
  air_conditioner: (m) => grp(P(mk(3, 1.5, 1.5, m.white), 0, 0.75, 0), P(mk(2.5, 0.8, 0.1, m.dark), 0, 0.8, 0.75)),
  ladder: (m) => grp(
    P(mk(0.12, 4, 0.12, m.metal), -0.6, 2, 0), P(mk(0.12, 4, 0.12, m.metal), 0.6, 2, 0),
    ...[0.5, 1.5, 2.5, 3.5].map((y) => P(mk(1.2, 0.1, 0.1, m.metal), 0, y, 0)),
  ),

  staircase: (m) => {
    const g = new THREE.Group();
    const steps = 12, rise = CH / steps, run = 0.75;
    for (let i = 0; i < steps; i++) {
      // each step is a solid block from the floor up to its tread height
      g.add(P(mk(3.5, rise * (i + 1), run, m.wood), 0, rise * (i + 1) / 2, -4.5 + run * (i + 0.5)));
    }
    return g;
  },
  car: (m) => grp(
    P(mk(6, 2.2, 10, m.fabric), 0, 1.6, 0),
    P(mk(5, 1.6, 5, m.glass), 0, 3.2, -0.5),
    ...[[-3, -3.2], [3, -3.2], [-3, 3.2], [3, 3.2]].map(([x, z]) => { const w = cyl(0.9, 0.9, 0.7, m.dark); w.rotation.z = Math.PI / 2; return P(w, x, 0.9, z); }),
  ),
  railing: (m) => grp(
    P(mk(6, 0.2, 0.2, m.metal), 0, 3.2, 0),
    P(mk(0.2, 3.2, 0.2, m.metal), -2.9, 1.6, 0), P(mk(0.2, 3.2, 0.2, m.metal), 2.9, 1.6, 0),
    ...[-2, -1, 0, 1, 2].map((x) => P(cyl(0.06, 0.06, 3, m.metal), x, 1.5, 0)),
  ),
};

function fallbackObject(mats) { return grp(P(mk(2, 2, 2, mats.wood), 0, 1, 0)); }

// Tint every non-glass mesh of an object to a solid color (for the recolor tool).
function tint(obj, hex) {
  const c = new THREE.Color(hex);
  obj.traverse((o) => {
    if (o.isMesh && o.material && !o.material.transparent) {
      o.material = o.material.clone();
      o.material.map = null;
      o.material.color = c.clone();
    }
  });
}

export function buildFurnitureObject(kind, mats, color) {
  const builder = BUILDERS[kind] || fallbackObject;
  const obj = builder(mats);
  obj.name = kind;
  if (color) tint(obj, color);
  return obj;
}

function buildFurnishings(furnishings, mats) {
  const group = new THREE.Group();
  group.name = 'Furniture';
  furnishings.forEach((f) => {
    const obj = buildFurnitureObject(f.kind, mats, f.color);
    obj.position.set(f.x, 0, f.y);
    obj.rotation.y = f.rot || 0;
    const s = f.scale || 1;
    obj.scale.set(s, s, s);
    obj.userData = { selectable: 'furniture', furnishingId: f.id, kind: f.kind, roomId: f.roomId };
    group.add(obj);
  });
  return group;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------
export function buildModel(layout, opts = {}) {
  const { boundary, rooms } = layout;
  const mats = makeMaterials();

  // Apply theme overrides to materials
  if (opts.themeData) {
    const theme = opts.themeData;
    if (mats.wall && theme.wallColor) mats.wall.color.set(theme.wallColor);
    if (mats.wallExt && theme.wallExtColor) mats.wallExt.color.set(theme.wallExtColor);
    if (mats.fabric && theme.furnitureColors?.fabric) mats.fabric.color.set(theme.furnitureColors.fabric);
    if (mats.wood && theme.furnitureColors?.wood) mats.wood.color.set(theme.furnitureColors.wood);
    if (mats.woodLight && theme.furnitureColors?.woodLight) mats.woodLight.color.set(theme.furnitureColors.woodLight);
    // Apply floor material overrides per room type
    if (theme.floorOverrides) {
      rooms.forEach(room => {
        const floorType = theme.floorOverrides[room.type];
        if (floorType) room.floorType = floorType;
      });
    }
  }

  const root = new THREE.Group();
  root.name = 'FloorPlanModel';
  root.userData = { footprint: { width: boundary.width, height: boundary.height }, units: 'feet' };

  const floors = buildFloors(rooms, mats);
  const ceilings = buildCeilings(rooms, mats);
  const roof = buildRoof(boundary, mats);
  const { wallsGroup, doorsGroup, windowsGroup } = buildWalls(layout, mats);

  const furnishings = (layout.furnishings && layout.furnishings.length)
    ? layout.furnishings
    : defaultFurnishings(rooms, layout.doors);
  const furniture = buildFurnishings(furnishings, mats);

  root.add(floors, wallsGroup, doorsGroup, windowsGroup, ceilings, roof, furniture);

  const groups = { floors, walls: wallsGroup, doors: doorsGroup, windows: windowsGroup, ceilings, roof, furniture };

  // viewer-only visibility defaults
  if (!opts.forExport) {
    ceilings.visible = opts.showCeiling ?? false;
    roof.visible = opts.showRoof ?? false;
  }

  const dispose = () => {
    const seen = new Set();
    root.traverse((obj) => {
      if (obj.geometry && !seen.has(obj.geometry)) { seen.add(obj.geometry); obj.geometry.dispose(); }
      const m = obj.material;
      if (m) {
        (Array.isArray(m) ? m : [m]).forEach((mm) => {
          if (seen.has(mm)) return;
          seen.add(mm);
          if (mm.map) mm.map.dispose();
          mm.dispose();
        });
      }
    });
  };

  return { root, groups, mats, dispose };
}

// Text-sprite room labels — viewer only, never part of the exported model.
export function buildLabels(rooms) {
  const sprites = [];
  rooms.forEach((room) => {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(20,20,20,0.72)';
    ctx.font = '600 30px "DM Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(room.label, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
    sprite.position.set(room.x + room.w / 2, 4.2, room.y + room.h / 2);
    sprite.scale.set(Math.min(room.w * 0.7, 6), Math.min(room.w * 0.175, 1.5), 1);
    sprite.name = `Label_${room.id}`;
    sprites.push(sprite);
  });
  return sprites;
}
