'use client';

import { useMemo, type ReactNode } from 'react';

const DAY_LETTERS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']; // Seg..Dom
const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function dateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface HeatmapCell {
  colorClass: string;
  tooltip?: ReactNode;
}

interface CalendarHeatmapProps {
  start: Date;
  end: Date;
  today: string; // YYYY-MM-DD — dias depois disso não são renderizados
  getCell: (dateKey: string) => HeatmapCell | null;
  emptyClass?: string;
}

// Meses inteiros (<=~6 semanas) viram um calendário tradicional (semanas em
// linha); períodos maiores viram um grid estilo "contribution graph" (semanas
// em coluna), que escala melhor pra trimestre/ano/tudo.
export default function CalendarHeatmap({
  start, end, today, getCell, emptyClass = 'bg-slate-900/40',
}: CalendarHeatmapProps) {
  const gridStart = useMemo(() => {
    const d = new Date(start);
    const dow = (d.getDay() + 6) % 7; // 0 = segunda
    d.setDate(d.getDate() - dow);
    return d;
  }, [start]);

  const gridEnd = useMemo(() => {
    const d = new Date(end);
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() + (6 - dow));
    return d;
  }, [end]);

  const gridDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / 86_400_000) + 1;
  const weeks = gridDays / 7;

  const columns = useMemo(() => {
    const cols: { date: Date; key: string }[][] = [];
    for (let w = 0; w < weeks; w++) {
      const col: { date: Date; key: string }[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(gridStart);
        date.setDate(gridStart.getDate() + w * 7 + d);
        col.push({ date, key: dateStr(date) });
      }
      cols.push(col);
    }
    return cols;
  }, [gridStart, weeks]);

  const CELL = 13;
  const GAP = 3;
  const isMonthGrid = weeks <= 6;

  // Rótulos de mês pro modo "contribution graph" — calculado sempre (não só
  // quando usado) pra manter a ordem dos hooks estável entre renders.
  const monthLabels = useMemo(() => {
    const labels: { colIndex: number; label: string }[] = [];
    let lastMonth = -1;
    columns.forEach((col, i) => {
      const month = col[0].date.getMonth();
      const hasNewMonth = col.some(c => c.date.getDate() === 1);
      if ((hasNewMonth || i === 0) && month !== lastMonth) {
        labels.push({ colIndex: i, label: MONTHS_SHORT[month] });
        lastMonth = month;
      }
    });
    return labels;
  }, [columns]);

  const renderCell = (key: string, date: Date) => {
    const inRange = date >= start && date <= end && key <= today;
    const cell = inRange ? getCell(key) : null;
    const cls = cell ? cell.colorClass : inRange ? emptyClass : 'bg-transparent';
    return (
      <div key={key} className="group/cell relative">
        <div className={`rounded-[3px] ${cls}`} style={{ width: CELL, height: CELL }} />
        {cell?.tooltip && (
          <div
            className="pointer-events-none absolute z-30 opacity-0 transition-opacity group-hover/cell:opacity-100 group-hover/cell:pointer-events-auto"
            style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 }}
          >
            <div className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 shadow-xl" style={{ minWidth: 120 }}>
              {cell.tooltip}
            </div>
            <div className="mx-auto h-1.5 w-1.5 -translate-y-px rotate-45 border-b border-r border-white/10 bg-slate-800" />
          </div>
        )}
      </div>
    );
  };

  if (isMonthGrid) {
    // Calendário tradicional: semanas em linha, dias da semana no topo.
    return (
      <div>
        <div className="mb-1 grid grid-cols-7 gap-[3px]">
          {DAY_LETTERS.map((d, i) => (
            <div key={i} className="text-center text-[9px] text-slate-600">{d}</div>
          ))}
        </div>
        <div className="space-y-[3px]">
          {Array.from({ length: 7 }, (_, row) => (
            <div key={row} className="grid grid-cols-7 gap-[3px]">
              {columns.map(col => {
                const { date, key } = col[row];
                return renderCell(key, date);
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Contribution graph: semanas em coluna, rótulos de mês no topo.
  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: weeks * (CELL + GAP) + 28 }}>
        <div className="relative mb-1 ml-7" style={{ height: 12 }}>
          {monthLabels.map((m, i) => (
            <span key={i} className="absolute text-[9px] text-slate-500" style={{ left: m.colIndex * (CELL + GAP) }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="flex gap-[3px]">
          <div className="flex flex-col gap-[3px]" style={{ width: 20 }}>
            {DAY_LETTERS.map((d, i) => (
              <span key={i} className="text-[8px] text-slate-600" style={{ height: CELL, lineHeight: `${CELL}px` }}>
                {i % 2 === 0 ? d : ''}
              </span>
            ))}
          </div>
          {columns.map((col, ci) => (
            <div key={ci} className="flex flex-col gap-[3px]">
              {col.map(({ date, key }) => renderCell(key, date))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
