import React from 'react';

export default function RoomCard({ spec, displayUnit, onToggle, onAreaChange, onIncrement, onDecrement }) {
  const isSelected = spec.count > 0;

  return (
    <div className={`room-card ${isSelected ? 'selected' : ''}`}>
      <div
        className={`room-checkbox ${isSelected ? 'checked' : ''}`}
        onClick={onToggle}
        role="checkbox"
        aria-checked={isSelected}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle(); } }}
      />
      <div className="room-swatch" style={{ background: spec.color }} />
      <div className="room-info">
        <div className="room-name">{spec.label}</div>
        <div className="room-meta">min {spec.minArea} {displayUnit}</div>
      </div>
      {isSelected && (
        <div className="room-count">
          <button onClick={onDecrement} aria-label={`Decrease ${spec.label}`}>\u2212</button>
          <span>{spec.count}</span>
          <button onClick={onIncrement} aria-label={`Increase ${spec.label}`}>+</button>
        </div>
      )}
      <input
        type="number"
        className="room-area-input"
        value={spec.area}
        onChange={(e) => onAreaChange(Math.max(spec.minArea, Number(e.target.value) || 0))}
        disabled={!isSelected}
        min={spec.minArea}
        title={`Area in ${displayUnit}`}
        aria-label={`${spec.label} area`}
      />
      <span className="room-meta" style={{ fontSize: 10, minWidth: 24 }}>{displayUnit}</span>
    </div>
  );
}
