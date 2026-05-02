import React, { useRef, useEffect } from 'react';

export default function CapacityMeter({ state, params }) {
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
      const { capacity_history, suppression_history, active_count, predicted_capacity, suppression_floor } = state;

      ctx.fillStyle = '#060810';
      ctx.fillRect(0, 0, W, H);

      const padL = 44, padR = 20, padT = 32, padB = 36;
      const gW = W - padL - padR;
      const gH = H - padT - padB;

      // Y grid lines
      for (let v = 0; v <= n_groups; v += 2) {
        const y = padT + gH - (v / n_groups) * gH;
        ctx.strokeStyle = v === 0 ? '#1e3a5f' : '#0f1825';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + gW, y);
        ctx.stroke();
        ctx.fillStyle = '#334155';
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(v, padL - 6, y + 3);
      }

      if (capacity_history.length > 1) {
        const len = capacity_history.length;

        // Suppression floor area fill
        if (suppression_history.length > 1) {
          ctx.fillStyle = 'rgba(245,158,11,0.06)';
          ctx.beginPath();
          ctx.moveTo(padL, padT + gH);
          suppression_history.forEach((s, i) => {
            const x = padL + (i / (len - 1)) * gW;
            const y = padT + gH - (s * n_groups / n_groups) * gH;
            ctx.lineTo(x, y);
          });
          ctx.lineTo(padL + gW, padT + gH);
          ctx.closePath();
          ctx.fill();

          // Suppression floor line
          ctx.strokeStyle = 'rgba(245,158,11,0.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          suppression_history.forEach((s, i) => {
            const x = padL + (i / (len - 1)) * gW;
            const y = padT + gH - (s * n_groups / n_groups) * gH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Capacity line
        ctx.strokeStyle = '#06d6f0';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        capacity_history.forEach((pt, i) => {
          const x = padL + (i / (len - 1)) * gW;
          const y = padT + gH - (pt.v / n_groups) * gH;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }

      // Predicted capacity reference line
      const pred = predicted_capacity ?? Math.round((params.w_exc / params.w_inh) * 3.8);
      const predY = padT + gH - (pred / n_groups) * gH;
      ctx.strokeStyle = 'rgba(245,158,11,0.5)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(padL, predY);
      ctx.lineTo(padL + gW, predY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f59e0b';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`predicted ~${pred}`, padL + 4, predY - 4);

      // Live stats
      ctx.fillStyle = '#06d6f0';
      ctx.font = 'bold 13px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`${active_count ?? 0} active`, padL + gW, padT - 8);

      ctx.fillStyle = 'rgba(245,158,11,0.8)';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`floor: ${Math.round((suppression_floor ?? 0) * 100)}%`, padL + 4, padT - 8);

      // Axes
      ctx.strokeStyle = '#1e3a5f';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, padT);
      ctx.lineTo(padL, padT + gH);
      ctx.lineTo(padL + gW, padT + gH);
      ctx.stroke();

      // Labels
      ctx.fillStyle = '#334155';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Items held in working memory over time', padL + gW / 2, H - 8);

      // Legend
      const lx = padL + 10, ly = padT + gH - 20;
      ctx.fillStyle = '#06d6f0';
      ctx.fillRect(lx, ly, 20, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'left';
      ctx.fillText('active items', lx + 26, ly + 4);

      ctx.fillStyle = 'rgba(245,158,11,0.4)';
      ctx.fillRect(lx + 110, ly, 20, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('suppression floor', lx + 136, ly + 4);
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
