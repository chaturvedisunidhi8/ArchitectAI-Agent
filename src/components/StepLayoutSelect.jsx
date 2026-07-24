import React, { useMemo } from 'react';
import LayoutThumbnail from './LayoutThumbnail.jsx';

export default function StepLayoutSelect({ variants, selectedIndex, onSelect, onCustomize, onFreeform, onConfirm, onBack }) {
  if (!variants || variants.length === 0) {
    return (
      <div className="empty-state">
        <h3>No layouts generated</h3>
        <p>Something went wrong. Go back and try again.</p>
      </div>
    );
  }

  const autoCount = variants.filter(v => !v.isCustom).length;
  const customIndex = variants.findIndex(v => v.isCustom);
  const customVariant = customIndex !== -1 ? variants[customIndex] : null;

  return (
    <div className="fade-in">
      <div className="section-label">Choose a layout</div>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        We generated {autoCount} different arrangements for your rooms.
        Click one to select it, or build your own below.
      </p>

      <div className="layout-select-grid">
        {variants.map((variant, i) => {
          if (variant.isCustom) return null;
          return (
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
          );
        })}
      </div>

      {customVariant && (
        <div className="customize-section">
          <div className="section-label" style={{ marginTop: 18, marginBottom: 8 }}>Build your own</div>
          <div
            className={`layout-option custom-option ${selectedIndex === customIndex ? 'selected' : ''}`}
            onClick={() => onCustomize(customIndex)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onCustomize(customIndex); } }}
          >
            <div className="custom-option-body">
              <div className="custom-option-icon" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="7" height="7" rx="1" stroke="var(--color-accent)" strokeWidth="1.6" />
                  <rect x="3" y="14" width="7" height="7" rx="1" stroke="var(--color-accent)" strokeWidth="1.6" />
                  <rect x="14" y="14" width="7" height="7" rx="1" stroke="var(--color-accent)" strokeWidth="1.6" />
                  <line x1="17.5" y1="3.5" x2="17.5" y2="10.5" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
                  <line x1="14" y1="7" x2="21" y2="7" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </div>
              <div className="custom-option-text">
                <div className="layout-option-name">Custom Layout</div>
                <div className="layout-option-desc">
                  Open the builder to arrange every section yourself — drag, resize, swap and rotate rooms.
                </div>
                <div className="layout-option-stats">
                  <span className="layout-option-stat">{customVariant.stats.roomCount} rooms</span>
                  <span className="layout-option-stat">{customVariant.stats.dimensions} ft</span>
                </div>
              </div>
              <div className="custom-option-cta">Open builder →</div>
            </div>
          </div>

          {onFreeform && (
            <div
              className="layout-option custom-option"
              onClick={onFreeform}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFreeform(); } }}
              style={{ marginTop: 8 }}
            >
              <div className="custom-option-body">
                <div className="custom-option-icon" aria-hidden="true">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                    <path d="M3 17L9 11L13 15L21 7" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M14 7H21V14" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="5" cy="19" r="2" stroke="var(--color-accent)" strokeWidth="1.2" strokeDasharray="2 1.5" />
                  </svg>
                </div>
                <div className="custom-option-text">
                  <div className="layout-option-name">Freeform Layout</div>
                  <div className="layout-option-desc">
                    Draw your own boundary shape and freely place, reshape, and rotate rooms as arbitrary polygons.
                  </div>
                </div>
                <div className="custom-option-cta">Open freeform →</div>
              </div>
            </div>
          )}
        </div>
      )}

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
