import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import './styles/app.css';
import useFloorPlan from './hooks/useFloorPlan.js';
import StepNav from './components/StepNav.jsx';
import StepPrompt from './components/StepPrompt.jsx';
import StepAreaInput from './components/StepAreaInput.jsx';
import StepRoomConfig from './components/StepRoomConfig.jsx';
import StepLayoutSelect from './components/StepLayoutSelect.jsx';
import StepThemeSelect from './components/StepThemeSelect.jsx';
import StepFloorPlan from './components/StepFloorPlan.jsx';
import CustomLayoutBuilder from './components/CustomLayoutBuilder.jsx';
import ExportPanel from './components/ExportPanel.jsx';
import { getRoomType } from './engine/constants.js';

export default function App() {
  const fp = useFloorPlan();
  const [showExport, setShowExport] = useState(false);
  const [customBuilderOpen, setCustomBuilderOpen] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    fp.loadFromLocal();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The custom builder only lives on the layout step; close it on any nav away.
  useEffect(() => {
    if (fp.step !== 3) setCustomBuilderOpen(false);
  }, [fp.step]);

  const editor = useMemo(() => ({
    addFurnishing: fp.addFurnishing,
    updateFurnishing: fp.updateFurnishing,
    removeFurnishing: fp.removeFurnishing,
    duplicateFurnishing: fp.duplicateFurnishing,
    editRoom: fp.editRoom,
    rotateRoom: fp.rotateRoom,
    updateRoomProps: fp.updateRoomProps,
    moveDoor: fp.moveDoor,
    removeDoor: fp.removeDoor,
    moveWindow: fp.moveWindow,
    removeWindow: fp.removeWindow,
  }), [fp.addFurnishing, fp.updateFurnishing, fp.removeFurnishing, fp.duplicateFurnishing, fp.editRoom, fp.rotateRoom, fp.updateRoomProps, fp.moveDoor, fp.removeDoor, fp.moveWindow, fp.removeWindow]);

  const handleSwapLayout = useCallback((newLayout) => {
    fp.setLayout(newLayout);
  }, [fp]);

  const handleSwapRooms = useCallback((idA, idB) => {
    fp.swapRooms(idA, idB);
  }, [fp]);

  const handleRegenerate = useCallback(() => {
    fp.generateLayout();
  }, [fp]);

  const handleMoveRoom = useCallback((roomId, dx, dy) => {
    fp.moveRoom(roomId, dx, dy);
  }, [fp]);

  const handleLayoutConfirm = useCallback(() => {
    // When building a custom layout, fp.layout already holds the user's
    // arranged rooms — don't re-apply the pristine grid over their work.
    if (customBuilderOpen) {
      setCustomBuilderOpen(false);
      fp.goNext();
      return;
    }
    fp.applyVariant(fp.selectedLayoutIndex);
    fp.goNext();
  }, [fp, customBuilderOpen]);

  // Open the custom-layout builder: apply the plain grid as a starting canvas,
  // then let the user arrange it themselves.
  const handleOpenCustomBuilder = useCallback((index) => {
    fp.setSelectedLayoutIndex(index);
    fp.applyVariant(index);
    setCustomBuilderOpen(true);
  }, [fp]);

  const handleCancelCustomBuilder = useCallback(() => {
    setCustomBuilderOpen(false);
  }, []);

  // Reset the builder back to the pristine starting grid. Re-applying the
  // variant records the reset in history, so it stays undoable.
  const handleResetCustomBuilder = useCallback(() => {
    fp.applyVariant(fp.selectedLayoutIndex);
    fp.setSelectedRoomId(null);
  }, [fp]);

  const handleThemeConfirm = useCallback(() => {
    fp.goNext();
  }, [fp]);

  const handleNlpApply = useCallback((nlpResult) => {
    fp.applyNlpResult(nlpResult);
  }, [fp]);

  const handleStartManual = useCallback(() => {
    fp.setStep(1);
  }, [fp]);

  // "Edit Rooms" jumps back to the Rooms step so room selection/areas can be
  // changed; regenerating from there produces fresh, dynamic layouts.
  const handleEditRooms = useCallback(() => {
    fp.setStep(2);
  }, [fp]);

  return (
    <div className="app-layout">
      <div className="sidebar">
        <div className="sidebar-header">
          <h1>Floor Planner</h1>
          <p>architect your space</p>
        </div>
        <div className="sidebar-content">
          <StepNav currentStep={fp.step} onStepClick={fp.setStep} />

          {fp.step === 0 && (
            <StepPrompt
              onApply={handleNlpApply}
              onStartManual={handleStartManual}
            />
          )}

          {fp.step === 1 && (
            <StepAreaInput
              totalArea={fp.totalArea}
              setTotalArea={fp.setTotalArea}
              unit={fp.unit}
              setUnit={fp.setUnit}
              onNext={fp.goNext}
            />
          )}

          {fp.step === 2 && (
            <StepRoomConfig
              roomSpecs={fp.roomSpecs}
              totalArea={fp.totalArea}
              totalUsedArea={fp.totalUsedArea}
              areaRemaining={fp.areaRemaining}
              areaPercent={fp.areaPercent}
              displayUnit={fp.displayUnit}
              unit={fp.unit}
              onAreaChange={fp.updateRoomSpec}
              onIncrement={fp.incrementRoom}
              onDecrement={fp.decrementRoom}
              onToggle={(type) => {
                const spec = fp.roomSpecs.find(r => r.type === type);
                if (spec.count > 0) {
                  fp.decrementRoom(type);
                } else {
                  fp.incrementRoom(type);
                }
              }}
              onNext={fp.goNext}
              onBack={fp.goBack}
            />
          )}

          {fp.step === 3 && (
            <StepLayoutSelect
              variants={fp.layoutVariants}
              selectedIndex={fp.selectedLayoutIndex}
              onSelect={fp.setSelectedLayoutIndex}
              onCustomize={handleOpenCustomBuilder}
              onConfirm={handleLayoutConfirm}
              onBack={fp.goBack}
            />
          )}

          {fp.step === 4 && (
            <StepThemeSelect
              selectedTheme={fp.selectedTheme}
              onSelect={fp.setSelectedTheme}
              onConfirm={handleThemeConfirm}
              onBack={fp.goBack}
            />
          )}

          {fp.step === 5 && (
            <div className="step3-sidebar fade-in">
              <div className="section-label">Floor Plan Summary</div>

              <div className="summary-stats">
                <div className="stat-card">
                  <div className="stat-value">{fp.layout ? fp.layout.rooms.length : 0}</div>
                  <div className="stat-label">Rooms</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">
                    {fp.layout ? fp.layout.boundary.width.toFixed(0) : 0} × {fp.layout ? fp.layout.boundary.height.toFixed(0) : 0}
                  </div>
                  <div className="stat-label">ft</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{fp.totalArea}</div>
                  <div className="stat-label">{fp.displayUnit}</div>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div className="extraction-rooms-label">Style</div>
                <span className="extraction-room-chip" style={{ textTransform: 'capitalize' }}>{fp.extractedStyle || 'Modern'}</span>
              </div>

              {fp.layout && (
                <div className="room-summary-list">
                  {fp.layout.rooms.map(room => {
                    const roomType = getRoomType(room.type);
                    return (
                      <div
                        key={room.id}
                        className={`room-summary-item ${fp.selectedRoomId === room.id ? 'selected' : ''}`}
                        onClick={() => fp.setSelectedRoomId(room.id === fp.selectedRoomId ? null : room.id)}
                      >
                        <div className="room-summary-swatch" style={{ background: room.color }} />
                        <div className="room-summary-info">
                          <div className="room-summary-name">{room.label}</div>
                          <div className="room-summary-dims">
                            {room.w.toFixed(1)} × {room.h.toFixed(1)} ft
                          </div>
                        </div>
                        <div className="room-summary-area">
                          {Math.round(room.w * room.h)} ft²
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="sidebar-actions" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="btn btn-secondary btn-full btn-sm" onClick={() => fp.setStep(0)}>
                  Start Over
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="main-area">
        {customBuilderOpen && fp.step === 3 && fp.layout ? (
          <CustomLayoutBuilder
            layout={fp.layout}
            selectedRoomId={fp.selectedRoomId}
            onSelectRoom={fp.setSelectedRoomId}
            displayUnit={fp.displayUnit}
            totalAreaFt={fp.totalAreaFt}
            onMoveRoom={handleMoveRoom}
            onSwapRooms={handleSwapRooms}
            onEditRoom={fp.editRoom}
            onRotateRoom={fp.rotateRoom}
            canUndo={fp.canUndo}
            canRedo={fp.canRedo}
            onUndo={fp.undo}
            onRedo={fp.redo}
            onReset={handleResetCustomBuilder}
            onCancel={handleCancelCustomBuilder}
            onConfirm={handleLayoutConfirm}
          />
        ) : fp.step === 5 ? (
          <StepFloorPlan
            layout={fp.layout}
            selectedRoomId={fp.selectedRoomId}
            onSelectRoom={fp.setSelectedRoomId}
            displayUnit={fp.displayUnit}
            totalAreaFt={fp.totalAreaFt}
            onEditRooms={handleEditRooms}
            onSwapLayout={handleSwapLayout}
            onSwapRooms={handleSwapRooms}
            onRegenerate={handleRegenerate}
            onMoveRoom={handleMoveRoom}
            roomSpecs={fp.roomSpecs}
            unit={fp.unit}
            canUndo={fp.canUndo}
            canRedo={fp.canRedo}
            onUndo={fp.undo}
            onRedo={fp.redo}
            onOpenExport={() => setShowExport(true)}
            canvasRef={canvasRef}
            editor={editor}
            onLoad={fp.loadFromLocal}
            onClear={fp.clearLocal}
            theme={fp.selectedTheme}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-state-graphic">
              {fp.step === 0 ? (
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <rect x="8" y="8" width="64" height="64" rx="4" stroke="var(--color-accent)" strokeWidth="1.5" strokeDasharray="4 3" fill="rgba(200,149,108,0.04)" />
                  <path d="M28 40 L40 28 L52 40" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
                  <line x1="40" y1="28" x2="40" y2="55" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : fp.step <= 1 ? (
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <rect x="8" y="8" width="64" height="64" rx="4" stroke="var(--color-accent)" strokeWidth="1.5" strokeDasharray="4 3" fill="rgba(200,149,108,0.04)" />
                  <line x1="40" y1="28" x2="40" y2="52" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                  <line x1="28" y1="40" x2="52" y2="40" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              ) : fp.step <= 2 ? (
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <rect x="8" y="12" width="30" height="22" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.06)" />
                  <rect x="42" y="12" width="30" height="22" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.06)" />
                  <rect x="8" y="38" width="64" height="34" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.06)" />
                </svg>
              ) : fp.step <= 3 ? (
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <rect x="4" y="4" width="32" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.06)" />
                  <rect x="44" y="4" width="32" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.06)" />
                  <rect x="4" y="32" width="32" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.06)" />
                  <rect x="44" y="32" width="32" height="24" rx="2" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.06)" />
                </svg>
              ) : (
                <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                  <rect x="8" y="8" width="64" height="64" rx="4" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.04)" />
                  <circle cx="25" cy="30" r="6" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.08)" />
                  <circle cx="55" cy="30" r="6" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.08)" />
                  <circle cx="40" cy="52" r="6" stroke="var(--color-accent)" strokeWidth="1.5" fill="rgba(200,149,108,0.08)" />
                  <line x1="25" y1="30" x2="55" y2="30" stroke="var(--color-accent)" strokeWidth="1" strokeDasharray="3 2" />
                  <line x1="25" y1="30" x2="40" y2="52" stroke="var(--color-accent)" strokeWidth="1" strokeDasharray="3 2" />
                  <line x1="55" y1="30" x2="40" y2="52" stroke="var(--color-accent)" strokeWidth="1" strokeDasharray="3 2" />
                </svg>
              )}
            </div>
            <h3>
              {fp.step === 0 ? 'Describe your dream home'
                : fp.step === 1 ? 'Set your flat area'
                : fp.step === 2 ? 'Select your rooms'
                : fp.step === 3 ? 'Choose a layout'
                : fp.step === 4 ? 'Pick an interior style'
                : 'Build your floor plan'}
            </h3>
            <p>
              {fp.step === 0
                ? 'Tell us about your ideal home in natural language — we\'ll extract the details.'
                : fp.step === 1
                ? 'Enter the total area of your flat in the sidebar, then proceed to configure rooms.'
                : fp.step === 2
                ? 'Check the rooms you need, set their areas, and generate your floor plan.'
                : fp.step === 3
                ? 'We generated several layout options. Pick your favorite in the sidebar.'
                : fp.step === 4
                ? 'Choose an interior design theme for your home.'
                : 'Your floor plan is ready. Explore it in 2D and 3D.'}
            </p>
          </div>
        )}
      </div>

      {showExport && (
        <ExportPanel
          layout={fp.layout}
          displayUnit={fp.displayUnit}
          totalArea={fp.totalArea}
          unit={fp.unit}
          roomSpecs={fp.roomSpecs}
          canvasRef={canvasRef}
          theme={fp.selectedTheme}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
