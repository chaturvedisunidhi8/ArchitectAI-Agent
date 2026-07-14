import React, { useMemo } from 'react';
import LayoutThumbnail from './LayoutThumbnail.jsx';

export default function StepLayoutSelect({ variants, selectedIndex, onSelect, onConfirm, onBack }) {
  if (!variants || variants.length === 0) {
    return (
      <div className="empty-state">
        <h3>No layouts generated</h3>
        <p>Something went wrong. Go back and try again.</p>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="section-label">Choose a layout</div>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        We generated {variants.length} different arrangements for your rooms.
        Click one to select it, then confirm.
      </p>

      <div className="layout-select-grid">
        {variants.map((variant, i) => (
          <div
            key={variant.id}
            className={`layout-option ${selectedIndex === i ? 'selected' : ''}`}
            onClick={() => onSelect(i)}
          >
            {i === 0 && <div className="layout-option-badge">Recommended</div>}
            <LayoutThumbnail layout={variant.layout} />
            <div className="layout-option-info">
              <div className="layout-option-name">{variant.name}</div>
              <div className="layout-option-desc">{variant.desc}</div>
              <div className="layout-option-stats">
                <span className="layout-option-stat">{variant.stats.roomCount} rooms</span>
                <span className="layout-option-stat">{variant.stats.dimensions} ft</span>
                <span className="layout-option-stat">{variant.stats.efficiency}% efficient</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button className="btn btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <button
          className="btn btn-primary"
          onClick={onConfirm}
          disabled={selectedIndex === null}
          style={{ flex: 1 }}
        >
          Use This Layout →
        </button>
      </div>
    </div>
  );
}
