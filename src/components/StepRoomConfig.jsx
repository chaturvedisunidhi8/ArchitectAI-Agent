import React from 'react';
import RoomCard from './RoomCard.jsx';

export default function StepRoomConfig({
  roomSpecs, totalArea, totalUsedArea, areaRemaining, areaPercent,
  displayUnit, unit, onAreaChange, onIncrement, onDecrement, onToggle, onNext, onBack,
}) {
  const overBudget = totalUsedArea > totalArea;
  const fillPercent = Math.min(100, areaPercent);
  const fillColor = overBudget ? 'var(--color-danger)' : areaPercent > 85 ? 'var(--color-warning)' : 'var(--color-accent)';

  const selectedCount = roomSpecs.reduce((s, r) => s + r.count, 0);

  return (
    <div className="fade-in">
      <div className="section-label">Select rooms & set areas</div>

      <div className="room-list">
        {roomSpecs.map(spec => (
          <RoomCard
            key={spec.type}
            spec={spec}
            displayUnit={displayUnit}
            onToggle={() => onToggle(spec.type)}
            onAreaChange={(val) => onAreaChange(spec.type, 'area', val)}
            onIncrement={() => onIncrement(spec.type)}
            onDecrement={() => onDecrement(spec.type)}
          />
        ))}
      </div>

      <div className="area-budget">
        <div className="area-budget-header">
          <span className="area-budget-label">Area Budget</span>
          <span className="area-budget-value" style={{ color: overBudget ? 'var(--color-danger)' : 'var(--color-text)' }}>
            {totalUsedArea} / {totalArea} {displayUnit}
          </span>
        </div>
        <div className="area-budget-bar">
          <div className="area-budget-fill" style={{ width: fillPercent + '%', background: fillColor }} />
        </div>
        <div className="area-budget-footer">
          <span>{fillPercent.toFixed(1)}% used \u00B7 {selectedCount} rooms</span>
          <span style={{ color: overBudget ? 'var(--color-danger)' : undefined }}>
            {areaRemaining >= 0
              ? `${areaRemaining} ${displayUnit} remaining`
              : `${Math.abs(areaRemaining)} ${displayUnit} over`
            }
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button className="btn btn-secondary" onClick={onBack} style={{ flex: '0 0 auto' }}>
          \u2190 Back
        </button>
        <button
          className="btn btn-primary"
          onClick={onNext}
          disabled={overBudget || selectedCount === 0}
          style={{ flex: 1 }}
        >
          Generate Floor Plan \u2192
        </button>
      </div>
    </div>
  );
}
