import { hexToThree } from './constants.js';
import { generateWallQuads } from './geometry.js';

const WALL_HEIGHT = 2.8;
const WALL_THICKNESS_3D = 0.15;

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function exportPNG(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      triggerDownload(blob, 'floor-plan.png');
      resolve();
    }, 'image/png');
  });
}

/**
 * Build the plan drawing as SVG markup.
 *
 * Kept separate from `exportSVG` so the same drawing can be produced outside
 * a browser — in tests, in a build step, or when checking a generated plan
 * without opening the app.
 *
 * @param {Object} layout
 * @param {string} displayUnit - 'ft²' or 'm²'.
 * @returns {string} SVG markup.
 */
export function buildSVG(layout, displayUnit) {
  const { boundary, rooms, walls, doors } = layout;
  const pad = 2;
  const svgW = boundary.width + pad * 2;
  const svgH = boundary.height + pad * 2;
  const ftToM = 0.3048;

  const unit = displayUnit === 'm\u00B2' ? 'm' : 'ft';
  const fmt = (v) => displayUnit === 'm\u00B2' ? (v * ftToM).toFixed(2) : v.toFixed(1);
  const fmtArea = (w, h) => {
    const sqft = Math.round(w * h);
    return displayUnit === 'm\u00B2' ? (sqft * 0.092903).toFixed(1) + ' m\u00B2' : sqft + ' ft\u00B2';
  };

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${svgW} ${svgH}" width="${svgW * 40}" height="${svgH * 40}">\n`;
  svg += `<style>
    text { font-family: "DM Sans", "Helvetica Neue", sans-serif; }
    .label { font-size: 1.2px; font-weight: 600; fill: #1B2A4A; text-anchor: middle; }
    .area { font-size: 0.8px; font-family: "JetBrains Mono", monospace; fill: #9A9A9A; text-anchor: middle; }
    .dim { font-size: 0.6px; font-family: "JetBrains Mono", monospace; fill: #B0A99F; text-anchor: middle; }
    .ruler { font-size: 0.55px; font-family: "JetBrains Mono", monospace; fill: #B0A99F; text-anchor: middle; }
  </style>\n`;

  // Background.
  svg += `<rect x="0" y="0" width="${boundary.width}" height="${boundary.height}" fill="#FAFAF8" stroke="#E5E3DE" stroke-width="0.1"/>\n`;

  // Room floor fills.
  rooms.forEach(room => {
    const poly = room.polygon || [
      [room.x, room.y], [room.x + room.w, room.y],
      [room.x + room.w, room.y + room.h], [room.x, room.y + room.h],
    ];
    const points = poly.map(p => `${p[0]},${p[1]}`).join(' ');
    svg += `<polygon points="${points}" fill="${room.color}" opacity="0.3"/>\n`;
    const cx = room.x + room.w / 2;
    const cy = room.y + room.h / 2;
    svg += `<text class="label" x="${cx}" y="${cy - 0.5}">${room.label}</text>\n`;
    svg += `<text class="area" x="${cx}" y="${cy + 0.6}">${fmtArea(room.w, room.h)}</text>\n`;
    svg += `<text class="dim" x="${cx}" y="${room.y + room.h + 0.5}">${fmt(room.w)} ${unit}</text>\n`;
    svg += `<text class="dim" x="${room.x - 0.5}" y="${cy}" transform="rotate(-90 ${room.x - 0.5} ${cy})">${fmt(room.h)} ${unit}</text>\n`;
  });

  // Poché walls (filled quads).
  if (walls) {
    const wallQuads = generateWallQuads(walls);
    wallQuads.forEach(quad => {
      const points = quad.map(p => `${p[0]},${p[1]}`).join(' ');
      svg += `<polygon points="${points}" fill="#1B2A4A"/>\n`;
    });
  }

  // Doors.
  if (doors) {
    doors.forEach(door => {
      const r = door.width;
      if (door.horizontal) {
        svg += `<rect x="${door.x}" y="${door.y - 0.15}" width="${r}" height="0.3" fill="#FAFAF8"/>\n`;
        svg += `<line x1="${door.x}" y1="${door.y}" x2="${door.x + r}" y2="${door.y}" stroke="#C8956C" stroke-width="0.06"/>\n`;
        const dir = door.swingDir === 'in' ? -1 : 1;
        const endX = door.x + r + r * Math.cos(Math.PI + dir * Math.PI / 2);
        const endY = door.y + r * Math.sin(Math.PI + dir * Math.PI / 2);
        svg += `<path d="M ${door.x} ${door.y} A ${r} ${r} 0 0 ${door.swingDir === 'in' ? 0 : 1} ${endX} ${endY}" fill="none" stroke="#C8956C" stroke-width="0.05"/>\n`;
      } else {
        svg += `<rect x="${door.x - 0.15}" y="${door.y}" width="0.3" height="${r}" fill="#FAFAF8"/>\n`;
        svg += `<line x1="${door.x}" y1="${door.y}" x2="${door.x}" y2="${door.y + r}" stroke="#C8956C" stroke-width="0.06"/>\n`;
        const dir = door.swingDir === 'in' ? 1 : -1;
        const endX = door.x + r * Math.sin(-Math.PI / 2 + dir * Math.PI / 2);
        const endY = door.y + r + r * Math.cos(-Math.PI / 2 + dir * Math.PI / 2);
        svg += `<path d="M ${door.x} ${door.y + r} A ${r} ${r} 0 0 ${door.swingDir === 'in' ? 0 : 1} ${endX} ${endY}" fill="none" stroke="#C8956C" stroke-width="0.05"/>\n`;
      }
    });
  }

  // Rulers.
  for (let gx = 0; gx <= boundary.width; gx += 5) {
    svg += `<text class="ruler" x="${gx}" y="-0.3">${fmt(gx)}</text>\n`;
  }
  for (let gy = 0; gy <= boundary.height; gy += 5) {
    svg += `<text class="ruler" x="-0.8" y="${gy}" text-anchor="end">${fmt(gy)}</text>\n`;
  }

  svg += '</svg>';
  return svg;
}

