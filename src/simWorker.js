/**
 * Simulation Web Worker
 * Runs the SNN engine off the main thread so the UI never blocks.
 * Uses setTimeout (not requestAnimationFrame — RAF doesn't exist in Workers).
 */
import { SimulationEngine } from './SimulationEngine.js';

let engine = null;
let loopTimeout = null;
let lastTimestamp = 0;
let isRunning = false;

self.onmessage = (e) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT':
      engine = new SimulationEngine(payload);
      postState();
      break;

    case 'UPDATE_PARAMS':
      if (engine) engine.updateParams(payload);
      break;

    case 'LOAD_ITEM':
      if (engine) engine.loadItem(payload);
      break;

    case 'REMOVE_ITEM':
      if (engine) engine.removeItem(payload);
      break;

    case 'RESET':
      stopLoop();
      if (engine) engine.reset();
      postState();
      break;

    case 'START':
      if (!isRunning) {
        isRunning = true;
        lastTimestamp = performance.now();
        scheduleLoop();
      }
      break;

    case 'STOP':
      stopLoop();
      break;

    case 'STEP':
      if (engine && !isRunning) {
        engine.step();
        postState();
      }
      break;
  }
};

function stopLoop() {
  isRunning = false;
  if (loopTimeout !== null) {
    clearTimeout(loopTimeout);
    loopTimeout = null;
  }
}

function scheduleLoop() {
  if (!isRunning) return;
  loopTimeout = setTimeout(run, 16); // ~60fps target
}

function run() {
  loopTimeout = null;
  if (!engine || !isRunning) return;

  const sim_speed = engine.params.sim_speed || 1;
  const steps_per_frame = Math.max(1, Math.round((16 * sim_speed) / engine.params.dt));

  for (let i = 0; i < steps_per_frame; i++) {
    engine.step();
  }

  postState();
  scheduleLoop();
}

function postState() {
  if (!engine) return;

  // Transferable arrays for performance — clone typed arrays for safe transfer
  const state = engine.getFullState();

  self.postMessage({
    type: 'STATE_UPDATE',
    payload: {
      t: state.t,
      V: Array.from(state.V),
      spikes: state.spikes.slice(-500), // last 500 spikes for raster
      firing_rates: Array.from(state.firing_rates),
      stimuli: Array.from(state.stimuli),
      active: state.active,
      trace_exc: Array.from(state.trace_exc),
      trace_inh: Array.from(state.trace_inh),
      capacity_history: state.capacity_history.slice(-400), // last 400 points
      suppression_history: state.suppression_history.slice(-400),
      active_count: state.active_count,
      suppression_floor: state.suppression_floor,
      predicted_capacity: state.predicted_capacity,
    },
  });
}
