import React from 'react';
import { PIPELINE_STAGES } from '../engine/aiDesigner.js';

/**
 * Live view of the auto-design pipeline, shown in the main area while the
 * engine works.  Each stage reports a small payload (candidate counts, etc.)
 * so the user can see the search actually happening rather than a spinner.
 */
export default function AiDesignProgress({ progress, prompt }) {
  const currentIndex = progress ? progress.index : 0;
  const info = progress ? progress.info : null;

  const stageDetail = (stage, index) => {
    if (index !== currentIndex || !info) return stage.detail;
    if (info.rooms) return `${info.rooms} room types in the schedule`;
    if (info.planned) return `Exploring ${info.planned} strategy / proportion / seed combinations`;
    if (info.evaluated) return `Ranking ${info.evaluated} candidate plans on 8 criteria`;
    if (info.finalists) return `Hill-climbing the top ${info.finalists} arrangements`;
    return stage.detail;
  };

  const pct = Math.round(((currentIndex + 1) / PIPELINE_STAGES.length) * 100);

  return (
    <div className="ai-progress-wrap">
      <div className="ai-progress-card fade-in">
        <div className="ai-progress-header">
          <div className="ai-progress-pulse" aria-hidden="true">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M12 3l1.9 4.9L19 9.8l-4.1 3.2L15.6 18 12 15.3 8.4 18l.7-5L5 9.8l5.1-.9L12 3z"
                stroke="var(--color-accent)" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </div>
          <h3>Designing your home</h3>
          {prompt && <p className="ai-progress-prompt">“{prompt}”</p>}
        </div>

        <div className="ai-progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="ai-progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>

        <ol className="ai-stage-list">
          {PIPELINE_STAGES.map((stage, i) => {
            const state = i < currentIndex ? 'done' : i === currentIndex ? 'active' : 'pending';
            return (
              <li key={stage.id} className={`ai-stage ai-stage-${state}`}>
                <span className="ai-stage-marker">{state === 'done' ? '✓' : i + 1}</span>
                <span className="ai-stage-text">
                  <span className="ai-stage-label">{stage.label}</span>
                  <span className="ai-stage-detail">{stageDetail(stage, i)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
