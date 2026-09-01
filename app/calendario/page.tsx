'use client';

import { useState, useEffect, useMemo } from 'react';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import {
  Calendar, ChevronLeft, ChevronRight, Flame,
  Droplet, Footprints, BookOpen, Dumbbell, Pill, GraduationCap, Wind,
  Pencil, X, Check, Loader2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DailyData {
  water_ml: number; steps: number; reading_pages: number;
  gym_done: boolean; creatine_done: boolean;
  study_minutes: number; meditation_minutes: number;
}
interface Goals {
  water_ml: number; steps: number; reading_pages: number;
  gym_days_per_week: number; study_minutes: number; meditation_minutes: number;
}

const DEFAULT_GOALS: Goals = {
  water_ml: 4000, steps: 10000, reading_pages: 10,
  gym_days_per_week: 5, study_minutes: 120, meditation_minutes: 10,
};
const emptyDay = (): DailyData => ({
  water_ml: 0, steps: 0, reading_pages: 0,
  gym_done: false, creatine_done: false, study_minutes: 0, meditation_minutes: 0,
});

// ── Habits ────────────────────────────────────────────────────────────────────

const HABITS = [
  { key: 'water',      label: 'Água',       icon: Droplet,       textColor: 'text-blue-400',   cellDone: 'bg-blue-400',   cellMiss: 'bg-blue-400/10',  iconBg: 'bg-blue-400/15',   done: (d: DailyData, g: Goals) => d.water_ml >= g.water_ml },
  { key: 'steps',      label: 'Passos',     icon: Footprints,    textColor: 'text-emerald-400', cellDone: 'bg-emerald-400', cellMiss: 'bg-emerald-400/10', iconBg: 'bg-emerald-400/15', done: (d: DailyData, g: Goals) => d.steps >= g.steps },
  { key: 'reading',    label: 'Leitura',    icon: BookOpen,      textColor: 'text-amber-400',   cellDone: 'bg-amber-400',   cellMiss: 'bg-amber-400/10',  iconBg: 'bg-amber-400/15',   done: (d: DailyData, g: Goals) => d.reading_pages >= g.reading_pages },
  { key: 'gym',        label: 'Academia',   icon: Dumbbell,      textColor: 'text-rose-400',    cellDone: 'bg-rose-400',    cellMiss: 'bg-rose-400/10',   iconBg: 'bg-rose-400/15',    done: (d: DailyData, g: Goals) => d.gym_done },
  { key: 'creatine',   label: 'Creatina',   icon: Pill,          textColor: 'text-purple-400',  cellDone: 'bg-purple-400',  cellMiss: 'bg-purple-400/10', iconBg: 'bg-purple-400/15',  done: (d: DailyData, g: Goals) => d.creatine_done },
  { key: 'study',      label: 'Estudo',     icon: GraduationCap, textColor: 'text-violet-400',  cellDone: 'bg-violet-400',  cellMiss: 'bg-violet-400/10', iconBg: 'bg-violet-400/15',  done: (d: DailyData, g: Goals) => d.study_minutes >= g.study_minutes },
  { key: 'meditation', label: 'Meditação',  icon: Wind,          textColor: 'text-teal-400',    cellDone: 'bg-teal-400',    cellMiss: 'bg-teal-400/10',   iconBg: 'bg-teal-400/15',    done: (d: DailyData, g: Goals) => d.meditation_minutes >= g.meditation_minutes },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MONTHS_FULL  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const todayKey = () => toKey(new Date());

function pct(v: number, g: number) { return g > 0 ? Math.min((v / g) * 100, 100) : 0; }

function calcScore(d: DailyData, g: Goals) {
  return Math.round(
    (pct(d.water_ml, g.water_ml) + pct(d.steps, g.steps) + pct(d.reading_pages, g.reading_pages) +
      (d.gym_done ? 100 : 0) + (d.creatine_done ? 100 : 0) +
      pct(d.study_minutes, g.study_minutes) + pct(d.meditation_minutes, g.meditation_minutes)) / 7
  );
}

// ── Day-of-week short labels (Mon-first) ─────────────────────────────────────
const DOW_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function CalendarioPage() {
  const { user } = useAuth();
  const [logs, setLogs]   = useState<Record<string, DailyData>>({});
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const [viewYear, setViewYear]   = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [editMode, setEditMode]     = useState(false);
  const [editValues, setEditValues] = useState<DailyData>(emptyDay());
  const [saving, setSaving]         = useState(false);

  const today = useMemo(() => todayKey(), []);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const [logsSnap, goalsSnap] = await Promise.all([
        getDocs(collection(db, 'users', user.uid, 'daily_logs')),
        getDoc(doc(db, 'users', user.uid, 'settings', 'goals')),
      ]);
      const data: Record<string, DailyData> = {};
      logsSnap.forEach(d => { data[d.id] = { ...emptyDay(), ...(d.data() as Partial<DailyData>) }; });
      setLogs(data);
      if (goalsSnap.exists()) setGoals({ ...DEFAULT_GOALS, ...(goalsSnap.data() as Partial<Goals>) });
      setLoading(false);
    };
    load();
  }, [user]);

  // Reset edit mode whenever a different day is selected
  useEffect(() => {
    setEditMode(false);
    setEditValues(selectedDay ? (logs[selectedDay] ?? emptyDay()) : emptyDay());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay]);

  const startEdit = () => {
    setEditValues(logs[selectedDay!] ?? emptyDay());
    setEditMode(true);
  };

  const cancelEdit = () => setEditMode(false);

  const saveEdit = async () => {
    if (!user || !selectedDay) return;
    setSaving(true);
    try {
      const payload = { ...editValues, updatedAt: new Date() };
      await setDoc(doc(db, 'users', user.uid, 'daily_logs', selectedDay), payload, { merge: true });
      setLogs(prev => ({ ...prev, [selectedDay]: editValues }));
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  // ── Year grid: array of weeks, each week = 7 days (Mon–Sun) ──────────────
  const yearWeeks = useMemo(() => {
    const jan1 = new Date(viewYear, 0, 1);
    const dow   = jan1.getDay();
    const toMonday = dow === 0 ? 6 : dow - 1;

    const dec31    = new Date(viewYear, 11, 31);
    const dec31Dow = dec31.getDay();
    const toSunday = dec31Dow === 0 ? 0 : 7 - dec31Dow;

    const start = new Date(viewYear, 0, 1 - toMonday);
    const end   = new Date(viewYear, 11, 31 + toSunday);

    type Cell = { key: string; isPast: boolean; isToday: boolean } | null;
    const weeks: Cell[][] = [];
    const cursor = new Date(start);

    while (cursor <= end) {
      const week: Cell[] = [];
      for (let d = 0; d < 7; d++) {
        if (cursor.getFullYear() !== viewYear) {
          week.push(null);
        } else {
          const k = toKey(cursor);
          week.push({ key: k, isPast: k <= today, isToday: k === today });
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  }, [viewYear, today]);

  // Month label for each week column (first day-of-month in that week)
  const monthLabels = useMemo(
    () => yearWeeks.map(week =>
      week.find(c => c && new Date(c.key + 'T12:00:00').getDate() === 1)
        ? MONTHS_SHORT[new Date(week.find(c => c?.key)!.key + 'T12:00:00').getMonth()]
        : null
    ),
    [yearWeeks]
  );

  // Per-habit year completion %
  const yearStats = useMemo(() => {
    const pastKeys = yearWeeks.flat().filter(c => c?.isPast).map(c => c!.key);
    if (!pastKeys.length) return HABITS.map(() => 0);
    return HABITS.map(h =>
      Math.round(pastKeys.filter(k => h.done(logs[k] ?? emptyDay(), goals)).length / pastKeys.length * 100)
    );
  }, [yearWeeks, logs, goals]);

  // Per-habit streaks
  const streaks = useMemo(() => {
    const calcStreak = (done: (d: DailyData) => boolean) => {
      const cursor = new Date(today + 'T12:00:00');
      if (!done(logs[today] ?? emptyDay())) cursor.setDate(cursor.getDate() - 1);
      let count = 0;
      for (let i = 0; i < 365; i++) {
        const k = toKey(cursor);
        if (done(logs[k] ?? emptyDay())) { count++; cursor.setDate(cursor.getDate() - 1); }
        else break;
      }
      return count;
    };
    return HABITS.map(h => calcStreak(d => h.done(d, goals)));
  }, [logs, goals, today]);

  const selectedData  = selectedDay ? (logs[selectedDay] ?? null) : null;
  const selectedScore = selectedData ? calcScore(selectedData, goals) : null;
  const selectedDate  = selectedDay
    ? new Date(selectedDay + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />

        <section className="min-w-0 flex-1 space-y-6">

          {/* Header */}
          <header className="flex flex-col items-start justify-between gap-4 rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl sm:flex-row sm:items-center sm:p-8">
            <div>
              <div className="flex items-center gap-3">
                <Calendar className="shrink-0 text-tamagochi-300" size={28} />
                <h1 className="text-2xl font-semibold text-white sm:text-3xl">Calendário</h1>
              </div>
              <p className="mt-2 text-slate-400">Todos os hábitos, o ano inteiro.</p>
            </div>
            <div className="flex items-center gap-2 rounded-3xl border border-white/10 bg-white/5 px-3 py-2">
              <button onClick={() => setViewYear(y => y - 1)} className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white">
                <ChevronLeft size={18} />
              </button>
              <span className="w-16 text-center text-lg font-semibold text-white">{viewYear}</span>
              <button
                onClick={() => setViewYear(y => y + 1)}
                disabled={viewYear >= now.getFullYear()}
                className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white disabled:cursor-default disabled:opacity-30"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </header>

          <div className="grid gap-6 xl:grid-cols-[1fr_288px]">

            {/* Heatmap card */}
            <div className="min-w-0 rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur-xl sm:p-6">

              {loading ? (
                <div className="space-y-4">
                  {HABITS.map(h => (
                    <div key={h.key} className="flex items-center gap-4">
                      <div className="h-5 w-20 animate-pulse rounded-lg bg-slate-800" />
                      <div className="h-5 flex-1 animate-pulse rounded-lg bg-slate-800" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="-mx-1 overflow-x-auto px-1">
                  <p className="mb-2 text-[11px] text-slate-500 sm:hidden">deslize para o lado →</p>
                  <div className="min-w-max">

                    {/* Month labels row */}
                    <div className="mb-2 flex">
                      <div className="sticky left-0 z-10 w-24 shrink-0 bg-[#141c25] sm:w-28" />
                      <div className="flex gap-[3px]">
                        {yearWeeks.map((_, wi) => (
                          <div key={wi} className="w-2.5 shrink-0 text-[9px] leading-none text-slate-600">
                            {monthLabels[wi] ?? ''}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Day-of-week row (Seg / Qua / Sex only, on the right of first habit) */}
                    {/* Embedded in habit rows below */}

                    {/* Habit rows */}
                    <div className="space-y-1">
                      {HABITS.map((h, hi) => {
                        const Icon = h.icon;
                        return (
                          <div key={h.key} className="flex items-center gap-3">

                            {/* Habit label — fica fixo à esquerda enquanto o heatmap rola no celular */}
                            <div className="sticky left-0 z-10 flex w-24 shrink-0 items-center gap-2 bg-[#141c25] sm:w-28">
                              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${h.iconBg}`}>
                                <Icon size={12} className={h.textColor} />
                              </div>
                              <span className="truncate text-xs font-medium text-slate-400">{h.label}</span>
                            </div>

                            {/* Week columns */}
                            <div className="flex gap-[3px]">
                              {yearWeeks.map((week, wi) => (
                                <div key={wi} className="flex flex-col gap-[3px]">
                                  {week.map((cell, di) => {
                                    if (!cell) {
                                      return <div key={di} className="h-2.5 w-2.5" />;
                                    }
                                    const data = logs[cell.key];
                                    const done = data ? h.done(data, goals) : false;
                                    const isFuture = !cell.isPast;
                                    const isSelected = cell.key === selectedDay;

                                    return (
                                      <button
                                        key={di}
                                        title={`${cell.key}${data ? ` · ${done ? '✓' : '✗'} ${h.label}` : ''}`}
                                        onClick={() => cell.isPast && setSelectedDay(isSelected ? null : cell.key)}
                                        disabled={isFuture}
                                        className={[
                                          'h-2.5 w-2.5 rounded-sm transition-all',
                                          isSelected ? 'ring-1 ring-white/60 ring-offset-1 ring-offset-[#08101a]' : '',
                                          cell.isToday ? 'ring-1 ring-white/30 ring-offset-1 ring-offset-[#08101a]' : '',
                                          isFuture
                                            ? 'bg-slate-900/30 cursor-default'
                                            : done
                                            ? `${h.cellDone} hover:brightness-125`
                                            : `${h.cellMiss} hover:brightness-150`,
                                        ].join(' ')}
                                      />
                                    );
                                  })}
                                </div>
                              ))}
                            </div>

                            {/* Year % */}
                            <span className={`w-10 shrink-0 text-right text-xs font-semibold ${h.textColor}`}>
                              {yearStats[hi]}%
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Day labels below (Mon / Wed / Fri) */}
                    <div className="mt-2 flex">
                      <div className="sticky left-0 z-10 w-24 shrink-0 bg-[#141c25] sm:w-28" />
                      <div className="flex gap-[3px]">
                        {yearWeeks.map((_, wi) => (
                          <div key={wi} className="flex w-2.5 flex-col gap-[3px]">
                            {[0,1,2,3,4,5,6].map(di => (
                              <div key={di} className="h-2.5 w-2.5 text-center text-[7px] leading-[10px] text-slate-700">
                                {wi === 0 && (di === 0 || di === 2 || di === 4) ? DOW_LABELS[di].charAt(0) : ''}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-white/5 pt-4">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm bg-slate-700/40" />
                  <span className="text-[10px] text-slate-600">Não feito</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />
                  <span className="text-[10px] text-slate-600">Feito</span>
                </div>
                <div className="ml-auto text-[10px] text-slate-600">
                  Clique num quadradinho para ver os detalhes do dia
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <aside className="space-y-4">

              {/* Selected day detail / edit */}
              {selectedDay ? (
                <div className="rounded-[2rem] border border-tamagochi-400/25 bg-tamagochi-500/5 p-5 backdrop-blur-xl">

                  {/* Header row */}
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <p className="text-[10px] uppercase tracking-widest text-tamagochi-300 capitalize leading-relaxed">
                      {selectedDate}
                    </p>
                    {!editMode ? (
                      <button
                        onClick={startEdit}
                        className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-400 transition hover:border-tamagochi-400/40 hover:text-white"
                      >
                        <Pencil size={11} />
                        Editar
                      </button>
                    ) : (
                      <button
                        onClick={cancelEdit}
                        className="flex shrink-0 items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-500 transition hover:text-white"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  {/* Read-only view */}
                  {!editMode && (
                    <>
                      {selectedData ? (
                        <>
                          <p className={`mb-4 text-2xl font-bold ${selectedScore! >= 80 ? 'text-emerald-400' : selectedScore! >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>
                            {selectedScore}% do dia
                          </p>
                          <div className="space-y-2.5">
                            {HABITS.map(h => {
                              const Icon = h.icon;
                              const done = h.done(selectedData, goals);
                              const rawVal = (() => {
                                if (h.key === 'water')      return `${selectedData.water_ml} ml`;
                                if (h.key === 'steps')      return selectedData.steps.toLocaleString('pt-BR');
                                if (h.key === 'reading')    return `${selectedData.reading_pages} pág`;
                                if (h.key === 'study')      return `${selectedData.study_minutes} min`;
                                if (h.key === 'meditation') return `${selectedData.meditation_minutes} min`;
                                return null;
                              })();
                              return (
                                <div key={h.key} className="flex items-center gap-2.5">
                                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${done ? h.iconBg : 'bg-white/5'}`}>
                                    <Icon size={13} className={done ? h.textColor : 'text-slate-700'} />
                                  </div>
                                  <span className={`flex-1 text-sm ${done ? 'text-slate-200' : 'text-slate-600'}`}>{h.label}</span>
                                  {rawVal
                                    ? <span className={`text-xs tabular-nums ${done ? h.textColor : 'text-slate-600'}`}>{rawVal}</span>
                                    : done
                                      ? <Check size={13} className="text-emerald-400" />
                                      : <span className="text-xs text-slate-700">—</span>
                                  }
                                </div>
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <p className="mt-1 text-sm text-slate-500">Sem dados. Clique em Editar para adicionar.</p>
                      )}
                    </>
                  )}

                  {/* Edit form */}
                  {editMode && (
                    <div className="space-y-2.5">

                      {/* Numeric fields */}
                      {([
                        { key: 'water',      field: 'water_ml',          label: 'Água',      unit: 'ml',  icon: HABITS[0].icon, textColor: HABITS[0].textColor, iconBg: HABITS[0].iconBg },
                        { key: 'steps',      field: 'steps',             label: 'Passos',    unit: 'pss', icon: HABITS[1].icon, textColor: HABITS[1].textColor, iconBg: HABITS[1].iconBg },
                        { key: 'reading',    field: 'reading_pages',     label: 'Leitura',   unit: 'pág', icon: HABITS[2].icon, textColor: HABITS[2].textColor, iconBg: HABITS[2].iconBg },
                        { key: 'study',      field: 'study_minutes',     label: 'Estudo',    unit: 'min', icon: HABITS[5].icon, textColor: HABITS[5].textColor, iconBg: HABITS[5].iconBg },
                        { key: 'meditation', field: 'meditation_minutes',label: 'Meditação', unit: 'min', icon: HABITS[6].icon, textColor: HABITS[6].textColor, iconBg: HABITS[6].iconBg },
                      ] as const).map(({ field, label, unit, icon: Icon, textColor, iconBg }) => (
                        <div key={field} className="flex items-center gap-2">
                          <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
                            <Icon size={13} className={textColor} />
                          </div>
                          <span className="flex-1 text-sm text-slate-400">{label}</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              value={editValues[field] as number}
                              onChange={e => setEditValues(v => ({ ...v, [field]: Math.max(0, Number(e.target.value)) }))}
                              className="w-20 rounded-xl border border-white/10 bg-slate-900/60 px-2.5 py-1 text-right text-sm text-white focus:border-tamagochi-400/50 focus:outline-none"
                            />
                            <span className="w-8 text-[10px] text-slate-600">{unit}</span>
                          </div>
                        </div>
                      ))}

                      {/* Boolean toggles */}
                      {([
                        { field: 'gym_done',      label: 'Academia', icon: HABITS[3].icon, textColor: HABITS[3].textColor, iconBg: HABITS[3].iconBg, activeColor: 'bg-rose-400/20 border-rose-400/30 text-rose-300' },
                        { field: 'creatine_done',  label: 'Creatina', icon: HABITS[4].icon, textColor: HABITS[4].textColor, iconBg: HABITS[4].iconBg, activeColor: 'bg-purple-400/20 border-purple-400/30 text-purple-300' },
                      ] as const).map(({ field, label, icon: Icon, textColor, iconBg, activeColor }) => {
                        const val = editValues[field] as boolean;
                        return (
                          <div key={field} className="flex items-center gap-2">
                            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${val ? iconBg : 'bg-white/5'}`}>
                              <Icon size={13} className={val ? textColor : 'text-slate-700'} />
                            </div>
                            <span className="flex-1 text-sm text-slate-400">{label}</span>
                            <button
                              onClick={() => setEditValues(v => ({ ...v, [field]: !val }))}
                              className={[
                                'flex items-center gap-1.5 rounded-xl border px-3 py-1 text-xs font-medium transition',
                                val ? activeColor : 'border-white/10 bg-white/5 text-slate-600 hover:text-slate-400',
                              ].join(' ')}
                            >
                              {val ? <><Check size={10} /> Feito</> : 'Não feito'}
                            </button>
                          </div>
                        );
                      })}

                      {/* Save / Cancel */}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={saveEdit}
                          disabled={saving}
                          className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-tamagochi-500/20 border border-tamagochi-400/30 py-2 text-sm font-medium text-tamagochi-300 transition hover:bg-tamagochi-500/30 disabled:opacity-50"
                        >
                          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          {saving ? 'Salvando…' : 'Salvar'}
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-500 transition hover:text-white disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <div className="rounded-[2rem] border border-white/5 bg-white/[0.03] p-5 text-center backdrop-blur-xl">
                  <p className="text-xs text-slate-600">Clique num dia para ver os detalhes</p>
                </div>
              )}

              {/* Streaks */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                <div className="mb-4 flex items-center gap-2">
                  <Flame className="text-orange-400" size={16} />
                  <h2 className="text-sm font-semibold text-white">Sequências atuais</h2>
                </div>
                <div className="space-y-2.5">
                  {HABITS.map((h, idx) => {
                    const Icon = h.icon;
                    const streak = streaks[idx];
                    return (
                      <div key={h.key} className="flex items-center gap-2.5">
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${h.iconBg}`}>
                          <Icon size={13} className={h.textColor} />
                        </div>
                        <span className="flex-1 text-sm text-slate-400">{h.label}</span>
                        <div className="flex items-center gap-1">
                          {streak > 0 && <Flame size={11} className="text-orange-400" />}
                          <span className={`text-sm font-semibold tabular-nums ${streak > 0 ? 'text-orange-300' : 'text-slate-700'}`}>
                            {streak}d
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Year stats */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                <p className="mb-4 text-[10px] uppercase tracking-widest text-slate-600">
                  Taxa de conclusão em {viewYear}
                </p>
                <div className="space-y-3">
                  {HABITS.map((h, idx) => {
                    const Icon = h.icon;
                    return (
                      <div key={h.key}>
                        <div className="mb-1 flex items-center gap-2">
                          <Icon size={11} className={h.textColor} />
                          <span className="flex-1 text-xs text-slate-500">{h.label}</span>
                          <span className={`text-xs font-bold ${h.textColor}`}>{yearStats[idx]}%</span>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className={`h-full rounded-full transition-all ${h.cellDone}`}
                            style={{ width: `${yearStats[idx]}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
