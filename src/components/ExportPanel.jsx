import React, { useState } from 'react';

export default function ExportPanel({ layout, displayUnit, totalArea, unit, roomSpecs, canvasRef, onClose, theme }) {
  const [exporting, setExporting] = useState(null);
  const [lastExported, setLastExported] = useState(null);

  const handleExport = async (format) => {
    setExporting(format);
    try {
      const {
        exportPNG, exportSVG, exportJSON, exportGLTF, exportGLB, exportOBJ, exportSTL,
      } = await import('../engine/exporters.js');

      switch (format) {
        case 'png': {
          const cvs = canvasRef?.current?.getCanvas?.();
          if (cvs) await exportPNG(cvs);
          break;
        }
        case 'svg':
          exportSVG(layout, displayUnit);
          break;
        case 'json':
          exportJSON(layout, roomSpecs, totalArea, unit);
          break;
        case 'gltf':
          if (layout) await exportGLTF(layout, theme);
          break;
        case 'glb':
          if (layout) await exportGLB(layout, theme);
          break;
        case 'obj':
          if (layout) await exportOBJ(layout, theme);
          break;
        case 'stl':
          if (layout) await exportSTL(layout, theme);
          break;
      }
      setLastExported(format);
      setTimeout(() => setLastExported(null), 2000);
    } catch (err) {
      console.error('Export failed:', err);
    }
    setExporting(null);
  };

  const fmt = (v) => displayUnit === 'm²' ? (v * 0.3048).toFixed(1) + ' m' : v.toFixed(1) + ' ft';
  const fmtArea = (sqft) => displayUnit === 'm²' ? (sqft * 0.092903).toFixed(1) + ' m²' : sqft + ' ft²';

  return (
    <div className="export-overlay" onClick={onClose}>
      <div className="export-panel fade-in" onClick={e => e.stopPropagation()}>
        <div className="export-header">
          <h2>Export Floor Plan</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 18, padding: '2px 8px' }}>✕</button>
        </div>

        <div className="export-body">
          {/* Layout summary */}
          <div className="export-summary">
            <div className="export-summary-row">
              <span className="export-summary-label">Boundary</span>
              <span className="export-summary-value">{fmt(layout.boundary.width)} × {fmt(layout.boundary.height)}</span>
            </div>
            <div className="export-summary-row">
              <span className="export-summary-label">Total Area</span>
              <span className="export-summary-value">{fmtArea(Math.round(layout.boundary.width * layout.boundary.height))}</span>
            </div>
            <div className="export-summary-row">
              <span className="export-summary-label">Rooms</span>
              <span className="export-summary-value">{layout.rooms.length}</span>
            </div>
          </div>

          {/* 2D Exports */}
          <div className="export-section">
            <div className="export-section-header">
              <span className="export-section-icon">2D</span>
              <span className="export-section-title">2D Floor Plan</span>
            </div>
            <div className="export-grid">
              <button
                className={`export-card ${lastExported === 'png' ? 'exported' : ''}`}
                onClick={() => handleExport('png')}
                disabled={exporting || !canvasRef?.current}
              >
                <div className="export-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </div>
                <div className="export-card-info">
                  <span className="export-card-name">PNG Image</span>
                  <span className="export-card-desc">Raster image of the 2D canvas</span>
                </div>
                {exporting === 'png' && <span className="export-spinner" />}
                {lastExported === 'png' && <span className="export-check">✓</span>}
              </button>

              <button
                className={`export-card ${lastExported === 'svg' ? 'exported' : ''}`}
                onClick={() => handleExport('svg')}
                disabled={exporting}
              >
                <div className="export-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 3v4a1 1 0 001 1h4" />
                    <path d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z" />
                    <path d="M9 13h6M9 17h4" />
                  </svg>
                </div>
                <div className="export-card-info">
                  <span className="export-card-name">SVG Vector</span>
                  <span className="export-card-desc">Scalable vector, editable</span>
                </div>
                {exporting === 'svg' && <span className="export-spinner" />}
                {lastExported === 'svg' && <span className="export-check">✓</span>}
              </button>

              <button
                className={`export-card ${lastExported === 'json' ? 'exported' : ''}`}
                onClick={() => handleExport('json')}
                disabled={exporting}
              >
                <div className="export-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M14 3v4a1 1 0 001 1h4" />
                    <path d="M17 21H7a2 2 0 01-2-2V5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2z" />
                    <path d="M8 12h8M8 16h6" />
                  </svg>
                </div>
                <div className="export-card-info">
                  <span className="export-card-name">JSON Data</span>
                  <span className="export-card-desc">Layout coordinates for import</span>
                </div>
                {exporting === 'json' && <span className="export-spinner" />}
                {lastExported === 'json' && <span className="export-check">✓</span>}
              </button>
            </div>
          </div>

          {/* 3D Exports */}
          <div className="export-section">
            <div className="export-section-header">
              <span className="export-section-icon">3D</span>
              <span className="export-section-title">3D Model</span>
            </div>
            <div className="export-grid">
              <button
                className={`export-card ${lastExported === 'glb' ? 'exported' : ''}`}
                onClick={() => handleExport('glb')}
                disabled={exporting || !layout}
              >
                <div className="export-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
                  </svg>
                </div>
                <div className="export-card-info">
                  <span className="export-card-name">GLB Binary</span>
                  <span className="export-card-desc">Compact 3D binary, game-ready</span>
                </div>
                {exporting === 'glb' && <span className="export-spinner" />}
                {lastExported === 'glb' && <span className="export-check">✓</span>}
              </button>

              <button
                className={`export-card ${lastExported === 'gltf' ? 'exported' : ''}`}
                onClick={() => handleExport('gltf')}
                disabled={exporting || !layout}
              >
                <div className="export-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
                  </svg>
                </div>
                <div className="export-card-info">
                  <span className="export-card-name">GLTF JSON</span>
                  <span className="export-card-desc">Standard 3D format, editable</span>
                </div>
                {exporting === 'gltf' && <span className="export-spinner" />}
                {lastExported === 'gltf' && <span className="export-check">✓</span>}
              </button>

              <button
                className={`export-card ${lastExported === 'obj' ? 'exported' : ''}`}
                onClick={() => handleExport('obj')}
                disabled={exporting || !layout}
              >
                <div className="export-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 2L2 7l10 5 10-5-10-5z" />
                    <path d="M2 17l10 5 10-5M2 12l10 5 10-5" />
                  </svg>
                </div>
                <div className="export-card-info">
                  <span className="export-card-name">OBJ Mesh</span>
                  <span className="export-card-desc">Universal mesh format</span>
                </div>
                {exporting === 'obj' && <span className="export-spinner" />}
                {lastExported === 'obj' && <span className="export-check">✓</span>}
              </button>

              <button
                className={`export-card ${lastExported === 'stl' ? 'exported' : ''}`}
                onClick={() => handleExport('stl')}
                disabled={exporting || !layout}
              >
                <div className="export-card-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                    <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
                  </svg>
                </div>
                <div className="export-card-info">
                  <span className="export-card-name">STL Print</span>
                  <span className="export-card-desc">For 3D printing and CAD</span>
                </div>
                {exporting === 'stl' && <span className="export-spinner" />}
                {lastExported === 'stl' && <span className="export-check">✓</span>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
