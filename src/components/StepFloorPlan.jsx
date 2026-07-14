import React, { useState } from 'react';
import FloorPlanCanvas from './FloorPlanCanvas.jsx';
import FloorPlan3D from './FloorPlan3D.jsx';

export default function StepFloorPlan({
  layout, selectedRoomId, onSelectRoom, displayUnit, totalAreaFt,
  onBack, onSwapRooms, onRegenerate, onMoveRoom, roomSpecs, unit,
  canUndo, canRedo, onUndo, onRedo,
  onOpenExport, canvasRef, editor, onLoad, onClear,
  theme, showInsights, onToggleInsights,
}) {
  const [viewMode, setViewMode] = useState('2d');

  if (!layout) {
    return (
      <div className="empty-state">
        <h3>No layout generated</h3>
        <p>Go back and configure your rooms, then generate a floor plan.</p>
      </div>
    );
  }

  const selectedRoom = selectedRoomId ? layout.rooms.find(r => r.id === selectedRoomId) : null;

  return (
    <>
      <div className="main-toolbar">
        <span className="toolbar-label">View</span>
        <div className="toggle-group">
          <button
            className={`toggle-btn ${viewMode === '2d' ? 'active' : ''}`}
            onClick={() => setViewMode('2d')}
          >
            2D
          </button>
          <button
            className={`toggle-btn ${viewMode === '3d' ? 'active' : ''}`}
            onClick={() => setViewMode('3d')}
          >
            3D
          </button>
        </div>

        <div className="toolbar-separator" />

        <span className="toolbar-label" style={{ whiteSpace: 'nowrap' }}>
          {layout.rooms.length} rooms · {layout.boundary.width.toFixed(1)} × {layout.boundary.height.toFixed(1)} ft
        </span>

        {selectedRoom && (
          <>
            <div className="toolbar-separator" />
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 500,
              color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: selectedRoom.color, display: 'inline-block' }} />
              {selectedRoom.label}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-muted)' }}>
              {selectedRoom.w.toFixed(1)} × {selectedRoom.h.toFixed(1)} ft · {Math.round(selectedRoom.w * selectedRoom.h)} ft²
            </span>
          </>
        )}

        <div style={{ flex: 1 }} />

        <button className="btn btn-ghost btn-sm" onClick={onUndo} disabled={!canUndo} title="Undo">
          ↩
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onRedo} disabled={!canRedo} title="Redo">
          ↪
        </button>

        <div className="toolbar-separator" />

        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          Edit Rooms
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onRegenerate}>
          Re-layout
        </button>
        <div className="toolbar-separator" />
        <button className="btn btn-primary btn-sm" onClick={onOpenExport}>
          ↓ Download
        </button>
      </div>

      <div className="main-canvas">
        {viewMode === '2d' ? (
          <FloorPlanCanvas
            ref={canvasRef}
            layout={layout}
            selectedRoomId={selectedRoomId}
            onSelectRoom={onSelectRoom}
            displayUnit={displayUnit}
            totalAreaFt={totalAreaFt}
            onSwapRooms={onSwapRooms}
            onMoveRoom={onMoveRoom}
          />
        ) : (
          <FloorPlan3D
            layout={layout}
            editor={editor}
            theme={theme}
          />
        )}
      </div>

      {viewMode === '2d' ? (
        <div className="canvas-hint">
          Drag rooms to reposition · Drag background to pan · Scroll to zoom · Drop room on another to swap
        </div>
      ) : (
        <div className="canvas-hint">
          Orbit: drag to rotate · scroll to zoom · Walk: switch camera, then click to look and move with W A S D · Toggle roof / ceilings to see inside
        </div>
      )}
    </>
  );
}
