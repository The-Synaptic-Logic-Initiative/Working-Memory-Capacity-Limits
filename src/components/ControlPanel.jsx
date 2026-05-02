import React, { useRef, useEffect, useCallback } from 'react';
import { Play, Pause, RotateCcw, SkipForward, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

function InhibitionDial({ value, onChange }) {
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 90;
    canvas.width = size;
    canvas.height = size;
    const cx = size / 2, cy = size / 2, r = 32;

    ctx.clearRect(0, 0, size, size);

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Value arc
    const pct = (value - 0.1) / 1.4;
    const endAngle = 0.75 * Math.PI + pct * 1.5 * Math.PI;
    const hue = 200 - pct * 170;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0.75 * Math.PI, endAngle);
    ctx.strokeStyle = `hsl(${hue},85%,55%)`;
    ctx.lineWidth = 5;
    ctx.stroke();

    // Tick marks
    for (let i = 0; i <= 10; i++) {
      const a = (0.75 + (i / 10) * 1.5) * Math.PI;
      const r1 = 38, r2 = i % 5 === 0 ? 32 : 35;
      ctx.beginPath();
      ctx.moveTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a));
      ctx.lineTo(cx + r2 * Math.cos(a), cy + r2 * Math.sin(a));
      ctx.strokeStyle = '#2a4a7a';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Needle
    const angle = (0.75 + pct * 1.5) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + 22 * Math.cos(angle), cy + 22 * Math.sin(angle));
    ctx.strokeStyle = '#06d6f0';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#06d6f0';
    ctx.fill();
  }, [value]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseDown = (e) => {
    dragRef.current = { startY: e.clientY, startVal: value };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!dragRef.current) return;
    const dy = (dragRef.current.startY - e.clientY) / 100;
    const next = Math.min(1.5, Math.max(0.1, dragRef.current.startVal + dy));
    onChange(parseFloat(next.toFixed(2)));
  };

  const handleMouseUp = () => {
    dragRef.current = null;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        width={90} height={90}
        className="cursor-ns-resize select-none"
        onMouseDown={handleMouseDown}
        title="Drag up/down to adjust lateral inhibition"
      />
      <span className="text-accent-cyan mono text-sm font-medium">{value.toFixed(2)}</span>
    </div>
  );
}

