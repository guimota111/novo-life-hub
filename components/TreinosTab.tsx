'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import ExerciseCatalog from '@/components/ExerciseCatalog';
import WorkoutImport from '@/components/WorkoutImport';
import WorkoutLogForm from '@/components/WorkoutLogForm';
import {
  fmtDatePt, fmtGroups, fmtKg, loadWorkoutData, prEvents, updateExerciseGroup,
  type MuscleGroup, type WorkoutData, type WorkoutSessionDoc,
} from '@/lib/workouts';
import {
  Activity, ChevronDown, ChevronUp, Dumbbell, FileDown, Loader2, PenLine, Smartphone, Trophy, Upload,
} from 'lucide-react';

// Aba "Treinos" da página de exercícios: resumo, registro manual, catálogo e importação.

type View = 'resumo' | 'registrar' | 'exercicios' | 'importar';

const VIEWS: { id: View; label: string; Icon: typeof Activity }[] = [
  { id: 'resumo',     label: 'Resumo',     Icon: Activity },
  { id: 'registrar',  label: 'Registrar',  Icon: PenLine },
  { id: 'exercicios', label: 'Exercícios', Icon: Dumbbell },
  { id: 'importar',   label: 'Importar',   Icon: Upload },
];

const EMPTY: WorkoutData = { templates: [], exercises: [], sessions: [] };

const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const completionCls = (c: number) =>
  c >= 0.9 ? 'bg-emerald-500/15 text-emerald-300' : c >= 0.7 ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300';

interface Props {
  // dias que passaram a ter treino — a aba Academia atualiza o calendário
  onGymDaysChanged?: (dates: string[]) => void;
}

