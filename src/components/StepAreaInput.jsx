import React, { useState, useCallback } from 'react';
import UnitToggle from './UnitToggle.jsx';
import { SQFT_TO_SQM, SQM_TO_SQFT } from '../engine/constants.js';

export default function StepAreaInput({ totalArea, setTotalArea, unit, setUnit, onNext }) {
  const displayUnit = unit === 'sqft' ? 'ft\u00B2' : 'm\u00B2';
  const lengthUnit = unit === 'sqft' ? 'ft' : 'm';
  const conversionUnit = unit === 'sqft' ? 'm\u00B2' : 'ft\u00B2';
  const convertFactor = unit === 'sqft' ? SQFT_TO_SQM : SQM_TO_SQFT;

  const converted = (totalArea * convertFactor).toFixed(unit === 'sqft' ? 1 : 0);

  const [useDimensions, setUseDimensions] = useState(false);
  const [dims, setDims] = useState({ w: 40, h: 30 });

  const setFromArea = useCallback((val) => {
    setTotalArea(Math.max(100, val || 0));
    if (useDimensions) {
      const newH = Math.round(val / dims.w * 10) / 10;
      setDims(d => ({ ...d, h: Math.max(5, newH) }));
    }
  }, [setTotalArea, useDimensions, dims.w]);

  const setFromWidth = useCallback((val) => {
    const w = Math.max(5, val || 0);
    setDims(d => {
      const newArea = Math.round(w * d.h);
      setTotalArea(Math.max(100, newArea));
      return { ...d, w };
    });
  }, [setTotalArea]);

  const setFromHeight = useCallback((val) => {
    const h = Math.max(5, val || 0);
    setDims(d => {
      const newArea = Math.round(d.w * h);
      setTotalArea(Math.max(100, newArea));
      return { ...d, h };
    });
  }, [setTotalArea]);

  const toggleDimensions = useCallback(() => {
    if (!useDimensions) {
      const h = Math.round(Math.sqrt(totalArea / 1.35) * 10) / 10;
      const w = Math.round(totalArea / h * 10) / 10;
      setDims({ w, h });
    }
    setUseDimensions(v => !v);
  }, [useDimensions, totalArea]);

  const previewW = useDimensions ? dims.w : Math.round(Math.sqrt(totalArea * 1.35) * 10) / 10;
  const previewH = useDimensions ? dims.h : Math.round(totalArea / previewW * 10) / 10;
  const maxSvg = Math.max(previewW, previewH);
  const svgScale = 160 / maxSvg;
  const svgW = previewW * svgScale;
  const svgH = previewH * svgScale;
  const svgOx = (200 - svgW) / 2;
  const svgOy = (120 - svgH) / 2;

  return (
    <div className="fade-in">
      <div className="section-label">Total flat area</div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <UnitToggle unit={unit} onToggle={setUnit} />
        <button className="btn btn-ghost btn-sm" onClick={toggleDimensions}>
          {useDimensions ? 'Area only' : 'Set dimensions'}
        </button>
      </div>

      <div className="input-group" style={{ marginBottom: 14 }}>
        <label className="input-label">Total area of your flat</label>
        <div className="input-with-unit">
          <input
            type="number"
            className="input-field"
            value={totalArea}
            onChange={(e) => setFromArea(Number(e.target.value))}
            min={100}
            placeholder="e.g. 1200"
          />
          <div className="input-unit">{displayUnit}</div>
        </div>
      </div>

      {useDimensions && (
        <div className="fade-in" style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <div className="input-group" style={{ flex: 1 }}>
            <label className="input-label">Width</label>
            <div className="input-with-unit">
              <input
                type="number"
                className="input-field"
                value={dims.w}
                onChange={(e) => setFromWidth(Number(e.target.value))}
                min={5}
              />
              <div className="input-unit">{lengthUnit}</div>
            </div>
          </div>
          <div style={{ alignSelf: 'center', color: 'var(--color-text-muted)', fontSize: 14, paddingTop: 18 }}>\u00D7</div>
          <div className="input-group" style={{ flex: 1 }}>
            <label className="input-label">Height</label>
            <div className="input-with-unit">
              <input
                type="number"
                className="input-field"
                value={dims.h}
                onChange={(e) => setFromHeight(Number(e.target.value))}
                min={5}
              />
              <div className="input-unit">{lengthUnit}</div>
            </div>
          </div>
        </div>
      )}

      <div className="conversion-hint">
        \u2248 {converted} {conversionUnit}
      </div>

      <div className="preview-box">
        <div className="preview-label">Preview</div>
        <svg width="100%" viewBox="0 0 200 120" style={{ display: 'block' }}>
          <rect
            x={svgOx} y={svgOy}
            width={svgW} height={svgH}
            rx="1"
            fill="rgba(200,149,108,0.06)"
            stroke="var(--color-accent)"
            strokeWidth="1.5"
            strokeDasharray="5 3"
          />
          <text x="100" y="56" textAnchor="middle" fill="var(--color-text-secondary)"
            fontFamily="var(--font-mono)" fontSize="12" fontWeight="500">
            {totalArea} {displayUnit}
          </text>
          {useDimensions && (
            <text x="100" y="72" textAnchor="middle" fill="var(--color-text-muted)"
              fontFamily="var(--font-mono)" fontSize="9">
              {dims.w} {lengthUnit} \u00D7 {dims.h} {lengthUnit}
            </text>
          )}
          {!useDimensions && (
            <text x="100" y="72" textAnchor="middle" fill="var(--color-text-muted)"
              fontFamily="var(--font-mono)" fontSize="9">
              \u2248 {previewW.toFixed(1)} \u00D7 {previewH.toFixed(1)} {lengthUnit}
            </text>
          )}
        </svg>
      </div>

      <button className="btn btn-primary btn-full" onClick={onNext} style={{ marginTop: 20 }}>
        Configure Rooms \u2192
      </button>
    </div>
  );
}
