'use client';

import { useMemo, useState } from 'react';
import ExerciseProgressChart from '@/components/ExerciseProgressChart';
import {
  computePRs, exerciseHistory, fmtDatePt, fmtGroups, fmtKg, muscleGroupMeta, MUSCLE_GROUPS,
  type ExerciseDoc, type MuscleGroup, type WorkoutData,
} from '@/lib/workouts';
import { ChevronDown, ChevronUp, Search, Trophy } from 'lucide-react';

// Catálogo de exercícios: filtro por grupo, busca, grupo muscular editável, e o
// detalhe com gráfico de progressão + PR + 1RM estimado.

interface Props {
  data: WorkoutData;
  onGroupChange: (key: string, group: MuscleGroup) => void | Promise<void>;
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function ExerciseCatalog({ data, onGroupChange }: Props) {
  const [group, setGroup] = useState<MuscleGroup | 'todos'>('todos');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const prs = useMemo(() => computePRs(data.sessions), [data.sessions]);

  const rows = useMemo(() => {
    const q = norm(search.trim());
    return [...data.exercises]
      .filter(e => group === 'todos' || e.muscleGroup === group)
      .filter(e => !q || norm(e.name).includes(q))
      .sort((a, b) => {
        const la = prs.get(a.key)?.lastDate ?? '';
        const lb = prs.get(b.key)?.lastDate ?? '';
        return lb.localeCompare(la) || a.name.localeCompare(b.name);
      });
  }, [data.exercises, group, search, prs]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data.exercises) m.set(e.muscleGroup, (m.get(e.muscleGroup) ?? 0) + 1);
    return m;
  }, [data.exercises]);

  return (
    <div className="space-y-4">
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:p-5">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar exercício"
            className="w-full rounded-xl border border-white/10 bg-slate-950/60 py-2 pl-9 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-tamagochi-400 focus:outline-none"
          />
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setGroup('todos')}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${group === 'todos' ? 'border-tamagochi-500/40 bg-tamagochi-500/15 text-tamagochi-200' : 'border-white/10 bg-slate-900/60 text-slate-400 hover:text-white'}`}
          >
            Todos · {data.exercises.length}
          </button>
          {MUSCLE_GROUPS.map(g => (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${group === g.id ? g.chip : 'border-white/10 bg-slate-900/60 text-slate-400 hover:text-white'}`}
            >
              {g.label} · {counts.get(g.id) ?? 0}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-2 text-sm text-slate-500">
          {data.exercises.length === 0 ? 'Nenhum exercício ainda — importe uma exportação do SmartGym.' : 'Nada com esse filtro.'}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map(e => {
            const pr = prs.get(e.key);
            const open = selected === e.key;
            return (
              <div key={e.key} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
                <div className="flex items-center gap-2 p-3 sm:p-4">
                  <button onClick={() => setSelected(open ? null : e.key)} className="min-w-0 flex-1 text-left">
                    <p className="truncate font-medium text-white">{e.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {pr
                        ? <>{pr.sessions} {pr.sessions === 1 ? 'sessão' : 'sessões'} · última {fmtDatePt(pr.lastDate)}{pr.weight > 0 && <> · recorde <span className="text-slate-300">{fmtKg(pr.weight)} × {pr.reps}</span></>}</>
                        : 'só na ficha, nunca registrado'}
                    </p>
                  </button>
                  <GroupSelect value={e.muscleGroup} onChange={g => onGroupChange(e.key, g)} />
                  <button onClick={() => setSelected(open ? null : e.key)} className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-white">
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </div>
                {open && <ExerciseDetail exercise={e} data={data} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupSelect({ value, onChange }: { value: MuscleGroup; onChange: (g: MuscleGroup) => void }) {
  const meta = muscleGroupMeta(value);
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as MuscleGroup)}
      title="Grupo muscular"
      className={`shrink-0 cursor-pointer appearance-none rounded-full border px-2.5 py-1 text-[11px] focus:outline-none ${meta.chip}`}
    >
      {MUSCLE_GROUPS.map(g => <option key={g.id} value={g.id} className="bg-slate-900 text-white">{g.label}</option>)}
    </select>
  );
}

function ExerciseDetail({ exercise, data }: { exercise: ExerciseDoc; data: WorkoutData }) {
  const history = useMemo(() => exerciseHistory(data.sessions, exercise.key), [data.sessions, exercise.key]);
  const pr = useMemo(() => computePRs(data.sessions).get(exercise.key), [data.sessions, exercise.key]);
  const hasLoad = history.some(p => p.weight > 0);
  const unit: 'kg' | 'reps' = hasLoad ? 'kg' : 'reps';
  const last = history[history.length - 1];
  const recent = [...history].reverse().slice(0, 6);

  return (
    <div className="border-t border-white/10 p-3 sm:p-4">
      {history.length > 0 && pr && (
        <div className="mb-4 grid grid-cols-3 gap-2">
          <Tile label="Recorde" value={hasLoad ? `${fmtKg(pr.weight)} × ${pr.reps}` : `${Math.max(...history.map(p => p.reps))} reps`} hint={hasLoad ? fmtDatePt(pr.date, true) : ''} accent />
          <Tile label="1RM estimado" value={hasLoad && pr.e1rm > 0 ? fmtKg(Math.round(pr.e1rm)) : '—'} hint={hasLoad && pr.e1rm > 0 ? `Epley · ${fmtDatePt(pr.e1rmDate)}` : ''} />
          <Tile label="Último" value={last ? (hasLoad ? `${fmtKg(last.weight)} × ${last.reps}` : `${last.reps} reps`) : '—'} hint={last ? fmtDatePt(last.date, true) : ''} />
        </div>
      )}

      <ExerciseProgressChart points={history} unit={unit} prDate={hasLoad ? pr?.date : undefined} />

      {recent.length > 0 && (
        <div className="mt-4 space-y-1">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Últimas sessões</p>
          {recent.map(p => (
            <div key={p.sessionId} className="flex items-baseline justify-between gap-3 rounded-xl bg-slate-900/40 px-3 py-1.5 text-xs">
              <span className="shrink-0 text-slate-400">{fmtDatePt(p.date, true)}</span>
              <span className="min-w-0 flex-1 truncate text-slate-500">{p.templateName}</span>
              <span className="shrink-0 text-slate-200">{fmtGroups(p.performed)}</span>
              {pr && p.date === pr.date && hasLoad && <Trophy size={12} className="shrink-0 text-amber-400" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 text-center ${accent ? 'border-amber-500/25 bg-amber-500/10' : 'border-white/10 bg-slate-900/50'}`}>
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white sm:text-base">{value}</p>
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}
