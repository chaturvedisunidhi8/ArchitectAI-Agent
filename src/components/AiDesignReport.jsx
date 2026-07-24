import React, { useState } from 'react';
import LayoutThumbnail from './LayoutThumbnail.jsx';
import { METRICS } from '../engine/layoutScore.js';

function scoreClass(score) {
  if (score >= 80) return 'good';
  if (score >= 55) return 'ok';
  return 'poor';
}

/**
 * Sidebar report for an auto-designed plan: the overall score, how it was
 * reached, what the engine decided on the user's behalf, and the runner-up
 * layouts they can switch to in one click.
 */
export default function AiDesignReport({
  result, variants, selectedIndex, onSelectVariant, onRegenerate, onEditManually, busy,
}) {
  const [showAll, setShowAll] = useState(false);

  if (!result || !result.score) return null;

  const { score, strengths = [], weaknesses = [], decisions = [], stats, llm } = result;
  const breakdown = score.breakdown || {};
  const alternatives = variants || [];

  // Which parts of this design a language model contributed to, if any.
  const usedModel = llm && (llm.brief === 'llm' || llm.graph === 'llm');

  return (
    <div className="ai-report fade-in">
      <div className="section-label">AI Design Report</div>

      <div className="ai-score-hero">
        <div className={`ai-score-ring ai-score-${scoreClass(score.total)}`}>
          <span className="ai-score-value">{Math.round(score.total)}</span>
          <span className="ai-score-max">/100</span>
        </div>
        <div className="ai-score-caption">
          <div className="ai-score-title">Design score</div>
          {stats && (
            <div className="ai-score-sub">
              Best of {stats.candidatesGenerated} plans across {stats.strategiesTried} strategies
            </div>
          )}
        </div>
      </div>

      {llm && (
        <div className={`ai-engine-badge ${usedModel ? 'ai-engine-model' : ''}`}>
          <span className="ai-engine-dot" aria-hidden="true" />
          {usedModel ? (
            <span>
              Brief read by <strong>{llm.model}</strong>
              {llm.graph === 'llm' && ` · ${llm.graphEdges} room relationships planned`}
              {' '}· geometry solved locally
            </span>
          ) : (
            <span>Designed by the built-in rule engine · no model configured</span>
          )}
        </div>
      )}

      {strengths.length > 0 && (
        <div className="ai-report-block">
          <div className="ai-report-heading">Why this plan won</div>
          <ul className="ai-reason-list">
            {strengths.map((s, i) => (
              <li key={i}>
                <span className="ai-reason-label">{s.label}</span>
                <span className="ai-reason-note">{s.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ai-report-block">
        <div className="ai-report-heading">
          Score breakdown
          <button className="ai-report-toggle" onClick={() => setShowAll(v => !v)}>
            {showAll ? 'Show top' : 'Show all'}
          </button>
        </div>
        <div className="ai-metric-list">
          {METRICS
            .filter(m => breakdown[m.key] && (showAll || breakdown[m.key].weight >= 10))
            .map(m => {
              const entry = breakdown[m.key];
              return (
                <div className="ai-metric" key={m.key} title={m.desc}>
                  <div className="ai-metric-row">
                    <span className="ai-metric-label">{m.label}</span>
                    <span className="ai-metric-weight">×{entry.weight}</span>
                    <span className={`ai-metric-score ai-score-${scoreClass(entry.score)}`}>{entry.score}</span>
                  </div>
                  <div className="ai-metric-track">
                    <div
                      className={`ai-metric-fill ai-fill-${scoreClass(entry.score)}`}
                      style={{ width: `${Math.max(2, entry.score)}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {decisions.length > 0 && (
        <div className="ai-report-block">
          <div className="ai-report-heading">Decisions made for you</div>
          <ul className="ai-decision-list">
            {decisions.map((d, i) => (
              <li key={i}>
                <span className="ai-decision-title">{d.title}</span>
                <span className="ai-decision-detail">{d.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(score.notes || []).length > 0 && (
        <div className="ai-report-block">
          <div className="ai-report-heading">Constraints not met</div>
          <ul className="ai-weakness-list ai-constraint-list">
            {score.notes.map((n, i) => (
              <li key={i}><span className="ai-weakness-note">{n}</span></li>
            ))}
          </ul>
        </div>
      )}

      {weaknesses.length > 0 && (
        <div className="ai-report-block">
          <div className="ai-report-heading">Worth a manual pass</div>
          <ul className="ai-weakness-list">
            {weaknesses.map((w, i) => (
              <li key={i}>
                <span className="ai-weakness-label">{w.label} · {w.score}</span>
                <span className="ai-weakness-note">{w.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {alternatives.length > 1 && (
        <div className="ai-report-block">
          <div className="ai-report-heading">Runner-up layouts</div>
          <div className="ai-alt-grid">
            {alternatives.map((v, i) => (
              <button
                key={v.id}
                className={`ai-alt ${selectedIndex === i ? 'selected' : ''}`}
                onClick={() => onSelectVariant(i)}
                aria-label={`${v.name}, scoring ${Math.round(v.stats.aiScore)} out of 100`}
                aria-pressed={selectedIndex === i}
              >
                <LayoutThumbnail layout={v.layout} />
                <div className="ai-alt-info">
                  <span className="ai-alt-name">{v.name}</span>
                  <span className={`ai-alt-score ai-score-${scoreClass(v.stats.aiScore)}`}>
                    {Math.round(v.stats.aiScore)}
                  </span>
                </div>
                <div className="ai-alt-stats">
                  {v.stats.dimensions} ft · {v.stats.efficiency}% efficient
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ai-report-actions">
        <button className="btn btn-secondary btn-full btn-sm" onClick={onRegenerate} disabled={busy}>
          {busy ? 'Designing…' : '↻ Generate a different design'}
        </button>
        <button className="btn btn-ghost btn-full btn-sm" onClick={onEditManually}>
          Switch to manual editing
        </button>
      </div>
    </div>
  );
}
