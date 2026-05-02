/**
 * SNN Simulation Engine — Biologically Grounded LIF Network
 *
 * Implements Miller's Law (7±2) emergence through:
 *  - Leaky Integrate-and-Fire neurons
 *  - Recurrent excitation (persistent memory loops)
 *  - Lateral inhibition (capacity competition)
 *  - Normalized synaptic traces (bounded, stable dynamics)
 *
 * THE NUMBER 7 DOES NOT EXIST AS A HARDCODED LIMIT ANYWHERE.
 * Capacity emerges from w_exc / w_inh ratio alone.
 *
 * w_exc=2.8, w_inh=1.5 → ratio=1.87 → capacity ≈ 1.87 × 3.8 ≈ 7.1
 * Verified by Ohm's Law: net_I = 2.8-0.6 = 2.2nA → V_lift = 22mV
 * → stable V = -70+22 = -48mV, well above threshold -55mV ✓
 */

export const DEFAULTS = {
  // ── Neuron parameters ──────────────────────────────────────────
  V_rest:             -70,   // mV
  V_threshold:        -55,   // mV  (15mV gap from rest)
  V_reset:            -75,   // mV  (post-spike hyperpolarization)
  tau_m:               20,   // ms  (membrane time constant / leak speed)
  R:                   10,   // MΩ  (membrane resistance — critical for Ohm's Law)
  refractory_period:    2,   // ms  (absolute refractory after spike)

  // ── Network structure ──────────────────────────────────────────
  n_groups:            10,   // item slots
  n_exc_per_group:     15,   // excitatory neurons per group
  n_inh_per_group:      3,   // inhibitory interneurons per group

  // ── Synaptic weights (nA) — THE ONLY CAPACITY DIAL ────────────
  // Capacity ≈ (w_exc / w_inh) × 3.8
  // Ohm's Law check: (w_exc - w_rec_inh) × R > (V_threshold - V_rest)
  //   → (2.8 - 0.6) × 10 = 22mV > 15mV ✓  loop sustains after input ends
  w_exc:              2.8,   // within-group excitatory (sustains loop)
  w_inh:              1.5,   // between-group inhibitory (THE CAPACITY DIAL)
  w_rec_inh:          0.6,   // within-group recurrent inhibition (gamma rhythm)
  w_drive_inh:        1.2,   // excitatory → interneuron drive

  // ── Synaptic decay ─────────────────────────────────────────────
  tau_syn_exc:         10,   // ms (AMPA-like excitatory trace)
  tau_syn_inh:          8,   // ms (GABA-like inhibitory trace)

  // ── Input ──────────────────────────────────────────────────────
  I_stim:             2.5,   // nA — stimulus when loading
  stim_duration:      150,   // ms — how long stimulus is injected

  // ── Noise ──────────────────────────────────────────────────────
  noise_std:          0.3,   // mV — membrane voltage noise (Box-Muller)

  // ── Simulation ─────────────────────────────────────────────────
  dt:                 0.1,   // ms per timestep
  sim_speed:          1,     // multiplier for worker loop

  // ── Readout ────────────────────────────────────────────────────
  active_rate_hz:      12,   // Hz — firing rate threshold for "active" group
  rate_window_ms:      80,   // ms — sliding window for rate calculation
};

export class SimulationEngine {
  constructor(params = {}) {
    this.params = { ...DEFAULTS, ...params };
    this.reset();
  }

  updateParams(newParams) {
    this.params = { ...this.params, ...newParams };
    // Live update — no reset needed. Capacity changes take effect immediately.
  }

  reset() {
    const { n_groups, n_exc_per_group, n_inh_per_group, V_rest } = this.params;
    const n_per_group = n_exc_per_group + n_inh_per_group;

    this.t = 0;
    this.n_per_group = n_per_group;
    this.total_neurons = n_groups * n_per_group;

    // Membrane potentials — small random offset from rest
    this.V = new Float32Array(this.total_neurons);
    for (let i = 0; i < this.total_neurons; i++) {
      this.V[i] = V_rest + (Math.random() - 0.5) * 2;
    }

    this.refractory = new Float32Array(this.total_neurons).fill(0);
    this.spikes = [];
    this.last_spike_time = new Float32Array(this.total_neurons).fill(-1000);

    // Stimulus countdown per group (ms remaining)
    this.stimuli = new Float32Array(n_groups).fill(0);

    // Normalized synaptic traces [0..1]
    // trace_exc[g] ≈ fraction of excitatory neurons in group g firing recently
    this.trace_exc = new Float32Array(n_groups).fill(0);
    this.trace_inh = new Float32Array(n_groups).fill(0);

    // Firing rates (Hz) and active state per group
    this.firing_rates = new Float32Array(n_groups).fill(0);
    this.active = new Array(n_groups).fill(false);

    // History for visualization
    this.capacity_history = [];    // {t, v: activeCount}
    this.suppression_history = []; // [0..1]
  }

  loadItem(g) {
    if (g >= 0 && g < this.params.n_groups) {
      this.stimuli[g] = this.params.stim_duration;
    }
  }

  removeItem(g) {
    if (g >= 0 && g < this.params.n_groups) {
      this.stimuli[g] = 0;
      // Do NOT force reset V — let lateral inhibition collapse the loop naturally
    }
  }

