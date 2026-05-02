import React, { useRef, useEffect } from 'react';

const GROUP_COLORS = [
  '#3b82f6','#06d6f0','#10f080','#f59e0b',
  '#ff4444','#a855f7','#ec4899','#14b8a6','#f97316','#84cc16',
];

export default function SpikeRaster({ spikes, params, currentTime }) {
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
      const { n_groups } = params;

      ctx.fillStyle = '#060810';
      ctx.fillRect(0, 0, W, H);

      const padL = 64, padR = 10, padT = 20, padB = 28;
      const gW = W - padL - padR;
      const gH = H - padT - padB;
      const timeWindow = 600; // ms shown
      const tMin = currentTime - timeWindow;
      const rowH = gH / n_groups;

      // Grid lines
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 0.5;
      for (let g = 0; g <= n_groups; g++) {
        const y = padT + g * rowH;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + gW, y);
        ctx.stroke();
      }

      // Time grid (every 100ms)
      ctx.strokeStyle = '#0f1d2f';
      for (let ms = 0; ms <= timeWindow; ms += 100) {
        const x = padL + (ms / timeWindow) * gW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + gH);
        ctx.stroke();
      }

      // Group labels
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      for (let g = 0; g < n_groups; g++) {
        const y = padT + (g + 0.5) * rowH;
        ctx.fillStyle = GROUP_COLORS[g];
        ctx.textAlign = 'right';
        ctx.fillText(`G${g + 1}`, padL - 4, y + 3);
      }

      // Spikes
      for (const sp of spikes) {
        if (sp.t < tMin || sp.is_inh) continue;
        const x = padL + ((sp.t - tMin) / timeWindow) * gW;
        const yBase = padT + sp.g * rowH;
        ctx.fillStyle = GROUP_COLORS[sp.g] || '#888';
        ctx.fillRect(x, yBase + 1, 1.5, rowH - 2);
      }

      // Time axis
      ctx.strokeStyle = '#1e3a5f';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, padT + gH);
      ctx.lineTo(padL + gW, padT + gH);
      ctx.stroke();

      // Time labels
      ctx.fillStyle = '#334155';
      ctx.font = '8px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      for (let ms = 0; ms <= timeWindow; ms += 200) {
        const x = padL + (ms / timeWindow) * gW;
        ctx.fillText(`-${timeWindow - ms}ms`, x, padT + gH + 12);
      }
      ctx.fillText('now', padL + gW, padT + gH + 12);

      // Legend
      ctx.fillStyle = '#334155';
      ctx.textAlign = 'center';
      ctx.fillText('← 600ms rolling window →', padL + gW / 2, H - 5);
    };

    const loop = () => {
      render();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [spikes, params, currentTime]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}
