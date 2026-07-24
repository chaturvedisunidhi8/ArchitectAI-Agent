import React, { useMemo } from 'react';
import { generateWallQuads } from '../engine/geometry.js';

/**
 * LayoutThumbnail — renders a small, static SVG preview of a floor plan layout.
 * Used in the layout selection grid for comparing variants.
 */
export default function LayoutThumbnail({ layout }) {
  const { svg, viewWidth, viewHeight } = useMemo(() => {
    if (!layout) return { svg: '', viewWidth: 200, viewHeight: 150 };

    const { boundary, rooms, walls } = layout;
    const pad = 1;
    const vw = boundary.width + pad * 2;
    const vh = boundary.height + pad * 2;
    const scale = Math.min(180 / vw, 120 / vh);

    const parts = [];
    parts.push(`<rect x="${pad}" y="${pad}" width="${boundary.width}" height="${boundary.height}" fill="#FAFAF8" stroke="#E5E3DE" stroke-width="0.1"/>`);

    // Room polygons.
    rooms.forEach(room => {
      const poly = room.polygon || [
        [room.x, room.y], [room.x + room.w, room.y],
        [room.x + room.w, room.y + room.h], [room.x, room.y + room.h],
      ];
      const points = poly.map(p => `${p[0]},${p[1]}`).join(' ');
      parts.push(`<polygon points="${points}" fill="${room.color}" opacity="0.35"/>`);
      const cx = room.x + room.w / 2;
      const cy = room.y + room.h / 2;
      const fontSize = Math.max(0.7, Math.min(1.2, Math.min(room.w, room.h) * 0.12));
      parts.push(`<text x="${cx}" y="${cy - fontSize * 0.3}" text-anchor="middle" font-size="${fontSize}" font-family="DM Sans, sans-serif" font-weight="600" fill="#1B2A4A">${room.label}</text>`);
      const areaFontSize = fontSize * 0.7;
      parts.push(`<text x="${cx}" y="${cy + fontSize * 0.7}" text-anchor="middle" font-size="${areaFontSize}" font-family="JetBrains Mono, monospace" fill="#9A9A9A">${Math.round(room.w * room.h)}</text>`);
    });

    // Poché walls.
    if (walls) {
      const quads = generateWallQuads(walls);
      quads.forEach(quad => {
        const points = quad.map(p => `${p[0]},${p[1]}`).join(' ');
        parts.push(`<polygon points="${points}" fill="#1B2A4A"/>`);
      });
    }

    return {
      svg: parts.join('\n'),
      viewWidth: vw * scale,
      viewHeight: vh * scale,
    };
  }, [layout]);

  if (!layout) return null;

  const { boundary } = layout;
  const pad = 1;
  const vw = boundary.width + pad * 2;
  const vh = boundary.height + pad * 2;

  return (
    <svg
      className="layout-option-thumb"
      viewBox={`${-pad} ${-pad} ${vw} ${vh}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ background: '#F5F3EF' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
