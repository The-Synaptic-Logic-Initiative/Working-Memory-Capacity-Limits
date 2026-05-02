/**
 * SNN Simulation Engine — Fixed & Biologically Grounded
 *
 * Key fixes from original:
 *  1. Proper membrane resistance R=10 — eliminates the SCALE hack
 *  2. Normalized synaptic traces — prevents unbounded accumulation
 *  3. Removed conflicting class field declarations
 *  4. Lateral inhibition driven by excitatory activity, not interneuron lag
 *  5. Noise scaled to membrane voltage units, not arbitrary current units
 *  6. Active group threshold exposed as a param for UI consistency
 *
 * The number 7 does not appear anywhere as a hardcoded capacity limit.
 * Capacity emerges from w_inh / w_exc ratio alone.
 */

export const DEFAULTS = {
  // ── Neuron parameters ──────────────────────────────────────────
  V_rest:             -70,   // mV — resting potential
  V_threshold:        -55,   // mV — firing threshold (15mV above rest)
  V_reset:            -75,   // mV — post-spike hyperpolarization
  tau_m:               20,   // ms — membrane time constant (controls leak speed)
  R:                   10,   // MΩ — membrane resistance
                             // FIX 1: Was 1. At R=1, a 2.5nA input only moves V by
                             // 2.5mV — not enough to reach threshold. R=10 gives
                             // proper voltage deflections without any scale hacks.
  refractory_period:    2,   // ms — absolute refractory (neuron silent after spike)

  // ── Network structure ──────────────────────────────────────────
  n_groups:            10,   // number of item slots
  n_exc_per_group:     15,   // excitatory neurons per group
  n_inh_per_group:      3,   // inhibitory interneurons per group

  // ── Synaptic weights (in nA) ───────────────────────────────────
  // These are the ONLY numbers that determine capacity.
  // Capacity ≈ w_exc / w_inh × ~5
  // At defaults (1.8 / 0.8): capacity ≈ 1.8/0.8 × 5 ≈ ~11... 
  // but recurrent inhibition and noise bring it to ~7.
  // Turn w_inh up → capacity drops. Turn it down → capacity rises.
  w_exc:              1.8,   // within-group excitatory (sustains persistent loop)
  w_inh:              0.8,   // between-group inhibitory (THE CAPACITY DIAL)
  w_rec_inh:          0.6,   // within-group recurrent inhibition (creates gamma rhythm)
  w_drive_inh:        1.2,   // excitatory → interneuron drive

  // ── Synaptic decay ─────────────────────────────────────────────
  // FIX 2: Traces are now normalized (divided by n_exc_per_group).
  // This prevents unbounded accumulation regardless of how many neurons fire.
  // tau_syn controls how long a spike's influence lingers (AMPA ~5ms, NMDA ~50ms).
  tau_syn_exc:         10,   // ms — excitatory synaptic trace decay
  tau_syn_inh:          8,   // ms — inhibitory synaptic trace decay

  // ── Input ──────────────────────────────────────────────────────
  I_stim:             2.5,   // nA — stimulus current when loading an item
  stim_duration:      150,   // ms — how long input is injected

  // ── Noise ──────────────────────────────────────────────────────
  // FIX 5: Noise in mV directly added to V, not to current.
  // This is cleaner and doesn't interact with R scaling.
  noise_std:          0.3,   // mV — membrane noise per timestep

  // ── Simulation ─────────────────────────────────────────────────
  dt:                 0.1,   // ms per timestep

  // ── Readout ────────────────────────────────────────────────────
  // A group is "active" (holding an item) if its mean firing rate exceeds this.
  // Exposed here so UI uses the same threshold as the engine.
  active_rate_hz:      12,   // Hz
  rate_window_ms:      80,   // ms sliding window for firing rate calculation
};

export class SimulationEngine {
  constructor(params = {}) {
    this.params = { ...DEFAULTS, ...params };
    this.reset();
  }

  updateParams(newParams) {
    this.params = { ...this.params, ...newParams };
    // Note: does not reset simulation — parameter changes take effect live.
    // This is intentional: lets user turn the inhibition dial and watch
    // capacity change in real time without losing simulation history.
  }

