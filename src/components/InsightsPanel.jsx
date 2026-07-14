import React, { useMemo } from 'react';
import { estimateCost, formatCost } from '../engine/costEstimator.js';
import { checkVastu } from '../engine/vastu.js';
import { analyzeEnergy } from '../engine/energyAnalyzer.js';

export default function InsightsPanel({ layout, style, direction, onClose }) {
  const cost = useMemo(() => estimateCost(layout, style), [layout, style]);
  const vastu = useMemo(() => checkVastu(layout, direction), [layout, direction]);
  const energy = useMemo(() => analyzeEnergy(layout), [layout]);

  if (!layout) return null;

  return (
    <div className="insights-panel fade-in">
      <div className="insights-header">
        <div className="insights-title">AI Insights</div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ fontSize: 16, padding: '2px 6px' }}>✕</button>
      </div>

      {/* Cost Estimation */}
      {cost && (
        <div className="insights-section">
          <div className="insights-section-title">Cost Estimate</div>
          <div className="insights-card">
            <div className="insights-card-row">
              <span className="insights-card-label">Total Estimated</span>
              <span className="insights-card-value">{formatCost(cost.total)}</span>
            </div>
            <div className="insights-card-note">
              {cost.perSqft}/ft² · {cost.style} style · {cost.finishLevel} finish
            </div>
          </div>
          <div className="insights-card">
            <div className="insights-card-row">
              <span className="insights-card-label">Structural</span>
              <span className="insights-card-value">{formatCost(cost.structural)}</span>
            </div>
          </div>
          <div className="insights-card">
            <div className="insights-card-row">
              <span className="insights-card-label">Interior & Fixtures</span>
              <span className="insights-card-value">{formatCost(cost.interior)}</span>
            </div>
          </div>
          {cost.rooms.filter(r => r.cost > 0).slice(0, 5).map(r => (
            <div key={r.id} className="insights-card">
              <div className="insights-card-row">
                <span className="insights-card-label">{r.label} ({r.area} ft²)</span>
                <span className="insights-card-value">{formatCost(r.cost)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vastu Compliance */}
      {vastu && (
        <div className="insights-section">
          <div className="insights-section-title">Vastu Compliance</div>
          <div className="insights-score">
            <span className="insights-card-label">Score</span>
            <div className="insights-score-bar">
              <div
                className="insights-score-fill"
                style={{
                  width: `${vastu.score}%`,
                  background: vastu.score >= 70 ? 'var(--color-success)' : vastu.score >= 40 ? 'var(--color-warning)' : 'var(--color-danger)',
                }}
              />
            </div>
            <span className="insights-score-value">{vastu.score}%</span>
          </div>
          {vastu.results.filter(r => r.pass !== null).map(r => (
            <div key={r.id} className="insights-card">
              <div className="insights-card-row">
                <span className="insights-card-label">{r.name}</span>
                <span style={{ fontSize: 12, color: r.pass ? 'var(--color-success)' : 'var(--color-warning)' }}>
                  {r.pass ? '✓' : '⚠'}
                </span>
              </div>
              <div className="insights-card-note">{r.note}</div>
            </div>
          ))}
        </div>
      )}

      {/* Energy & Light Analysis */}
      {energy && (
        <div className="insights-section">
          <div className="insights-section-title">Light & Ventilation</div>
          <div className="insights-score">
            <span className="insights-card-label">Overall</span>
            <div className="insights-score-bar">
              <div
                className="insights-score-fill"
                style={{
                  width: `${energy.averages.overall}%`,
                  background: energy.averages.overall >= 70 ? 'var(--color-success)' : energy.averages.overall >= 40 ? 'var(--color-warning)' : 'var(--color-danger)',
                }}
              />
            </div>
            <span className="insights-score-value">{energy.averages.overall}%</span>
          </div>

          {energy.rooms.slice(0, 6).map(r => (
            <div key={r.id} className="insights-card">
              <div className="insights-card-row">
                <span className="insights-card-label">{r.label}</span>
                <span className="insights-card-value" style={{ fontSize: 11 }}>
                  Light: {r.light.score} · Vent: {r.ventilation.score}
                </span>
              </div>
              <div className="insights-card-note">{r.light.note}</div>
            </div>
          ))}

          {energy.tips.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="insights-section-title" style={{ marginBottom: 6 }}>Suggestions</div>
              {energy.tips.slice(0, 3).map((tip, i) => (
                <div key={i} className="insights-card">
                  <div className="insights-card-note">💡 {tip.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
