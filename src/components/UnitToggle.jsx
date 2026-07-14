import React from 'react';

export default function UnitToggle({ unit, onToggle }) {
  return (
    <div className="toggle-group">
      <button
        className={`toggle-btn ${unit === 'sqft' ? 'active' : ''}`}
        onClick={() => onToggle('sqft')}
      >
        ft²
      </button>
      <button
        className={`toggle-btn ${unit === 'sqm' ? 'active' : ''}`}
        onClick={() => onToggle('sqm')}
      >
        m²
      </button>
    </div>
  );
}