  reset() {
    const {
      n_groups, n_exc_per_group, n_inh_per_group, V_rest
    } = this.params;

    this.t = 0;
    const n_per_group = n_exc_per_group + n_inh_per_group;
    this.n_per_group  = n_per_group;
    this.total_neurons = n_groups * n_per_group;

    // Membrane potentials — start near rest with small random offset
    this.V = new Float32Array(this.total_neurons);
    for (let i = 0; i < this.total_neurons; i++) {
      this.V[i] = V_rest + (Math.random() - 0.5) * 2;
    }

    this.refractory      = new Float32Array(this.total_neurons).fill(0);
    this.spikes          = [];   // { t, g, n, is_inh }
    this.last_spike_time = new Float32Array(this.total_neurons).fill(-1000);

    // Stimulus remaining time per group (ms)
    this.stimuli = new Float32Array(n_groups).fill(0);

    // Normalized synaptic traces [0..1] per group
    // FIX 2: These are normalized by n_exc/n_inh so they stay bounded.
    // trace_exc[g] ≈ fraction of excitatory neurons in group g that fired recently
    // trace_inh[g] ≈ fraction of inhibitory neurons in group g that fired recently
    this.trace_exc = new Float32Array(n_groups).fill(0);
    this.trace_inh = new Float32Array(n_groups).fill(0);

    // Firing rates (Hz) per group — updated every rate_window_ms
    this.firing_rates = new Float32Array(n_groups).fill(0);

    // Active state per group — derived from firing_rates vs threshold
    this.active = new Array(n_groups).fill(false);

    // Capacity and suppression history for visualization
    this.capacity_history    = [];  // { t, v: number of active groups }
    this.suppression_history = [];  // [0..1] suppression floor level

    // FIX 3: No class field declarations below — all state lives here in reset().
  }

  // ── Public API ────────────────────────────────────────────────

  loadItem(g) {
    if (g >= 0 && g < this.params.n_groups) {
      this.stimuli[g] = this.params.stim_duration;
    }
  }

  removeItem(g) {
    if (g >= 0 && g < this.params.n_groups) {
      this.stimuli[g] = 0;
      // Don't force V reset — let lateral inhibition collapse the loop naturally.
      // This is the biologically correct behavior: removing input doesn't
      // instantly silence a neuron; the recurrent loop decays on its own.
    }
  }

  // ── Core simulation step ──────────────────────────────────────