export default function ControlPanel({
  params, updateParams, isRunning, start, stop, reset, step, togglePlay,
  loadItem, removeItem, firingRates, stimuli, active,
}) {
  const [expertOpen, setExpertOpen] = useState(false);
  const predictedCap = Math.max(1, Math.min(params.n_groups, Math.round((params.w_exc / params.w_inh) * 3.8)));

  const speeds = [1, 3, 8];

  const getItemState = (g) => {
    if (stimuli[g] > 0) return 'loading';
    if (active[g]) return 'active';
    if (firingRates[g] > 0 && firingRates[g] <= params.active_rate_hz) return 'decaying';
    return 'empty';
  };

  const handleItemClick = (g) => {
    const s = getItemState(g);
    if (s === 'active' || s === 'loading') removeItem(g);
    else loadItem(g);
  };

  const itemColors = {
    empty:   'border-border bg-bg-tertiary text-text-tertiary',
    loading: 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan pulse-loading',
    active:  'border-accent-green bg-accent-green/10 text-accent-green',
    decaying:'border-accent-amber bg-accent-amber/5 text-accent-amber',
  };

  return (
    <div className="flex flex-col gap-0">

      {/* ITEMS */}
      <div className="p-3 border-b border-border">
        <p className="text-xs mono text-text-tertiary tracking-widest mb-2">MEMORY ITEMS</p>
        <div className="grid grid-cols-2 gap-1.5">
          {Array.from({ length: params.n_groups }, (_, g) => {
            const s = getItemState(g);
            const hz = Math.round(firingRates[g] ?? 0);
            return (
              <button
                key={g}
                onClick={() => handleItemClick(g)}
                className={`flex flex-col items-center justify-center py-2 rounded border text-xs transition-all ${itemColors[s]}`}
              >
                <span className="font-bold text-base mono">{g + 1}</span>
                <span className="text-[10px] opacity-70">{s === 'empty' ? '—' : `${hz} Hz`}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* INHIBITION DIAL */}
      <div className="p-3 border-b border-border">
        <p className="text-xs mono text-text-tertiary tracking-widest mb-2">LATERAL INHIBITION</p>
        <div className="flex items-center gap-3">
          <InhibitionDial
            value={params.w_inh}
            onChange={(v) => updateParams({ w_inh: v })}
          />
          <div className="flex flex-col gap-2 flex-1">
            <div className="text-xs text-text-secondary">
              Predicted capacity
              <div className="text-accent-amber font-bold mono text-lg">~{predictedCap}</div>
            </div>
            <div className="flex flex-col gap-1">
              {[['LOW ~10', 0.3], ['MED ~7', 1.5], ['HIGH ~3', 2.8]].map(([label, val]) => (
                <button
                  key={label}
                  onClick={() => updateParams({ w_inh: val })}
                  className="text-[10px] mono px-2 py-1 border border-border rounded hover:border-accent-cyan hover:text-accent-cyan text-text-tertiary transition-all"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* SIM CONTROLS */}
      <div className="p-3 border-b border-border">
        <p className="text-xs mono text-text-tertiary tracking-widest mb-2">SIMULATION</p>
        <button
          onClick={togglePlay}
          className={`w-full flex items-center justify-center gap-2 py-2 rounded border mono text-sm font-medium transition-all mb-2 ${
            isRunning
              ? 'border-accent-amber text-accent-amber bg-accent-amber/10'
              : 'border-accent-blue text-accent-blue bg-accent-blue/10'
          }`}
        >
          {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          {isRunning ? 'PAUSE' : 'PLAY'}
        </button>
        <div className="flex gap-1 mb-2">
          {speeds.map(s => (
            <button
              key={s}
              onClick={() => updateParams({ sim_speed: s })}
              className={`flex-1 text-xs mono py-1.5 rounded border transition-all ${
                params.sim_speed === s
                  ? 'border-accent-green text-accent-green bg-accent-green/10'
                  : 'border-border text-text-tertiary hover:border-text-secondary'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            onClick={reset}
            className="flex-1 flex items-center justify-center gap-1 text-xs mono py-1.5 rounded border border-accent-red/50 text-accent-red hover:bg-accent-red/10 transition-all"
          >
            <RotateCcw className="w-3 h-3" /> RESET
          </button>
          <button
            onClick={step}
            disabled={isRunning}
            className="flex-1 flex items-center justify-center gap-1 text-xs mono py-1.5 rounded border border-border text-text-tertiary hover:border-text-secondary disabled:opacity-30 transition-all"
          >
            <SkipForward className="w-3 h-3" /> STEP
          </button>
        </div>
      </div>

      {/* EXPERT MODE */}
      <div className="p-3">
        <button
          onClick={() => setExpertOpen(!expertOpen)}
          className="flex items-center justify-between w-full text-xs mono text-text-tertiary tracking-widest mb-2 hover:text-text-secondary transition-colors"
        >
          EXPERT MODE
          {expertOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        {expertOpen && (
          <div className="flex flex-col gap-3">
            {[
              { key: 'w_exc', label: 'Excitatory weight', min: 0.5, max: 5, step: 0.1 },
              { key: 'tau_m', label: 'Leak time const (ms)', min: 5, max: 60, step: 1 },
              { key: 'noise_std', label: 'Noise (mV)', min: 0, max: 2, step: 0.1 },
              { key: 'I_stim', label: 'Stim current (nA)', min: 0.5, max: 5, step: 0.1 },
            ].map(({ key, label, min, max, step: s }) => (
              <div key={key}>
                <div className="flex justify-between text-[10px] text-text-secondary mb-1">
                  <span>{label}</span>
                  <span className="mono text-white">{params[key]}</span>
                </div>
                <input
                  type="range" min={min} max={max} step={s}
                  value={params[key]}
                  onChange={e => updateParams({ [key]: parseFloat(e.target.value) })}
                  className="w-full h-1 accent-blue-500"
                />
              </div>
            ))}
            <button
              onClick={() => updateParams({
                w_exc: 2.8, w_inh: 1.5, tau_m: 20,
                noise_std: 0.3, I_stim: 2.5,
              })}
              className="text-[10px] mono text-text-tertiary border border-border rounded py-1 hover:border-accent-blue hover:text-accent-blue transition-all"
            >
              RESET TO DEFAULTS
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