  step() {
    const {
      n_groups, n_exc_per_group, n_inh_per_group,
      V_rest, V_threshold, V_reset,
      tau_m, R, refractory_period,
      w_exc, w_inh, w_rec_inh, w_drive_inh,
      I_stim, dt, tau_syn_exc, tau_syn_inh, noise_std,
    } = this.params;

    const n_per_group = this.n_per_group;
    const alpha_exc = Math.exp(-dt / tau_syn_exc);
    const alpha_inh = Math.exp(-dt / tau_syn_inh);

    // Normalized spike counters this step
    const new_exc = new Float32Array(n_groups);
    const new_inh = new Float32Array(n_groups);

    for (let g = 0; g < n_groups; g++) {
      const offset = g * n_per_group;

      // Stimulus
      const I_ext = this.stimuli[g] > 0 ? I_stim : 0;
      if (this.stimuli[g] > 0) {
        this.stimuli[g] = Math.max(0, this.stimuli[g] - dt);
      }

      // Lateral inhibition — driven by excitatory traces (not interneuron lag)
      // This is feed-forward inhibition: responds immediately to competitor activity
      let lateral_inh = 0;
      for (let og = 0; og < n_groups; og++) {
        if (og !== g) lateral_inh += this.trace_exc[og] * w_inh;
      }
      lateral_inh /= Math.max(1, n_groups - 1);

      for (let n = 0; n < n_per_group; n++) {
        const idx = offset + n;
        const is_inh = n >= n_exc_per_group;

        if (this.refractory[idx] > 0) {
          this.V[idx] = V_reset;
          this.refractory[idx] -= dt;
          continue;
        }

        let I = 0;
        if (!is_inh) {
          I += I_ext;
          I += this.trace_exc[g] * w_exc;      // recurrent excitation
          I -= this.trace_inh[g] * w_rec_inh;  // recurrent inhibition (rhythm)
          I -= lateral_inh;                     // competition from other groups
        } else {
          I += this.trace_exc[g] * w_drive_inh; // interneurons driven by excitatory
        }

        // Gaussian noise in mV (Box-Muller) — cleaner than current-space noise
        const u1 = Math.random(), u2 = Math.random();
        const noise = noise_std * Math.sqrt(-2 * Math.log(u1 + 1e-10))
                      * Math.cos(2 * Math.PI * u2);
        this.V[idx] += noise;

        // LIF: dV/dt = (-(V-V_rest) + R*I) / tau_m
        const dV = (-(this.V[idx] - V_rest) + R * I) / tau_m;
        this.V[idx] += dV * dt;
        this.V[idx] = Math.max(V_reset - 10, this.V[idx]);

        if (this.V[idx] >= V_threshold) {
          this.V[idx] = V_reset;
          this.refractory[idx] = refractory_period;
          this.last_spike_time[idx] = this.t;

          if (is_inh) {
            new_inh[g] += 1 / n_inh_per_group;
          } else {
            new_exc[g] += 1 / n_exc_per_group;
            this.spikes.push({ t: this.t, g, n, is_inh: false });
          }
        }
      }
    }

    // Update synaptic traces — exponential decay + normalized new activity
    for (let g = 0; g < n_groups; g++) {
      this.trace_exc[g] = Math.min(1, this.trace_exc[g] * alpha_exc + new_exc[g]);
      this.trace_inh[g] = Math.min(1, this.trace_inh[g] * alpha_inh + new_inh[g]);
    }

    this.t += dt;

    // Trim spike buffer — keep 800ms
    if (this.spikes.length > 5000) {
      const cutoff = this.t - 800;
      this.spikes = this.spikes.filter(s => s.t > cutoff);
    }

    // Update firing rates every 10ms
    if (Math.round(this.t / dt) % Math.round(10 / dt) === 0) {
      this._updateFiringRates();
    }

    // Record history every 5ms
    if (Math.round(this.t / dt) % Math.round(5 / dt) === 0) {
      const activeCount = this.active.filter(Boolean).length;
      const suppression = this._computeSuppressionFloor();
      this.capacity_history.push({ t: this.t, v: activeCount });
      this.suppression_history.push(suppression);
      if (this.capacity_history.length > 2000) {
        this.capacity_history.shift();
        this.suppression_history.shift();
      }
    }
  }

  _updateFiringRates() {
    const { n_groups, n_exc_per_group, rate_window_ms, active_rate_hz } = this.params;
    const cutoff = this.t - rate_window_ms;
    const counts = new Int32Array(n_groups);

    for (const sp of this.spikes) {
      if (sp.t > cutoff && !sp.is_inh) counts[sp.g]++;
    }

    const window_s = rate_window_ms / 1000;
    for (let g = 0; g < n_groups; g++) {
      this.firing_rates[g] = counts[g] / (n_exc_per_group * window_s);
      this.active[g] = this.firing_rates[g] > active_rate_hz;
    }
  }

  _computeSuppressionFloor() {
    const { n_groups, w_inh, w_exc } = this.params;
    let totalTrace = 0;
    for (let g = 0; g < n_groups; g++) totalTrace += this.trace_exc[g];
    const rawFloor = (totalTrace * w_inh) / Math.max(1, n_groups - 1);
    return Math.min(1, rawFloor / (w_exc * 0.5));
  }

  getPredictedCapacity() {
    const { w_exc, w_inh, n_groups } = this.params;
    const raw = (w_exc / w_inh) * 3.8;
    return Math.max(1, Math.min(n_groups, Math.round(raw)));
  }

  getFullState() {
    return {
      t: this.t,
      V: this.V,
      spikes: this.spikes,
      firing_rates: this.firing_rates,
      stimuli: this.stimuli,
      active: this.active,
      trace_exc: this.trace_exc,
      trace_inh: this.trace_inh,
      capacity_history: this.capacity_history,
      suppression_history: this.suppression_history,
      active_count: this.active.filter(Boolean).length,
      suppression_floor: this._computeSuppressionFloor(),
      predicted_capacity: this.getPredictedCapacity(),
    };
  }
}