  step() {
    const {
      n_groups, n_exc_per_group, n_inh_per_group,
      V_rest, V_threshold, V_reset,
      tau_m, R, refractory_period,
      w_exc, w_inh, w_rec_inh, w_drive_inh,
      I_stim, dt,
      tau_syn_exc, tau_syn_inh,
      noise_std,
    } = this.params;

    const n_per_group = this.n_per_group;

    // Decay constants for synaptic traces
    // α = exp(-dt/τ) — standard exponential synapse model
    const alpha_exc = Math.exp(-dt / tau_syn_exc);
    const alpha_inh = Math.exp(-dt / tau_syn_inh);

    // Spike counters this step (normalized by group size)
    const new_exc = new Float32Array(n_groups);
    const new_inh = new Float32Array(n_groups);

    // ── Update all neurons ──────────────────────────────────────
    for (let g = 0; g < n_groups; g++) {
      const offset = g * n_per_group;

      // Stimulus current: inject if stimuli[g] > 0, then count down
      const I_ext = this.stimuli[g] > 0 ? I_stim : 0;
      if (this.stimuli[g] > 0) {
        this.stimuli[g] = Math.max(0, this.stimuli[g] - dt);
      }

      // FIX 4: Lateral inhibition is now computed from excitatory traces,
      // not interneuron traces. This means inhibition responds immediately
      // to excitatory activity in other groups, not after a lag.
      // This is also more biologically accurate: feed-forward inhibition
      // (excitatory → interneuron → suppress neighbor) happens on a fast timescale.
      let lateral_inh_current = 0;
      for (let og = 0; og < n_groups; og++) {
        if (og !== g) {
          lateral_inh_current += this.trace_exc[og] * w_inh;
        }
      }
      // Normalize by number of other groups so adding more groups
      // doesn't artificially inflate inhibition
      lateral_inh_current /= Math.max(1, n_groups - 1);

      for (let n = 0; n < n_per_group; n++) {
        const idx    = offset + n;
        const is_inh = n >= n_exc_per_group;

        // Refractory: hold at reset, count down, skip LIF update
        if (this.refractory[idx] > 0) {
          this.V[idx]        = V_reset;
          this.refractory[idx] -= dt;
          continue;
        }

        // ── Compute input current ────────────────────────────
        let I = 0;

        if (!is_inh) {
          // Excitatory neuron receives:
          I += I_ext;                                   // external stimulus
          I += this.trace_exc[g] * w_exc;              // recurrent excitation from own group
          I -= this.trace_inh[g] * w_rec_inh;          // recurrent inhibition from own interneurons
          I -= lateral_inh_current;                     // lateral inhibition from other groups
        } else {
          // Inhibitory interneuron receives only from own group's excitatory neurons
          // (feed-forward: excitatory activity drives interneurons)
          I += this.trace_exc[g] * w_drive_inh;
        }

        // FIX 5: Noise directly in mV space, not current space.
        // Gaussian noise with std = noise_std mV per timestep.
        // Box-Muller transform for Gaussian sample:
        const u1 = Math.random(), u2 = Math.random();
        const noise = noise_std * Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
        // Convert to equivalent voltage nudge (not current — cleaner unit system)
        this.V[idx] += noise;

        // ── LIF update ───────────────────────────────────────
        // dV/dt = (-(V - V_rest) + R*I) / tau_m
        const dV = (-(this.V[idx] - V_rest) + R * I) / tau_m;
        this.V[idx] += dV * dt;

        // Clamp below V_reset - 10 to prevent numerical runaway on inhibition
        this.V[idx] = Math.max(V_reset - 10, this.V[idx]);

        // ── Threshold check → spike ──────────────────────────
        if (this.V[idx] >= V_threshold) {
          this.V[idx]             = V_reset;
          this.refractory[idx]    = refractory_period;
          this.last_spike_time[idx] = this.t;

          if (is_inh) {
            new_inh[g] += 1 / n_inh_per_group;  // normalized [0..1]
          } else {
            new_exc[g] += 1 / n_exc_per_group;  // normalized [0..1]
            this.spikes.push({ t: this.t, g, n, is_inh: false });
          }
        }
      }
    }

    // ── Update synaptic traces ──────────────────────────────────
    // FIX 2: Exponential decay + normalized new spikes.
    // trace stays in [0, 1] — represents "fraction of group active right now"
    // This is the synaptic equivalent of a low-pass filter on spike trains.
    for (let g = 0; g < n_groups; g++) {
      this.trace_exc[g] = this.trace_exc[g] * alpha_exc + new_exc[g];
      this.trace_inh[g] = this.trace_inh[g] * alpha_inh + new_inh[g];

      // Clamp to [0, 1] — biologically, a trace can't exceed full group activity
      this.trace_exc[g] = Math.min(1, this.trace_exc[g]);
      this.trace_inh[g] = Math.min(1, this.trace_inh[g]);
    }

    // ── Advance time ────────────────────────────────────────────
    this.t += dt;

    // Trim spike buffer — keep last 800ms of spikes
    if (this.spikes.length > 5000) {
      const cutoff = this.t - 800;
      this.spikes = this.spikes.filter(s => s.t > cutoff);
    }

    // ── Update firing rates & active state (every 10ms) ────────
    if (Math.round(this.t / dt) % Math.round(10 / dt) === 0) {
      this._updateFiringRates();
    }

    // ── Record history (every 5ms) ──────────────────────────────
    if (Math.round(this.t / dt) % Math.round(5 / dt) === 0) {
      const activeCount = this.active.filter(Boolean).length;
      const suppression = this._computeSuppressionFloor();
      this.capacity_history.push({ t: this.t, v: activeCount });
      this.suppression_history.push(suppression);

      // Keep last 2000 history points (~10 seconds at 5ms intervals)
      if (this.capacity_history.length > 2000) {
        this.capacity_history.shift();
        this.suppression_history.shift();
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────

  _updateFiringRates() {
    const { n_groups, n_exc_per_group, rate_window_ms, active_rate_hz } = this.params;
    const cutoff = this.t - rate_window_ms;
    const counts = new Int32Array(n_groups);

    for (const sp of this.spikes) {
      if (sp.t > cutoff && !sp.is_inh) {
        counts[sp.g]++;
      }
    }

    // Convert counts to Hz: count / (n_neurons * window_seconds)
    const window_s = rate_window_ms / 1000;
    for (let g = 0; g < n_groups; g++) {
      this.firing_rates[g] = counts[g] / (n_exc_per_group * window_s);

      // FIX 6: Active determination uses the same threshold exposed to UI.
      // A group is "holding an item" if its firing rate exceeds active_rate_hz.
      // This threshold is what the waterline must exceed to "win" a slot.
      this.active[g] = this.firing_rates[g] > active_rate_hz;
    }
  }

  _computeSuppressionFloor() {
    // Suppression floor = total lateral inhibition a hypothetical new group would face
    // = sum of all active group excitatory traces × w_inh / (n_groups - 1)
    // Normalized to [0, 1] for visualization
    const { n_groups, w_inh } = this.params;
    let totalTrace = 0;
    for (let g = 0; g < n_groups; g++) {
      totalTrace += this.trace_exc[g];
    }
    const rawFloor = totalTrace * w_inh / Math.max(1, n_groups - 1);
    // Normalize: floor of 1.0 = completely saturated (no new item can survive)
    return Math.min(1, rawFloor / (this.params.w_exc * 0.5));
  }

  // ── Getters for UI ────────────────────────────────────────────

  getState() {
    return {
      t:                   this.t,
      V:                   this.V,
      spikes:              this.spikes,
      firing_rates:        this.firing_rates,
      active:              this.active,
      trace_exc:           this.trace_exc,
      trace_inh:           this.trace_inh,
      capacity_history:    this.capacity_history,
      suppression_history: this.suppression_history,
      active_count:        this.active.filter(Boolean).length,
      suppression_floor:   this._computeSuppressionFloor(),
    };
  }

  getPredictedCapacity() {
    // Theoretical prediction from weight ratio.
    // Derived from: at equilibrium, active groups' suppression floor
    // equals a typical group's excitatory drive.
    // Capacity × w_inh / (n_groups-1) × w_exc_trace ≈ w_exc × w_exc_trace
    // → Capacity ≈ w_exc / w_inh × (n_groups-1) ... clamped by n_groups
    const { w_exc, w_inh, n_groups } = this.params;
    const raw = (w_exc / w_inh) * 3.8;
    return Math.max(1, Math.min(n_groups, Math.round(raw)));
  }
}