export default function TreinosTab({ onGymDaysChanged }: Props) {
  const { user } = useAuth();
  const [view, setView] = useState<View>('resumo');
  const [data, setData] = useState<WorkoutData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(15);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    setData(await loadWorkoutData(db, user.uid));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [user, reload]);

  const onImported = async (dates: string[]) => { await reload(); onGymDaysChanged?.(dates); setView('resumo'); };
  const onSaved = async (s: WorkoutSessionDoc) => { await reload(); onGymDaysChanged?.([s.date]); };
  const onGroupChange = async (key: string, group: MuscleGroup) => {
    if (!user) return;
    setData(d => ({ ...d, exercises: d.exercises.map(e => e.key === key ? { ...e, muscleGroup: group } : e) }));
    await updateExerciseGroup(db, user.uid, key, group);
  };

  // ── Resumo ────────────────────────────────────────────────────────────────
  const nameOf = useMemo(() => new Map(data.exercises.map(e => [e.key, e.name])), [data.exercises]);
  const summary = useMemo(() => {
    const mk = monthKeyOf(new Date());
    const inMonth = data.sessions.filter(s => s.date.startsWith(mk));
    const avg = inMonth.length ? inMonth.reduce((a, s) => a + s.completion, 0) / inMonth.length : 0;
    const events = prEvents(data.sessions);
    const prsMonth = events.filter(e => e.date.startsWith(mk)).length;
    const last = data.sessions[0] ?? null;   // já vem em ordem decrescente
    return { inMonth: inMonth.length, avg, prsMonth, last, events: events.slice(0, 6) };
  }, [data.sessions]);

  const empty = !loading && data.sessions.length === 0 && data.templates.length === 0;

  return (
    <div className="space-y-4">
      {/* sub-navegação */}
      <div className="flex gap-1 overflow-x-auto rounded-3xl border border-white/10 bg-white/5 p-1.5 backdrop-blur-xl">
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-2xl px-3 py-2 text-xs font-medium transition sm:text-sm
              ${view === v.id ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'}`}
          >
            <v.Icon size={14} /> {v.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 size={24} className="animate-spin text-tamagochi-400" />
        </div>
      ) : view === 'registrar' ? (
        <WorkoutLogForm data={data} onSaved={onSaved} onDataChanged={reload} />
      ) : view === 'exercicios' ? (
        <ExerciseCatalog data={data} onGroupChange={onGroupChange} />
      ) : view === 'importar' ? (
        <WorkoutImport existing={data} onImported={onImported} />
      ) : empty ? (
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 text-center backdrop-blur-xl sm:p-10">
          <Smartphone size={32} className="mx-auto mb-3 text-tamagochi-400" />
          <p className="text-lg font-semibold text-white">Nenhum treino ainda</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">
            Exporte seus treinos no SmartGym (o email com FICHAS e HISTÓRICO) e importe aqui. As fichas, o histórico
            inteiro e os recordes entram de uma vez.
          </p>
          <button onClick={() => setView('importar')} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-tamagochi-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-tamagochi-400">
            <FileDown size={15} /> Importar exportação
          </button>
        </div>
      ) : (
        <>
          {/* tiles do mês */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
            {[
              { label: 'Treinos no mês',    value: String(summary.inMonth),                                      Icon: Dumbbell, color: 'text-rose-400' },
              { label: 'Conclusão média',   value: summary.inMonth ? `${Math.round(summary.avg * 100)}%` : '—',  Icon: Activity, color: 'text-emerald-400' },
              { label: 'Recordes no mês',   value: String(summary.prsMonth),                                     Icon: Trophy,   color: 'text-amber-400' },
              { label: 'Último treino',     value: summary.last ? fmtDatePt(summary.last.date) : '—',            Icon: PenLine,  color: 'text-sky-400', hint: summary.last?.templateName },
            ].map(t => (
              <div key={t.label} className="rounded-3xl border border-white/10 bg-white/5 p-3 text-center backdrop-blur-xl sm:rounded-[2rem] sm:p-5">
                <t.Icon size={20} className={`mx-auto mb-2 ${t.color}`} />
                <p className="text-base font-bold text-white sm:text-xl">{t.value}</p>
                <p className="mt-0.5 truncate text-[11px] leading-tight text-slate-500 sm:text-xs">{t.hint ?? t.label}</p>
              </div>
            ))}
          </div>

          {/* recordes recentes */}
          {summary.events.length > 0 && (
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
              <p className="mb-3 text-sm uppercase tracking-widest text-tamagochi-300">Recordes recentes</p>
              <div className="space-y-1.5">
                {summary.events.map(e => (
                  <div key={`${e.date}-${e.key}`} className="flex items-center gap-3 text-sm">
                    <Trophy size={14} className="shrink-0 text-amber-400" />
                    <span className="min-w-0 flex-1 truncate text-slate-200">{nameOf.get(e.key) ?? e.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{fmtKg(e.prev)} →</span>
                    <span className="shrink-0 font-semibold text-white">{fmtKg(e.weight)}</span>
                    <span className="shrink-0 text-xs text-slate-500">{fmtDatePt(e.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* sessões */}
          <div className="space-y-2">
            <p className="px-2 text-sm uppercase tracking-widest text-tamagochi-300">Sessões</p>
            {data.sessions.slice(0, limit).map(s => {
              const open = openId === s.id;
              const skipped = s.exercises.filter(e => e.performed.length === 0).length;
              return (
                <div key={s.id} className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
                  <button onClick={() => setOpenId(open ? null : s.id)} className="flex w-full items-center gap-3 p-3 text-left sm:p-4">
                    <div className="w-14 shrink-0 text-center">
                      <p className="text-base font-bold leading-none text-white">{s.date.slice(8)}</p>
                      <p className="text-[10px] uppercase text-slate-500">{fmtDatePt(s.date).split(' ')[1]} {s.date.slice(2, 4)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-white">{s.templateName}</p>
                      <p className="text-[11px] text-slate-500">
                        {s.setsDone}/{s.setsPrescribed} séries{skipped ? ` · ${skipped} ${skipped === 1 ? 'pulado' : 'pulados'}` : ''}
                        {s.source === 'manual' ? ' · à mão' : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${completionCls(s.completion)}`}>
                      {Math.round(s.completion * 100)}%
                    </span>
                    {open ? <ChevronUp size={16} className="shrink-0 text-slate-500" /> : <ChevronDown size={16} className="shrink-0 text-slate-500" />}
                  </button>
                  {open && (
                    <div className="space-y-1 border-t border-white/10 p-3 sm:p-4">
                      {s.exercises.map(e => (
                        <div key={e.key} className="flex items-baseline justify-between gap-3 text-xs">
                          <span className={`min-w-0 flex-1 truncate ${e.performed.length ? 'text-slate-200' : 'text-slate-600 line-through'}`}>{e.name}</span>
                          <span className={`shrink-0 ${e.performed.length ? 'text-white' : 'text-slate-600'}`}>
                            {e.performed.length ? fmtGroups(e.performed) : 'pulado'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {data.sessions.length > limit && (
              <button onClick={() => setLimit(l => l + 30)} className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 text-sm text-slate-400 transition hover:text-white">
                Mostrar mais ({data.sessions.length - limit} restantes)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
