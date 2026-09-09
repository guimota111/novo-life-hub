'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDatePt, fmtGroups, fmtKg, type ExercisePoint } from '@/lib/workouts';

// Gráfico de progressão de um exercício: uma série só (carga máxima por sessão,
// ou reps quando é peso corporal). Eixo x = sessões em ordem, porque a pergunta
// é "subiu de um treino pro outro?", não "quantos dias se passaram".

interface Props {
  points: ExercisePoint[];   // ordem cronológica
  unit: 'kg' | 'reps';
  prDate?: string;           // sessão do recorde — marcador destacado
}

const PAD = { top: 22, right: 18, bottom: 26, left: 42 };
const HEIGHT = 220;
const SERIES = '#fb7185';   // rose-400
const PR = '#fbbf24';       // amber-400
const SURFACE = '#0b1526';  // fundo do card, pra "furar" o marcador na linha

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const r = raw / p;
  const m = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
  return m * p;
}

export default function ExerciseProgressChart({ points, unit, prDate }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = useMemo(() => points.map(p => (unit === 'kg' ? p.weight : p.reps)), [points, unit]);

  const geo = useMemo(() => {
    const n = points.length;
    const innerW = Math.max(0, width - PAD.left - PAD.right);
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const lo = n ? Math.min(...values) : 0;
    const hi = n ? Math.max(...values) : 0;
    // Linha não precisa começar em zero (mostra variação, não magnitude), mas
    // ganha folga nas pontas e uma escala "redonda".
    const span = Math.max(hi - lo, unit === 'kg' ? 10 : 4);
    const step = niceStep(span / 3);
    const yMin = Math.max(0, Math.floor((lo - span * 0.15) / step) * step);
    const yMax = Math.ceil((hi + span * 0.15) / step) * step;
    const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;
    const ticks: number[] = [];
    for (let t = yMin; t <= yMax + 1e-9; t += step) ticks.push(+t.toFixed(2));
    // rótulos de data: primeiro, último e o que couber sem colidir
    const maxLabels = Math.max(2, Math.min(n, Math.floor(innerW / 72)));
    const labelIdx = new Set<number>();
    for (let k = 0; k < maxLabels; k++) labelIdx.add(Math.round((k * (n - 1)) / Math.max(1, maxLabels - 1)));
    return { n, innerW, innerH, x, y, ticks, labelIdx };
  }, [points, values, width, unit]);

  const prIdx = prDate ? points.findIndex(p => p.date === prDate) : -1;

  const pick = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || geo.n === 0) return;
    const mx = clientX - el.getBoundingClientRect().left - PAD.left;
    const i = geo.n <= 1 ? 0 : Math.round((mx / Math.max(1, geo.innerW)) * (geo.n - 1));
    setHover(Math.max(0, Math.min(geo.n - 1, i)));
  };

  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-slate-500">
        Nenhuma sessão registrada ainda
      </div>
    );
  }

  const fmtVal = (v: number) => (unit === 'kg' ? fmtKg(v) : `${v} reps`);
  const path = points.map((_, i) => `${i === 0 ? 'M' : 'L'} ${geo.x(i).toFixed(1)} ${geo.y(values[i]).toFixed(1)}`).join(' ');
  const last = geo.n - 1;
  const hp = hover != null ? points[hover] : null;

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block overflow-visible"
          onMouseMove={e => pick(e.clientX)}
          onMouseLeave={() => setHover(null)}
          onTouchStart={e => pick(e.touches[0].clientX)}
          onTouchMove={e => pick(e.touches[0].clientX)}
          onTouchEnd={() => setHover(null)}
        >
          {/* grade recessiva + rótulos do eixo y */}
          {geo.ticks.map(t => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geo.y(t)} y2={geo.y(t)} stroke="rgba(255,255,255,0.06)" />
              <text x={PAD.left - 8} y={geo.y(t) + 3.5} textAnchor="end" fontSize={10} fill="#64748b">{t}</text>
            </g>
          ))}

          {/* rótulos de data */}
          {points.map((p, i) => geo.labelIdx.has(i) && (
            <text
              key={p.sessionId}
              x={geo.x(i)}
              y={HEIGHT - 8}
              textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'}
              fontSize={10}
              fill="#64748b"
            >
              {fmtDatePt(p.date)}
            </text>
          ))}

          {/* crosshair */}
          {hover != null && (
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top - 6} y2={HEIGHT - PAD.bottom} stroke="rgba(148,163,184,0.35)" strokeDasharray="3 3" />
          )}

          {/* linha */}
          <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* marcadores — o do PR ganha anel */}
          {points.map((p, i) => {
            const cx = geo.x(i), cy = geo.y(values[i]);
            const isPR = i === prIdx;
            const isHov = i === hover;
            return (
              <g key={p.sessionId}>
                {isPR && <circle cx={cx} cy={cy} r={8} fill="none" stroke={PR} strokeWidth={1.5} />}
                <circle
                  cx={cx} cy={cy}
                  r={isHov ? 5.5 : 4}
                  fill={isPR ? PR : SURFACE}
                  stroke={isPR ? SURFACE : SERIES}
                  strokeWidth={2}
                />
              </g>
            );
          })}

          {/* rótulo direto: só o último ponto (e o PR, se não for o último) */}
          <text x={geo.x(last)} y={geo.y(values[last]) - 11} textAnchor={geo.n === 1 ? 'middle' : 'end'} fontSize={11} fontWeight={600} fill="#f8fafc">
            {fmtVal(values[last])}
          </text>
          {prIdx >= 0 && prIdx !== last && (
            <text x={geo.x(prIdx)} y={geo.y(values[prIdx]) - 13} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fbbf24" letterSpacing={1}>PR</text>
          )}
        </svg>
      )}

      {/* tooltip */}
      {hp && hover != null && width > 0 && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-44 rounded-xl border border-white/10 bg-slate-900/95 p-2.5 text-xs shadow-xl backdrop-blur"
          style={{ left: Math.max(88, Math.min(width - 88, geo.x(hover))), transform: 'translateX(-50%)' }}
        >
          <p className="text-[10px] uppercase tracking-widest text-slate-500">{fmtDatePt(hp.date, true)} · {hp.templateName}</p>
          <p className="mt-1 text-sm font-semibold text-white">
            {fmtVal(values[hover])}{unit === 'kg' && hp.reps ? <span className="font-normal text-slate-400"> × {hp.reps}</span> : null}
          </p>
          {unit === 'kg' && hp.e1rm > 0 && <p className="text-slate-400">1RM ≈ {fmtKg(Math.round(hp.e1rm))}</p>}
          <p className="mt-1 text-[11px] text-slate-500">{fmtGroups(hp.performed)}</p>
        </div>
      )}
    </div>
  );
}
