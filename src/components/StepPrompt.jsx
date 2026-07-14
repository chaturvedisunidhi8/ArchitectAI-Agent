import React, { useState, useCallback } from 'react';
import { extractRequirements, EXAMPLE_PROMPTS, STYLE_INFO } from '../engine/nlp.js';

export default function StepPrompt({ onApply, onStartManual }) {
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

          {result.warnings && result.warnings.length > 0 && (
            <div className="extraction-warnings" style={{ marginTop: 12 }}>
              {result.warnings.map((w, i) => (
                <div key={i} className="extraction-warning">⚠ {w}</div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={handleApply} style={{ flex: 1 }}>
              Apply & Configure Rooms →
            </button>
            <button className="btn btn-secondary" onClick={() => setResult(null)}>
              Edit
            </button>
          </div>
        </div>
      )}

      {result && !result.success && (
        <div className="extraction-error fade-in" style={{ marginTop: 16 }}>
          {result.error}
        </div>
      )}

      {/* Skip to manual mode */}
      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <button className="btn btn-ghost" onClick={onStartManual}>
          Skip — configure rooms manually
        </button>
      </div>
    </div>
  );
}
