import React, { useState, useCallback } from 'react';
import { extractRequirements, EXAMPLE_PROMPTS, STYLE_INFO, PREFERENCE_INFO } from '../engine/nlp.js';

export default function StepPrompt({ onApply, onStartManual, onAutoDesign, aiError }) {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const handleAnalyze = useCallback(() => {
    if (!prompt.trim()) return;
    setIsAnalyzing(true);
    // Small delay for UX feedback
    setTimeout(() => {
      const res = extractRequirements(prompt);
      setResult(res);
      setIsAnalyzing(false);
    }, 300);
  }, [prompt]);

  const handleApply = useCallback(() => {
    if (result && result.success) {
      onApply(result);
    }
  }, [result, onApply]);

  const handleAutoDesign = useCallback(() => {
    if (result && result.success) {
      onAutoDesign(prompt);
    }
  }, [result, onAutoDesign, prompt]);

  const handleExampleClick = useCallback((example) => {
    setPrompt(example);
    setResult(null);
  }, []);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleAnalyze();
    }
  }, [handleAnalyze]);

  const extracted = result?.success ? result.extracted : null;
  const styleInfo = extracted?.style ? STYLE_INFO[extracted.style] : null;

  return (
    <div className="fade-in">
      <div className="section-label">Describe your dream home</div>

      <div className="prompt-input-wrap">
        <textarea
          className="prompt-textarea"
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value); setResult(null); }}
          onKeyDown={handleKeyDown}
          placeholder="e.g. 3BHK modern home, 1800 sqft, large living room, 2 bathrooms, kitchen with dining, balcony..."
          rows={4}
        />
        <div className="prompt-hint">
          Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to analyze
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button
          className="btn btn-primary"
          onClick={handleAnalyze}
          disabled={!prompt.trim() || isAnalyzing}
          style={{ flex: 1 }}
        >
          {isAnalyzing ? 'Analyzing...' : 'Analyze Description'}
        </button>
      </div>

      {/* Example prompts */}
      {!result && (
        <div style={{ marginTop: 20 }}>
          <div className="section-label" style={{ marginBottom: 10 }}>Try an example</div>
          <div className="example-prompts">
            {EXAMPLE_PROMPTS.map((ex, i) => (
              <button
                key={i}
                className="example-chip"
                onClick={() => handleExampleClick(ex)}
              >
                {ex.length > 60 ? ex.slice(0, 57) + '...' : ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Extraction results */}
      {result && result.success && (
        <div className="extraction-results fade-in" style={{ marginTop: 20 }}>
          <div className="section-label">Extracted Requirements</div>

          <div className="extraction-grid">
            {extracted.bhk && (
              <div className="extraction-item">
                <span className="extraction-key">BHK</span>
                <span className="extraction-value">{extracted.bhk}</span>
              </div>
            )}
            {extracted.totalArea && (
              <div className="extraction-item">
                <span className="extraction-key">Area</span>
                <span className="extraction-value">{extracted.totalArea} ft²</span>
              </div>
            )}
            {extracted.style && (
              <div className="extraction-item">
                <span className="extraction-key">Style</span>
                <span className="extraction-value">{styleInfo?.label || extracted.style}</span>
              </div>
            )}
            {extracted.floors && (
              <div className="extraction-item">
                <span className="extraction-key">Floors</span>
                <span className="extraction-value">{extracted.floors}</span>
              </div>
            )}
            {extracted.direction && (
              <div className="extraction-item">
                <span className="extraction-key">Facing</span>
                <span className="extraction-value">{extracted.direction}</span>
              </div>
            )}
            {extracted.budget && (
              <div className="extraction-item">
                <span className="extraction-key">Budget</span>
                <span className="extraction-value">
                  {extracted.budget.currency === 'INR'
                    ? `₹${(extracted.budget.amount / 100000).toFixed(1)}L`
                    : `$${(extracted.budget.amount / 1000).toFixed(0)}k`}
                </span>
              </div>
            )}
          </div>

          {extracted.rooms.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="extraction-rooms-label">Rooms Detected</div>
              <div className="extraction-rooms">
                {extracted.rooms.map((r, i) => (
                  <span key={i} className="extraction-room-chip">{r}</span>
                ))}
              </div>
            </div>
          )}

          {extracted.amenities && extracted.amenities.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="extraction-rooms-label">Amenities</div>
              <div className="extraction-rooms">
                {extracted.amenities.map((a, i) => (
                  <span key={i} className="extraction-room-chip extraction-amenity">{a}</span>
                ))}
              </div>
            </div>
          )}

          {extracted.preferences && Object.keys(extracted.preferences).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="extraction-rooms-label">Design Priorities</div>
              <div className="extraction-rooms">
                {Object.keys(extracted.preferences).map(key => (
                  <span
                    key={key}
                    className="extraction-room-chip extraction-priority"
                    title={PREFERENCE_INFO[key]?.desc}
                  >
                    {PREFERENCE_INFO[key]?.label || key}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.warnings && result.warnings.length > 0 && (
            <div className="extraction-warnings" style={{ marginTop: 12 }}>
              {result.warnings.map((w, i) => (
                <div key={i} className="extraction-warning">⚠ {w}</div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setResult(null)}>
              ← Edit description
            </button>
          </div>
        </div>
      )}

      {/* Mode chooser — shown once the description has been understood */}
      {result && result.success && (
        <div className="mode-chooser fade-in">
          <div className="section-label" style={{ marginTop: 20 }}>How should we build it?</div>

          <button
            className="mode-card mode-card-ai"
            onClick={handleAutoDesign}
            aria-label="Design it with AI — generate the whole plan automatically"
          >
            <div className="mode-card-badge">Recommended</div>
            <div className="mode-card-head">
              <span className="mode-card-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3l1.9 4.9L19 9.8l-4.1 3.2L15.6 18 12 15.3 8.4 18l.7-5L5 9.8l5.1-.9L12 3z"
                    stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="mode-card-title">Design it with AI</span>
            </div>
            <p className="mode-card-desc">
              Fully automatic. We plan the rooms, search dozens of layouts, score them for
              flow, light and privacy, then furnish and style the winner — straight to your
              finished 2D plan and 3D walkthrough.
            </p>
            <div className="mode-card-steps">
              <span>Room schedule</span>
              <span>Layout search</span>
              <span>Furniture</span>
              <span>2D + 3D</span>
            </div>
            <div className="mode-card-cta">Generate my plan →</div>
          </button>

          <button
            className="mode-card"
            onClick={handleApply}
            aria-label="Build it manually — configure rooms step by step"
          >
            <div className="mode-card-head">
              <span className="mode-card-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="13" y="3" width="8" height="18" rx="1" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="3" y="13" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </span>
              <span className="mode-card-title">Build it manually</span>
            </div>
            <p className="mode-card-desc">
              Step through it yourself — adjust room counts and areas, compare the four
              layout strategies, or draw a freeform plan, then pick your own theme.
            </p>
            <div className="mode-card-cta">Configure rooms →</div>
          </button>
        </div>
      )}

      {result && !result.success && (
        <div className="extraction-error fade-in" style={{ marginTop: 16 }}>
          {result.error}
        </div>
      )}

      {aiError && (
        <div className="extraction-error fade-in" style={{ marginTop: 16 }}>
          {aiError}
        </div>
      )}

      {/* Skip to manual mode */}
      {!result && (
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <button className="btn btn-ghost" onClick={onStartManual}>
            Skip — configure rooms manually
          </button>
        </div>
      )}
    </div>
  );
}
