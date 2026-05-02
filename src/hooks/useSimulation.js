import { useState, useEffect, useRef, useCallback } from 'react';
import { DEFAULTS } from '../SimulationEngine.js';

const INITIAL_STATE = {
  t: 0,
  V: [],
  spikes: [],
  firing_rates: new Array(DEFAULTS.n_groups).fill(0),
  stimuli: new Array(DEFAULTS.n_groups).fill(0),
  active: new Array(DEFAULTS.n_groups).fill(false),
  trace_exc: new Array(DEFAULTS.n_groups).fill(0),
  trace_inh: new Array(DEFAULTS.n_groups).fill(0),
  capacity_history: [],
  suppression_history: [],
  active_count: 0,
  suppression_floor: 0,
  predicted_capacity: 7,
};

export function useSimulation() {
  const workerRef = useRef(null);
  const [state, setState] = useState(INITIAL_STATE);
  const [params, setParams] = useState({ ...DEFAULTS });
  const [isRunning, setIsRunning] = useState(false);

  // Init worker on mount
  useEffect(() => {
    const worker = new Worker(
      new URL('../simWorker.js', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e) => {
      if (e.data.type === 'STATE_UPDATE') {
        setState(e.data.payload);
      }
    };

    worker.onerror = (err) => {
      console.error('SimWorker error:', err);
    };

    workerRef.current = worker;
    worker.postMessage({ type: 'INIT', payload: { ...DEFAULTS } });

    return () => {
      worker.postMessage({ type: 'STOP' });
      worker.terminate();
    };
  }, []);

  const start = useCallback(() => {
    setIsRunning(true);
    workerRef.current?.postMessage({ type: 'START' });
  }, []);

  const stop = useCallback(() => {
    setIsRunning(false);
    workerRef.current?.postMessage({ type: 'STOP' });
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setState(INITIAL_STATE);
    workerRef.current?.postMessage({ type: 'RESET' });
  }, []);

  const step = useCallback(() => {
    workerRef.current?.postMessage({ type: 'STEP' });
  }, []);

  const updateParams = useCallback((newParams) => {
    setParams(prev => {
      const merged = { ...prev, ...newParams };
      workerRef.current?.postMessage({ type: 'UPDATE_PARAMS', payload: newParams });
      return merged;
    });
  }, []);

  const loadItem = useCallback((groupIndex) => {
    workerRef.current?.postMessage({ type: 'LOAD_ITEM', payload: groupIndex });
  }, []);

  const removeItem = useCallback((groupIndex) => {
    workerRef.current?.postMessage({ type: 'REMOVE_ITEM', payload: groupIndex });
  }, []);

  return {
    state,
    params,
    isRunning,
    start,
    stop,
    reset,
    step,
    updateParams,
    loadItem,
    removeItem,
  };
}
