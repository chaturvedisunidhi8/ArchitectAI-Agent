import React from 'react';
import FloorPlanCanvas from './FloorPlanCanvas.jsx';

/**
 * CustomLayoutBuilder — the "build your own" workspace opened from the Custom
 * Layout option. Shows every room ("section") in a side panel plus an
 * interactive canvas so the user can create their own layout: drag to
 * reposition, drop on another room to swap, and select a section to resize or
 * rotate it. Confirming carries the arranged layout forward to theme selection.
 */
export default function CustomLayoutBuilder({
  layout, selectedRoomId, onSelectRoom, displayUnit, totalAreaFt,
  onMoveRoom, onSwapRooms, onEditRoom, onRotateRoom,
  canUndo, canRedo, onUndo, onRedo,
  onReset, onCancel, onConfirm,
}) {
  if (!layout) return null;

  const selectedRoom = selectedRoomId ? layout.rooms.find(r => r.id === selectedRoomId) : null;

  return (
    <>
      <div className="main-toolbar">
        <span className="toolbar-label" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, color: 'var(--color-primary)', textTransform: 'none', fontSize: 13 }}>
          Custom Layout Builder
        </span>
        <div className="toolbar-separator" />
        <span className="toolbar-label" style={{ whiteSpace: 'nowrap' }}>
          {layout.rooms.length} rooms · {layout.boundary.width.toFixed(1)} × {layout.boundary.height.toFixed(1)} ft
        </span>

        <div style={{ flex: 1 }} />

        <button className="btn btn-ghost btn-sm" onClick={onUndo} disabled={!canUndo} title="Undo">↩</button>
        <button className="btn btn-ghost btn-sm" onClick={onRedo} disabled={!canRedo} title="Redo">↪</button>
        <div className="toolbar-separator" />
        <button className="btn btn-secondary btn-sm" onClick={onReset} title="Restore the original starting layout">↺ Reset Layout</button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>← Layouts</button>
        <button className="btn btn-primary btn-sm" onClick={onConfirm}>Use This Layout →</button>
      </div>

      <div className="main-canvas">
        <FloorPlanCanvas
          layout={layout}
          selectedRoomId={selectedRoomId}
          onSelectRoom={onSelectRoom}
          displayUnit={displayUnit}
          totalAreaFt={totalAreaFt}
          onSwapRooms={onSwapRooms}
          onMoveRoom={onMoveRoom}
        />

        <div className="custom-builder-panel">
          <div className="cb-title">Sections · {layout.rooms.length}</div>
          <div className="cb-list">
            {layout.rooms.map(room => (
              <div
                key={room.id}
                className={`cb-item ${selectedRoomId === room.id ? 'selected' : ''}`}
                onClick={() => onSelectRoom(room.id === selectedRoomId ? null : room.id)}
              >
                <span className="cb-item-swatch" style={{ background: room.color }} />
                <span className="cb-item-name">{room.label}</span>
                <span className="cb-item-dims">{room.w.toFixed(1)}×{room.h.toFixed(1)}</span>
              </div>
            ))}
          </div>

          {selectedRoom ? (
            <div className="cb-edit">
              <div className="cb-edit-title">
                <span className="cb-item-swatch" style={{ background: selectedRoom.color, display: 'inline-block', marginRight: 6 }} />
                {selectedRoom.label}
              </div>
              <div className="cb-row">
                <div className="cb-field">
                  <label>Width (ft)</label>
                  <input
                    type="number" min={3} step={0.5} value={selectedRoom.w}
                    onChange={(e) => onEditRoom(selectedRoom.id, { w: Number(e.target.value) || selectedRoom.w })}
                  />
                </div>
                <div className="cb-field">
                  <label>Height (ft)</label>
                  <input
                    type="number" min={3} step={0.5} value={selectedRoom.h}
                    onChange={(e) => onEditRoom(selectedRoom.id, { h: Number(e.target.value) || selectedRoom.h })}
                  />
                </div>
              </div>
              <button className="btn btn-secondary btn-sm btn-full" onClick={() => onRotateRoom(selectedRoom.id)}>
                ⟳ Rotate 90°
              </button>
            </div>
          ) : (
            <div className="cb-hint">Select a section to resize or rotate it.</div>
          )}
        </div>
      </div>

      <div className="canvas-hint">
        Drag a section to reposition · Drop it on another to swap · Select a section to resize or rotate · Scroll to zoom
      </div>
    </>
  );
}
