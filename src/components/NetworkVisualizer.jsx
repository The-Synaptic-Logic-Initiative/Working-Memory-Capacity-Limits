import React, { useRef, useEffect } from 'react';

export default function NetworkVisualizer({ state, params }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const render = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;

      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      const { n_groups, n_exc_per_group, V_rest, V_threshold } = params;
      const { V, active, firing_rates, spikes, t } = state;

      ctx.fillStyle = '#060810';
      ctx.fillRect(0, 0, W, H);

      const padL = 72, padR = 12, padT = 24, padB = 20;
      const gW = W - padL - padR;
      const gH = H - padT - padB;
      const rowH = gH / n_groups;
      const colW = gW / n_exc_per_group;

      // Column header
      ctx.fillStyle = '#1e3a5f';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('← NEURONS →', padL + gW / 2, padT - 8);

      for (let g = 0; g < n_groups; g++) {
        const y = padT + g * rowH;
        const isActive = active[g];
        const rate = Math.round(firing_rates[g] ?? 0);
        const groupOffset = g * (n_exc_per_group + params.n_inh_per_group);

        // Row background
        ctx.fillStyle = isActive ? 'rgba(16,240,128,0.04)' : 'rgba(255,255,255,0.01)';
        ctx.fillRect(padL, y + 1, gW, rowH - 2);

        // Active border glow
        if (isActive) {
          ctx.strokeStyle = `rgba(16,240,128,${0.15 + Math.min(rate / 120, 0.4)})`;
          ctx.lineWidth = 1;
          ctx.strokeRect(padL + 0.5, y + 1.5, gW - 1, rowH - 3);
        }

        // Group label
        ctx.font = 'bold 10px JetBrains Mono, monospace';
        ctx.fillStyle = isActive ? '#10f080' : '#334155';
        ctx.textAlign = 'right';
        ctx.fillText(`ITEM ${g + 1}`, padL - 6, y + rowH / 2 + 4);

        // Hz
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.fillStyle = isActive ? '#10f080' : '#1e3a5f';
        ctx.textAlign = 'left';
        ctx.fillText(`${rate}Hz`, 2, y + rowH / 2 + 3);

        // Neuron cells
        for (let n = 0; n < n_exc_per_group; n++) {
          const x = padL + n * colW;
          const vIdx = groupOffset + n;
          const v = V[vIdx] ?? V_rest;
          const norm = Math.max(0, Math.min(1, (v - V_rest) / (V_threshold - V_rest)));

          // Color: dark navy → cyan → white
          let r, gr, b;
          if (norm < 0.5) {
            r = Math.round(6 + norm * 2 * 50);
            gr = Math.round(16 + norm * 2 * 90);
            b = Math.round(40 + norm * 2 * 180);
          } else {
            const t2 = (norm - 0.5) * 2;
            r = Math.round(56 + t2 * 199);
            gr = Math.round(106 + t2 * 149);
            b = Math.round(220 + t2 * 35);
          }
          ctx.fillStyle = `rgb(${r},${gr},${b})`;
          ctx.fillRect(x + 1, y + 3, colW - 2, rowH - 6);

          // Recent spike flash
          const hasSpiked = spikes.some(s => s.g === g && s.n === n && t - s.t < 18);
          if (hasSpiked) {
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            ctx.fillRect(x + 1, y + 3, colW - 2, rowH - 6);
          }
        }
      }

      // Suppression waterline
      const activeCount = (active || []).filter(Boolean).length;
      if (activeCount > 0) {
        const wY = padT + activeCount * rowH;
        if (wY < padT + gH) {
          ctx.strokeStyle = 'rgba(245,158,11,0.4)';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(padL, wY);
          ctx.lineTo(padL + gW, wY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#f59e0b';
          ctx.font = '8px JetBrains Mono, monospace';
          ctx.textAlign = 'left';
          ctx.fillText('suppression floor', padL + 4, wY - 3);
        }
      }
    };

    const loop = () => {
      render();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [state, params]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}
