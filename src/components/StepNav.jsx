import React from 'react';

const steps = [
  { num: 0, label: 'Dream' },
  { num: 1, label: 'Area' },
  { num: 2, label: 'Rooms' },
  { num: 3, label: 'Layouts' },
  { num: 4, label: 'Themes' },
  { num: 5, label: 'Plan' },
];

export default function StepNav({ currentStep, onStepClick }) {
  return (
    <div className="step-nav">
      {steps.map((s, i) => (
        <React.Fragment key={s.num}>
          {i > 0 && (
            <div className={`step-connector ${currentStep > s.num ? 'completed' : ''}`} />
          )}
          <div className="step-item">
            <div
              className={`step-circle ${currentStep === s.num ? 'active' : ''} ${currentStep > s.num ? 'completed' : ''}`}
              onClick={() => {
                if (s.num <= currentStep) onStepClick(s.num);
              }}
              style={{ cursor: s.num <= currentStep ? 'pointer' : 'default' }}
            >
              {currentStep > s.num ? '✓' : s.num}
            </div>
            <span className={`step-label ${currentStep === s.num ? 'active' : ''}`}>
              {s.label}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
