import React from 'react';
import { THEMES } from '../engine/themes.js';

export default function StepThemeSelect({ selectedTheme, onSelect, onConfirm, onBack }) {
  return (
    <div className="fade-in">
      <div className="section-label">Choose interior style</div>
      <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        Select an interior design theme. You can always change it later.
      </p>

      <div className="theme-grid">
        {THEMES.map(theme => (
          <div
            key={theme.id}
            className={`theme-card ${selectedTheme === theme.id ? 'selected' : ''}`}
            onClick={() => onSelect(theme.id)}
          >
            <div className="theme-card-preview">
              <div className="theme-card-swatch" style={{ background: theme.preview.wall }} />
              <div className="theme-card-swatch" style={{ background: theme.preview.floor }} />
              <div className="theme-card-swatch" style={{ background: theme.preview.accent }} />
              <div className="theme-card-swatch" style={{ background: theme.preview.fabric }} />
            </div>
            <div className="theme-card-body">
              <div className="theme-card-name">{theme.name}</div>
              <div className="theme-card-desc">{theme.desc}</div>
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
          disabled={!selectedTheme}
          style={{ flex: 1 }}
        >
          Apply Theme & Build 3D →
        </button>
      </div>
    </div>
  );
}
