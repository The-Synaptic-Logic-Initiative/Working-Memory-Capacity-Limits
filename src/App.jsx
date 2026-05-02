import React, { useState, useRef } from 'react';
import { useSimulation } from './hooks/useSimulation';
import ControlPanel from './components/ControlPanel';
import NetworkVisualizer from './components/NetworkVisualizer';
import SpikeRaster from './components/SpikeRaster';
import CapacityMeter from './components/CapacityMeter';
import TheoryPanel from './components/TheoryPanel';
import { Beaker, Play, Pause, RefreshCw, Info, Cpu, Activity, Zap, Brain } from 'lucide-react';

export default function App() {
  const {
    state, params, isRunning,
    start, stop, reset, updateParams,
    loadItem, removeItem, step,
  } = useSimulation();

  const [activeTab, setActiveTab] = useState('network');
  const [isTheoryOpen, setIsTheoryOpen] = useState(true);
  const autoRef = useRef(null);
  const [autoRunning, setAutoRunning] = useState(false);

  const togglePlay = () => isRunning ? stop() : start();

  // FIX: sequential — reset first, then start after a tick, then load items
  const runExperiment = () => {
    if (autoRef.current) {
      clearTimeout(autoRef.current);
      autoRef.current = null;
    }
    setAutoRunning(true);
    reset();

    // Wait for reset to propagate to worker before starting
    setTimeout(() => {
      start();
      let count = 0;
      const loadNext = () => {
        if (count >= params.n_groups) {
          setAutoRunning(false);
          return;
        }
        loadItem(count);
        count++;
        autoRef.current = setTimeout(loadNext, 800);
      };
      autoRef.current = setTimeout(loadNext, 300);
    }, 100);
  };

  // FIX: use active_rate_hz from params (12), not hardcoded 10
  const activeCount = state.active_count ?? state.firing_rates.filter(r => r > params.active_rate_hz).length;
  const predictedCapacity = state.predicted_capacity ?? Math.round((params.w_exc / params.w_inh) * 3.8);
  const suppressionPct = Math.round((state.suppression_floor ?? 0) * 100);

  const tabs = [
    { id: 'network', label: 'Neural Activity', icon: Activity },
    { id: 'raster',  label: 'Spike Raster',   icon: Zap },
    { id: 'capacity',label: 'Capacity',        icon: Brain },
  ];

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary font-sans overflow-hidden">
      {/* Header */}
      <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-bg-secondary shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-accent-blue/20 rounded flex items-center justify-center">
            <Cpu className="w-5 h-5 text-accent-blue" />
          </div>
          <h1 className="text-xl font-bold tracking-tight mono">
            WORKING MEMORY <span className="text-accent-blue">ENGINE</span>
          </h1>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-xs mono text-text-secondary">
            <div className="flex flex-col items-end">
              <span>SIM TIME</span>
              <span className="text-white font-medium">{Math.floor(state.t)} ms</span>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex flex-col items-end">
              <span>ACTIVE ITEMS</span>
              <span className="text-accent-green font-medium">{activeCount} / {predictedCapacity}</span>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex flex-col items-end">
              <span>SUPPRESSION</span>
              <span
                className="font-medium"
                style={{ color: suppressionPct > 70 ? 'var(--accent-red)' : suppressionPct > 40 ? 'var(--accent-amber)' : 'var(--accent-green)' }}
              >
                {suppressionPct}%
              </span>
            </div>
            <div className="h-8 w-px bg-border" />
            <div className="flex flex-col items-end">
              <span>STATUS</span>
              <span className={`font-medium ${isRunning ? 'text-accent-green' : 'text-accent-amber'}`}>
                {isRunning ? '● RUNNING' : '◼ PAUSED'}
              </span>
            </div>
          </div>

          <button
            onClick={runExperiment}
            disabled={autoRunning}
            className="flex items-center gap-2 bg-accent-blue hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition-all"
          >
            <Beaker className="w-4 h-4" />
            {autoRunning ? 'LOADING...' : 'AUTO EXPERIMENT'}
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-1 overflow-hidden relative">
        {/* Left Panel */}
        <div className="w-72 border-r border-border bg-bg-secondary overflow-y-auto shrink-0">
          <ControlPanel
            params={params}
            updateParams={updateParams}
            isRunning={isRunning}
            start={start}
            stop={stop}
            reset={reset}
            step={step}
            togglePlay={togglePlay}
            loadItem={loadItem}
            removeItem={removeItem}
            firingRates={state.firing_rates}
            stimuli={state.stimuli}
            active={state.active}
          />
        </div>

        {/* Center */}
        <div className="flex-1 flex flex-col bg-bg-primary overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border bg-bg-secondary/50 px-4 shrink-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-xs font-bold tracking-widest transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'border-accent-blue text-accent-blue bg-accent-blue/5'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Visualization */}
          <div className="flex-1 p-4 overflow-hidden">
            <div className="w-full h-full scientific-panel overflow-hidden relative">
              {activeTab === 'network' && (
                <NetworkVisualizer state={state} params={params} />
              )}
              {activeTab === 'raster' && (
                <SpikeRaster spikes={state.spikes} params={params} currentTime={state.t} />
              )}
              {activeTab === 'capacity' && (
                <CapacityMeter state={state} params={params} />
              )}
            </div>
          </div>
        </div>

        {/* Right Theory Panel */}
        <div
          className="transition-all duration-300 overflow-hidden border-l border-border bg-bg-secondary shrink-0"
          style={{ width: isTheoryOpen ? 320 : 0 }}
        >
          {isTheoryOpen && <TheoryPanel state={state} params={params} />}
        </div>

        {/* Theory toggle */}
        <button
          onClick={() => setIsTheoryOpen(!isTheoryOpen)}
          className="absolute right-4 bottom-4 w-10 h-10 bg-bg-tertiary border border-border rounded-full flex items-center justify-center shadow-xl hover:border-accent-blue transition-colors z-50"
          title="Toggle theory panel"
        >
          <Info className={`w-5 h-5 ${isTheoryOpen ? 'text-accent-blue' : 'text-text-secondary'}`} />
        </button>
      </main>
    </div>
  );
}