export function exportSVG(layout, displayUnit) {
  const blob = new Blob([buildSVG(layout, displayUnit)], { type: 'image/svg+xml;charset=utf-8' });
  triggerDownload(blob, 'floor-plan.svg');
}

export function exportJSON(layout, roomSpecs, totalArea, unit) {
  const data = {
    version: '1.0',
    unit,
    totalArea,
    boundary: layout.boundary,
    rooms: layout.rooms.map(r => ({
      id: r.id,
      type: r.roomType || r.type,
      label: r.label,
      x: r.x, y: r.y,
      w: r.w, h: r.h,
      area: Math.round(r.actualArea || r.w * r.h),
      color: r.color,
    })),
    walls: layout.walls,
    doors: layout.doors || [],
    specs: roomSpecs.filter(r => r.count > 0).map(r => ({
      type: r.type, label: r.label, area: r.area, count: r.count,
    })),
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  triggerDownload(blob, 'floor-plan.json');
}

// Build a fresh, complete model from the layout so exports always include the
// full building (walls, openings, furniture, ceilings, roof) regardless of what
// the live viewer is currently showing.
async function buildExportModel(layout, themeId) {
  const { buildModel } = await import('./model3d.js');
  let themeData = null;
  if (themeId) {
    const { getTheme } = await import('./themes.js');
    themeData = getTheme(themeId);
  }
  return buildModel(layout, { forExport: true, themeData });
}

export function exportGLTF(layout, themeId) {
  return new Promise(async (resolve, reject) => {
    let dispose;
    try {
      const model = await buildExportModel(layout, themeId);
      dispose = model.dispose;
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const exporter = new GLTFExporter();
      exporter.parse(
        model.root,
        (result) => {
          const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
          triggerDownload(blob, 'floor-plan-3d.gltf');
          dispose?.();
          resolve();
        },
        (error) => { dispose?.(); reject(error); },
        { binary: false, onlyVisible: false, includeCustomExtensions: false }
      );
    } catch (err) {
      dispose?.();
      reject(err);
    }
  });
}

export function exportGLB(layout, themeId) {
  return new Promise(async (resolve, reject) => {
    let dispose;
    try {
      const model = await buildExportModel(layout, themeId);
      dispose = model.dispose;
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const exporter = new GLTFExporter();
      exporter.parse(
        model.root,
        (result) => {
          const blob = new Blob([result], { type: 'application/octet-stream' });
          triggerDownload(blob, 'floor-plan-3d.glb');
          dispose?.();
          resolve();
        },
        (error) => { dispose?.(); reject(error); },
        { binary: true, onlyVisible: false, includeCustomExtensions: false }
      );
    } catch (err) {
      dispose?.();
      reject(err);
    }
  });
}

export function exportOBJ(layout, themeId) {
  return new Promise(async (resolve, reject) => {
    let dispose;
    try {
      const model = await buildExportModel(layout, themeId);
      dispose = model.dispose;
      const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
      const result = new OBJExporter().parse(model.root);
      triggerDownload(new Blob([result], { type: 'text/plain' }), 'floor-plan-3d.obj');
      dispose();
      resolve();
    } catch (err) {
      dispose?.();
      reject(err);
    }
  });
}

export function exportSTL(layout, themeId) {
  return new Promise(async (resolve, reject) => {
    let dispose;
    try {
      const model = await buildExportModel(layout, themeId);
      dispose = model.dispose;
      const { STLExporter } = await import('three/examples/jsm/exporters/STLExporter.js');
      const result = new STLExporter().parse(model.root, { binary: true });
      triggerDownload(new Blob([result], { type: 'application/octet-stream' }), 'floor-plan-3d.stl');
      dispose();
      resolve();
    } catch (err) {
      dispose?.();
      reject(err);
    }
  });
}
