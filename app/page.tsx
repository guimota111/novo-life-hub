'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  collection, doc, setDoc, increment as fsIncrement, onSnapshot, getDoc, getDocs,
  query, where, documentId,
} from 'firebase/firestore';
import {
  Droplet, Footprints, BookOpen, Dumbbell, Pill, GraduationCap,
  Settings, Check, X,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Goals {
  water_ml: number;
  steps: number;
  reading_pages: number;
  gym_days_per_week: number;
  study_minutes: number;
}

interface DailyData {
  water_ml: number;
  steps: number;
  reading_pages: number;
  gym_done: boolean;
  creatine_done: boolean;
  study_minutes: number;
}

type TabPeriod = 'hoje' | 'semana' | 'mes' | 'ano';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_GOALS: Goals = {
  water_ml: 4000,
  steps: 10000,
  reading_pages: 10,
  gym_days_per_week: 5,
  study_minutes: 120,
};

const DAY_PT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MONTH_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ── Helpers ──────────────────────────────────────────────────────────────────

const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const getTodayStr = () => dateStr(new Date());

const emptyDay = (): DailyData => ({
  water_ml: 0, steps: 0, reading_pages: 0,
  gym_done: false, creatine_done: false, study_minutes: 0,
});

const getWeekDates = (): string[] => {
  const today = new Date();
  const dow = today.getDay(); // 0=Dom
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return dateStr(d);
  });
};

const pct = (val: number, goal: number) => Math.min((val / (goal || 1)) * 100, 100);

const fmtStudy = (min: number) => {
  if (min === 0) return '0 min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}min`;
  if (h > 0) return `${h}h`;
  return `${m}min`;
};

const fmtNum = (n: number) => n.toLocaleString('pt-BR');

// ── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ value, goal, color = 'bg-tamagochi-400' }: { value: number; goal: number; color?: string }) {
  const p = pct(value, goal);
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div
        className={`h-full ${color} transition-all duration-500`}
        style={{ width: `${p}%` }}
      />
    </div>
  );
}

// ── Quick-add buttons ─────────────────────────────────────────────────────────

function QuickAdd({
  options,
  onAdd,
  disabled,
  label = '+',
}: {
  options: { label: string; value: number }[];
  onAdd: (v: number) => void;
  disabled: boolean;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onAdd(opt.value)}
          disabled={disabled}
          className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-tamagochi-500/40 hover:bg-tamagochi-900/30 disabled:opacity-40"
        >
          {label}{opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function Page() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabPeriod>('hoje');
  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [todayData, setTodayData] = useState<DailyData>(emptyDay());
  const [weekData, setWeekData] = useState<Record<string, DailyData>>({});
  const [monthData, setMonthData] = useState<Record<string, DailyData>>({});
  const [yearData, setYearData] = useState<Record<string, DailyData>>({});
  const [monthFetched, setMonthFetched] = useState(false);
  const [yearFetched, setYearFetched] = useState(false);
  const [busy, setBusy] = useState(false);

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  const fetchDates = useCallback(async (dates: string[]): Promise<Record<string, DailyData>> => {
    if (!user) return {};
    const snaps = await Promise.all(
      dates.map(d => getDoc(doc(db, 'users', user.uid, 'daily_logs', d)))
    );
    const result: Record<string, DailyData> = {};
    snaps.forEach((snap, i) => {
      result[dates[i]] = snap.exists() ? { ...emptyDay(), ...(snap.data() as Partial<DailyData>) } : emptyDay();
    });
    return result;
  }, [user]);

  // Range query — single round-trip, only fetches docs that exist
  const fetchRange = useCallback(async (start: string, end: string): Promise<Record<string, DailyData>> => {
    if (!user) return {};
    const snap = await getDocs(query(
      collection(db, 'users', user.uid, 'daily_logs'),
      where(documentId(), '>=', start),
      where(documentId(), '<=', end),
    ));
    const result: Record<string, DailyData> = {};
    snap.docs.forEach(d => { result[d.id] = { ...emptyDay(), ...(d.data() as Partial<DailyData>) }; });
    return result;
  }, [user]);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;

    // Real-time listener for today
    const unsub = onSnapshot(
      doc(db, 'users', user.uid, 'daily_logs', getTodayStr()),
      snap => setTodayData(snap.exists() ? { ...emptyDay(), ...(snap.data() as Partial<DailyData>) } : emptyDay())
    );

    // Load goals
    getDoc(doc(db, 'users', user.uid, 'settings', 'goals')).then(snap => {
      if (snap.exists()) setGoals({ ...DEFAULT_GOALS, ...(snap.data() as Partial<Goals>) });
    });

    // Load current week
    fetchDates(getWeekDates()).then(setWeekData);

    return () => unsub();
  }, [user, fetchDates]);

  useEffect(() => {
    if (tab !== 'mes' || monthFetched || !user) return;
    const now = new Date();
    const start = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    fetchRange(start, getTodayStr()).then(data => { setMonthData(data); setMonthFetched(true); });
  }, [tab, monthFetched, user, fetchRange]);

  useEffect(() => {
    if (tab !== 'ano' || yearFetched || !user) return;
    const year = new Date().getFullYear();
    fetchRange(`${year}-01-01`, getTodayStr()).then(data => { setYearData(data); setYearFetched(true); });
  }, [tab, yearFetched, user, fetchRange]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const writeLog = async (dateKey: string, fields: Record<string, unknown>) => {
    if (!user) return;
    setBusy(true);
    try {
      await setDoc(doc(db, 'users', user.uid, 'daily_logs', dateKey), {
        ...fields, updatedAt: new Date(),
      }, { merge: true });
    } finally {
      setBusy(false);
    }
  };

  const addWater = (ml: number) => writeLog(getTodayStr(), { water_ml: fsIncrement(ml) });
  const addSteps = (s: number) => writeLog(getTodayStr(), { steps: fsIncrement(s) });
  const addPages = (p: number) => writeLog(getTodayStr(), { reading_pages: fsIncrement(p) });
  const addStudy = (m: number) => writeLog(getTodayStr(), { study_minutes: fsIncrement(m) });
  const toggleCreatine = () => writeLog(getTodayStr(), { creatine_done: !todayData.creatine_done });

  const toggleGym = async (dateKey: string) => {
    const current = dateKey === getTodayStr()
      ? todayData.gym_done
      : (weekData[dateKey]?.gym_done ?? false);
    await writeLog(dateKey, { gym_done: !current });
    // Update local week cache for non-today days (today is handled by onSnapshot)
    if (dateKey !== getTodayStr()) {
      setWeekData(prev => ({
        ...prev,
        [dateKey]: { ...emptyDay(), ...prev[dateKey], gym_done: !current },
      }));
    }
  };

  // ── Computed ───────────────────────────────────────────────────────────────

  const weekDates = getWeekDates();
  const today = getTodayStr();

  const getDayData = (dateKey: string): DailyData =>
    dateKey === today ? todayData : (weekData[dateKey] ?? emptyDay());

  const gymDaysThisWeek = weekDates.filter(d =>
    d === today ? todayData.gym_done : (weekData[d]?.gym_done ?? false)
  ).length;

  const overallScore = Math.round(
    (pct(todayData.water_ml, goals.water_ml) +
      pct(todayData.steps, goals.steps) +
      pct(todayData.reading_pages, goals.reading_pages) +
      pct(gymDaysThisWeek, goals.gym_days_per_week) +
      (todayData.creatine_done ? 100 : 0) +
      pct(todayData.study_minutes, goals.study_minutes)) / 6
  );

  const formatDate = () =>
    new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // ── Monthly stats helper ───────────────────────────────────────────────────

  const monthlyStats = (data: Record<string, DailyData>, year: number, month: number) => {
    const days = new Date(year, month + 1, 0).getDate();
    let water = 0, steps = 0, pages = 0, gym = 0, creatine = 0, study = 0, daysLogged = 0;
    for (let d = 1; d <= days; d++) {
      const k = dateStr(new Date(year, month, d));
      if (k > today) break;
      const day = data[k] ?? emptyDay();
      if (day.water_ml || day.steps || day.reading_pages || day.gym_done || day.creatine_done || day.study_minutes) {
        daysLogged++;
        water += day.water_ml;
        steps += day.steps;
        pages += day.reading_pages;
        if (day.gym_done) gym++;
        if (day.creatine_done) creatine++;
        study += day.study_minutes;
      }
    }
    return { water, steps, pages, gym, creatine, study, daysLogged };
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const scoreColor = overallScore >= 80 ? 'text-emerald-400' : overallScore >= 50 ? 'text-amber-400' : 'text-rose-400';

  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />

        <section className="flex-1 space-y-6">
          {/* Header */}
          <header className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur-xl">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-tamagochi-300">Tamagochi Me</p>
                <h1 className="text-4xl font-semibold text-white">Visão do Dia</h1>
                <p className="mt-1 capitalize text-slate-400">{formatDate()}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-3 rounded-3xl bg-slate-900/60 px-5 py-3 shadow-lg">
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-3xl bg-tamagochi-500/15 text-2xl">✨</span>
                  <div>
                    <p className={`text-2xl font-bold ${scoreColor}`}>{overallScore}%</p>
                    <p className="text-xs text-slate-400">Energia do dia</p>
                  </div>
                </div>
                <Link
                  href="/metas"
                  className="flex items-center gap-2 rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300 transition hover:border-tamagochi-500/30 hover:bg-white/10"
                >
                  <Settings size={16} />
                  Metas
                </Link>
              </div>
            </div>
          </header>

          {/* Tab bar */}
          <div className="flex gap-2 rounded-3xl border border-white/10 bg-white/5 p-2 backdrop-blur-xl">
            {(['hoje', 'semana', 'mes', 'ano'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-2xl py-2.5 text-sm font-medium transition
                  ${tab === t ? 'bg-tamagochi-500 text-slate-950 shadow-lg' : 'text-slate-400 hover:text-white'}`}
              >
                {t === 'hoje' ? 'Hoje' : t === 'semana' ? 'Semana' : t === 'mes' ? 'Mês' : 'Ano'}
              </button>
            ))}
          </div>

          {/* ── HOJE ──────────────────────────────────────────────────────── */}
          {tab === 'hoje' && (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">

              {/* Água */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Droplet className="text-blue-400" size={18} />
                    <span className="font-semibold text-white">Água</span>
                  </div>
                  <span className="text-sm font-bold text-blue-400">{Math.round(pct(todayData.water_ml, goals.water_ml))}%</span>
                </div>
                <p className="mb-2 text-2xl font-bold text-white">
                  {fmtNum(todayData.water_ml)} <span className="text-base font-normal text-slate-400">/ {fmtNum(goals.water_ml)} ml</span>
                </p>
                <ProgressBar value={todayData.water_ml} goal={goals.water_ml} color="bg-blue-500" />
                <div className="mt-4">
                  <QuickAdd
                    options={[{ label: '250ml', value: 250 }, { label: '500ml', value: 500 }, { label: '750ml', value: 750 }, { label: '1L', value: 1000 }]}
                    onAdd={addWater}
                    disabled={busy}
                    label="+"
                  />
                </div>
              </div>

              {/* Passos */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Footprints className="text-emerald-400" size={18} />
                    <span className="font-semibold text-white">Passos</span>
                  </div>
                  <span className="text-sm font-bold text-emerald-400">{Math.round(pct(todayData.steps, goals.steps))}%</span>
                </div>
                <p className="mb-2 text-2xl font-bold text-white">
                  {fmtNum(todayData.steps)} <span className="text-base font-normal text-slate-400">/ {fmtNum(goals.steps)}</span>
                </p>
                <ProgressBar value={todayData.steps} goal={goals.steps} color="bg-emerald-500" />
                <div className="mt-4">
                  <QuickAdd
                    options={[{ label: '1k', value: 1000 }, { label: '2k', value: 2000 }, { label: '5k', value: 5000 }, { label: '10k', value: 10000 }]}
                    onAdd={addSteps}
                    disabled={busy}
                    label="+"
                  />
                </div>
              </div>

              {/* Leitura */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="text-amber-400" size={18} />
                    <span className="font-semibold text-white">Leitura</span>
                  </div>
                  <span className="text-sm font-bold text-amber-400">{Math.round(pct(todayData.reading_pages, goals.reading_pages))}%</span>
                </div>
                <p className="mb-2 text-2xl font-bold text-white">
                  {todayData.reading_pages} <span className="text-base font-normal text-slate-400">/ {goals.reading_pages} páginas</span>
                </p>
                <ProgressBar value={todayData.reading_pages} goal={goals.reading_pages} color="bg-amber-500" />
                <div className="mt-4">
                  <QuickAdd
                    options={[{ label: '1', value: 1 }, { label: '5', value: 5 }, { label: '10', value: 10 }, { label: '20', value: 20 }]}
                    onAdd={addPages}
                    disabled={busy}
                    label="+"
                  />
                </div>
              </div>

              {/* Academia */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Dumbbell className="text-rose-400" size={18} />
                    <span className="font-semibold text-white">Academia</span>
                  </div>
                  <span className="text-sm font-bold text-rose-400">{gymDaysThisWeek}/{goals.gym_days_per_week} esta semana</span>
                </div>
                <ProgressBar value={gymDaysThisWeek} goal={goals.gym_days_per_week} color="bg-rose-500" />
                <div className="mt-4 flex gap-1.5">
                  {weekDates.map((d, i) => {
                    const done = d === today ? todayData.gym_done : (weekData[d]?.gym_done ?? false);
                    const isFuture = d > today;
                    return (
                      <button
                        key={d}
                        onClick={() => !isFuture && toggleGym(d)}
                        disabled={isFuture || busy}
                        title={d}
                        className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-xs font-medium transition
                          ${isFuture ? 'cursor-default opacity-30' : 'cursor-pointer hover:bg-white/10'}
                          ${done ? 'bg-rose-500/20 text-rose-300' : 'bg-slate-900/50 text-slate-500'}`}
                      >
                        <span>{DAY_PT[i]}</span>
                        <span>{done ? '✓' : '○'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Creatina */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
                <div className="mb-3 flex items-center gap-2">
                  <Pill className="text-purple-400" size={18} />
                  <span className="font-semibold text-white">Creatina</span>
                </div>
                <p className="mb-4 text-sm text-slate-400">1x por dia</p>
                <button
                  onClick={toggleCreatine}
                  disabled={busy}
                  className={`flex w-full items-center justify-center gap-3 rounded-2xl py-4 text-base font-semibold transition disabled:opacity-50
                    ${todayData.creatine_done
                      ? 'bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:bg-purple-500/10'
                      : 'bg-slate-900/60 border border-white/10 text-slate-400 hover:border-purple-500/30 hover:bg-purple-900/20 hover:text-purple-300'
                    }`}
                >
                  {todayData.creatine_done
                    ? <><Check size={20} /> Tomei hoje!</>
                    : <><X size={20} /> Ainda não tomei</>
                  }
                </button>
              </div>

              {/* Estudo */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GraduationCap className="text-violet-400" size={18} />
                    <span className="font-semibold text-white">Estudo</span>
                  </div>
                  <span className="text-sm font-bold text-violet-400">{Math.round(pct(todayData.study_minutes, goals.study_minutes))}%</span>
                </div>
                <p className="mb-2 text-2xl font-bold text-white">
                  {fmtStudy(todayData.study_minutes)} <span className="text-base font-normal text-slate-400">/ {fmtStudy(goals.study_minutes)}</span>
                </p>
                <ProgressBar value={todayData.study_minutes} goal={goals.study_minutes} color="bg-violet-500" />
                <div className="mt-4">
                  <QuickAdd
                    options={[{ label: '15min', value: 15 }, { label: '30min', value: 30 }, { label: '1h', value: 60 }, { label: '2h', value: 120 }]}
                    onAdd={addStudy}
                    disabled={busy}
                    label="+"
                  />
                </div>
              </div>

            </div>
          )}

          {/* ── SEMANA ────────────────────────────────────────────────────── */}
          {tab === 'semana' && (() => {
            const semStart = weekDates[0].split('-').reverse().slice(0,2).join('/');
            const semEnd = weekDates[6].split('-').reverse().slice(0,2).join('/');

            const goalRows = [
              { label: 'Água', icon: Droplet, color: 'text-blue-400', check: (d: DailyData) => pct(d.water_ml, goals.water_ml) >= 100, partial: (d: DailyData) => d.water_ml > 0 },
              { label: 'Passos', icon: Footprints, color: 'text-emerald-400', check: (d: DailyData) => pct(d.steps, goals.steps) >= 100, partial: (d: DailyData) => d.steps > 0 },
              { label: 'Leitura', icon: BookOpen, color: 'text-amber-400', check: (d: DailyData) => pct(d.reading_pages, goals.reading_pages) >= 100, partial: (d: DailyData) => d.reading_pages > 0 },
              { label: 'Academia', icon: Dumbbell, color: 'text-rose-400', check: (d: DailyData) => d.gym_done, partial: () => false },
              { label: 'Creatina', icon: Pill, color: 'text-purple-400', check: (d: DailyData) => d.creatine_done, partial: () => false },
              { label: 'Estudo', icon: GraduationCap, color: 'text-violet-400', check: (d: DailyData) => pct(d.study_minutes, goals.study_minutes) >= 100, partial: (d: DailyData) => d.study_minutes > 0 },
            ];

            return (
              <div className="space-y-4">
                <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
                  <p className="mb-6 text-sm uppercase tracking-widest text-tamagochi-300">
                    Semana {semStart} – {semEnd}
                  </p>

                  {/* Day headers */}
                  <div className="mb-3 grid grid-cols-[120px_repeat(7,1fr)] gap-1 text-center text-xs font-semibold text-slate-400">
                    <div />
                    {weekDates.map((d, i) => (
                      <div key={d} className={d === today ? 'text-tamagochi-300' : ''}>
                        {DAY_PT[i]}<br />
                        <span className="text-slate-500">{d.split('-')[2]}</span>
                      </div>
                    ))}
                  </div>

                  {/* Goal rows */}
                  <div className="space-y-2">
                    {goalRows.map(row => {
                      const Icon = row.icon;
                      let metCount = 0;
                      return (
                        <div key={row.label} className="grid grid-cols-[120px_repeat(7,1fr)] items-center gap-1">
                          <div className="flex items-center gap-2 text-sm text-slate-300">
                            <Icon size={14} className={row.color} />
                            {row.label}
                          </div>
                          {weekDates.map(d => {
                            const day = getDayData(d);
                            const isFuture = d > today;
                            const met = !isFuture && row.check(day);
                            const partial = !isFuture && !met && row.partial(day);
                            if (met) metCount++;
                            return (
                              <div key={d} className="flex items-center justify-center">
                                {isFuture ? (
                                  <span className="text-slate-700">─</span>
                                ) : met ? (
                                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">✓</span>
                                ) : partial ? (
                                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20 text-amber-400 text-xs">~</span>
                                ) : (
                                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-rose-500/10 text-rose-500 text-xs">✗</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <div className="mt-6 flex flex-wrap gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1.5"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">✓</span> Meta atingida</span>
                    <span className="flex items-center gap-1.5"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">~</span> Parcial</span>
                    <span className="flex items-center gap-1.5"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">✗</span> Não atingida</span>
                    <span className="flex items-center gap-1.5"><span className="text-slate-700">─</span> Dia futuro</span>
                  </div>
                </div>

                {/* Weekly summaries */}
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    { label: 'Água total', icon: Droplet, color: 'text-blue-400', value: `${fmtNum(weekDates.reduce((a, d) => a + getDayData(d).water_ml, 0))} ml` },
                    { label: 'Passos total', icon: Footprints, color: 'text-emerald-400', value: fmtNum(weekDates.reduce((a, d) => a + getDayData(d).steps, 0)) },
                    { label: 'Páginas total', icon: BookOpen, color: 'text-amber-400', value: `${weekDates.reduce((a, d) => a + getDayData(d).reading_pages, 0)} págs` },
                    { label: 'Treinos', icon: Dumbbell, color: 'text-rose-400', value: `${gymDaysThisWeek} / ${goals.gym_days_per_week} dias` },
                    { label: 'Creatina', icon: Pill, color: 'text-purple-400', value: `${weekDates.filter(d => getDayData(d).creatine_done).length} / 7 dias` },
                    { label: 'Estudo total', icon: GraduationCap, color: 'text-violet-400', value: fmtStudy(weekDates.reduce((a, d) => a + getDayData(d).study_minutes, 0)) },
                  ].map(item => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                        <div className="flex items-center gap-2 mb-1">
                          <Icon className={item.color} size={16} />
                          <span className="text-sm text-slate-400">{item.label}</span>
                        </div>
                        <p className="text-xl font-bold text-white">{item.value}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* ── MÊS ───────────────────────────────────────────────────────── */}
          {tab === 'mes' && (() => {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const mergedMonth: Record<string, DailyData> = {};
            for (let d = 1; d <= daysInMonth; d++) {
              const k = dateStr(new Date(year, month, d));
              mergedMonth[k] = k === today ? todayData : (monthData[k] ?? emptyDay());
            }
            const stats = monthlyStats(mergedMonth, year, month);
            const daysElapsed = Math.min(parseInt(today.split('-')[2]), daysInMonth);

            return (
              <div className="space-y-4">
                <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                  <p className="mb-6 text-sm uppercase tracking-widest text-tamagochi-300">
                    {MONTH_PT[month]} {year} · {stats.daysLogged} dias registrados
                  </p>

                  {!monthFetched ? (
                    <p className="text-center text-slate-400">Carregando dados do mês...</p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {[
                        { label: 'Água', icon: Droplet, color: 'text-blue-400', bg: 'bg-blue-500', value: `${fmtNum(stats.water)} ml`, sub: `Média: ${fmtNum(Math.round(stats.water / Math.max(stats.daysLogged, 1)))} ml/dia`, pctVal: pct(stats.water, goals.water_ml * daysElapsed) },
                        { label: 'Passos', icon: Footprints, color: 'text-emerald-400', bg: 'bg-emerald-500', value: fmtNum(stats.steps), sub: `Média: ${fmtNum(Math.round(stats.steps / Math.max(stats.daysLogged, 1)))}/dia`, pctVal: pct(stats.steps, goals.steps * daysElapsed) },
                        { label: 'Leitura', icon: BookOpen, color: 'text-amber-400', bg: 'bg-amber-500', value: `${stats.pages} páginas`, sub: `Média: ${(stats.pages / Math.max(stats.daysLogged, 1)).toFixed(1)}/dia`, pctVal: pct(stats.pages, goals.reading_pages * daysElapsed) },
                        { label: 'Academia', icon: Dumbbell, color: 'text-rose-400', bg: 'bg-rose-500', value: `${stats.gym} dias`, sub: `Meta: ${Math.round(goals.gym_days_per_week * (daysElapsed / 7))} dias`, pctVal: pct(stats.gym, Math.max(1, Math.round(goals.gym_days_per_week * (daysElapsed / 7)))) },
                        { label: 'Creatina', icon: Pill, color: 'text-purple-400', bg: 'bg-purple-500', value: `${stats.creatine} dias`, sub: `de ${daysElapsed} dias`, pctVal: pct(stats.creatine, daysElapsed) },
                        { label: 'Estudo', icon: GraduationCap, color: 'text-violet-400', bg: 'bg-violet-500', value: fmtStudy(stats.study), sub: `Média: ${fmtStudy(Math.round(stats.study / Math.max(stats.daysLogged, 1)))}/dia`, pctVal: pct(stats.study, goals.study_minutes * daysElapsed) },
                      ].map(item => {
                        const Icon = item.icon;
                        return (
                          <div key={item.label} className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                            <div className="mb-3 flex items-center gap-2">
                              <Icon className={item.color} size={16} />
                              <span className="font-medium text-slate-200">{item.label}</span>
                              <span className={`ml-auto text-sm font-bold ${item.color}`}>{Math.round(item.pctVal)}%</span>
                            </div>
                            <p className="mb-1 text-xl font-bold text-white">{item.value}</p>
                            <p className="mb-3 text-xs text-slate-400">{item.sub}</p>
                            <ProgressBar value={item.pctVal} goal={100} color={item.bg} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Month calendar grid */}
                {monthFetched && (
                  <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                    <p className="mb-4 text-sm uppercase tracking-widest text-tamagochi-300">Calendário do mês</p>
                    <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500 mb-2">
                      {DAY_PT.map(d => <div key={d}>{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {/* Empty cells for first week */}
                      {Array.from({ length: (() => {
                        const dow = new Date(year, month, 1).getDay();
                        return dow === 0 ? 6 : dow - 1;
                      })() }).map((_, i) => <div key={`empty-${i}`} />)}
                      {Array.from({ length: daysInMonth }, (_, i) => {
                        const k = dateStr(new Date(year, month, i + 1));
                        const day = mergedMonth[k];
                        const isFuture = k > today;
                        const score = isFuture ? null : Math.round(
                          (pct(day.water_ml, goals.water_ml) +
                            pct(day.steps, goals.steps) +
                            pct(day.reading_pages, goals.reading_pages) +
                            (day.gym_done ? 100 : 0) +
                            (day.creatine_done ? 100 : 0) +
                            pct(day.study_minutes, goals.study_minutes)) / 6
                        );
                        const bg = isFuture ? 'bg-slate-900/30' :
                          score === null ? 'bg-slate-900/30' :
                          score >= 80 ? 'bg-emerald-500/25 text-emerald-300' :
                          score >= 50 ? 'bg-amber-500/20 text-amber-300' :
                          score > 0 ? 'bg-rose-500/20 text-rose-300' :
                          'bg-slate-900/30 text-slate-600';
                        return (
                          <div key={k} className={`rounded-xl p-1.5 text-center ${bg}`} title={`${k}: ${score ?? '─'}%`}>
                            <p className="text-xs font-semibold">{i + 1}</p>
                            {!isFuture && score !== null && (
                              <p className="text-[10px] opacity-75">{score}%</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── ANO ───────────────────────────────────────────────────────── */}
          {tab === 'ano' && (() => {
            const year = new Date().getFullYear();

            return (
              <div className="space-y-4">
                <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                  <p className="mb-6 text-sm uppercase tracking-widest text-tamagochi-300">{year} — visão anual</p>

                  {!yearFetched ? (
                    <p className="text-center text-slate-400">Carregando dados do ano...</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[600px] text-sm">
                        <thead>
                          <tr>
                            <th className="pb-3 text-left text-xs text-slate-400 font-medium w-28">Meta</th>
                            {MONTH_PT.map(m => (
                              <th key={m} className="pb-3 text-center text-xs text-slate-400 font-medium px-1">{m}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="space-y-1">
                          {[
                            { label: 'Água', icon: Droplet, color: 'text-blue-400', fn: (d: DailyData) => pct(d.water_ml, goals.water_ml) },
                            { label: 'Passos', icon: Footprints, color: 'text-emerald-400', fn: (d: DailyData) => pct(d.steps, goals.steps) },
                            { label: 'Leitura', icon: BookOpen, color: 'text-amber-400', fn: (d: DailyData) => pct(d.reading_pages, goals.reading_pages) },
                            { label: 'Academia', icon: Dumbbell, color: 'text-rose-400', fn: (d: DailyData) => d.gym_done ? 100 : 0 },
                            { label: 'Creatina', icon: Pill, color: 'text-purple-400', fn: (d: DailyData) => d.creatine_done ? 100 : 0 },
                            { label: 'Estudo', icon: GraduationCap, color: 'text-violet-400', fn: (d: DailyData) => pct(d.study_minutes, goals.study_minutes) },
                          ].map(row => {
                            const Icon = row.icon;
                            return (
                              <tr key={row.label} className="border-t border-white/5">
                                <td className="py-2 pr-3">
                                  <span className={`flex items-center gap-1.5 text-xs font-medium ${row.color}`}>
                                    <Icon size={12} />
                                    {row.label}
                                  </span>
                                </td>
                                {Array.from({ length: 12 }, (_, m) => {
                                  const firstDay = dateStr(new Date(year, m, 1));
                                  const isFuture = firstDay > today;
                                  if (isFuture) return (
                                    <td key={m} className="px-1 py-2 text-center text-slate-700 text-xs">─</td>
                                  );
                                  const days = new Date(year, m + 1, 0).getDate();
                                  let total = 0, count = 0;
                                  for (let d = 1; d <= days; d++) {
                                    const k = dateStr(new Date(year, m, d));
                                    if (k > today) break;
                                    const dayData = k === today ? todayData : (yearData[k] ?? emptyDay());
                                    total += row.fn(dayData);
                                    count++;
                                  }
                                  const avg = count > 0 ? Math.round(total / count) : 0;
                                  const bg = avg >= 80 ? 'bg-emerald-500/25 text-emerald-300' :
                                    avg >= 50 ? 'bg-amber-500/20 text-amber-300' :
                                    avg > 0 ? 'bg-rose-500/20 text-rose-300' :
                                    'bg-slate-900/30 text-slate-500';
                                  return (
                                    <td key={m} className="px-1 py-2">
                                      <div className={`rounded-lg px-1 py-1 text-center text-xs font-semibold ${bg}`}>
                                        {avg}%
                                      </div>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>

                      <div className="mt-6 flex flex-wrap gap-4 text-xs text-slate-400">
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-6 rounded bg-emerald-500/25" /> ≥80%</span>
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-6 rounded bg-amber-500/20" /> 50–79%</span>
                        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-6 rounded bg-rose-500/20" /> &lt;50%</span>
                        <span className="flex items-center gap-1.5"><span className="text-slate-700">─</span> Futuro</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Year totals */}
                {yearFetched && (() => {
                  const yStats = monthlyStats(
                    Object.fromEntries(
                      Object.entries(yearData).concat([[today, todayData]])
                    ),
                    year,
                    11  // pass 11 but we'll iterate correctly inside
                  );
                  // Recalculate properly for whole year
                  let water = 0, steps = 0, pages = 0, gym = 0, creatine = 0, study = 0;
                  for (const [k, d] of Object.entries({ ...yearData, [today]: todayData })) {
                    if (k.startsWith(String(year)) && k <= today) {
                      water += d.water_ml;
                      steps += d.steps;
                      pages += d.reading_pages;
                      if (d.gym_done) gym++;
                      if (d.creatine_done) creatine++;
                      study += d.study_minutes;
                    }
                  }
                  return (
                    <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                      <p className="mb-4 text-sm uppercase tracking-widest text-tamagochi-300">Totais do ano</p>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {[
                          { label: 'Água consumida', icon: Droplet, color: 'text-blue-400', value: `${fmtNum(Math.round(water / 1000))} litros` },
                          { label: 'Passos dados', icon: Footprints, color: 'text-emerald-400', value: fmtNum(steps) },
                          { label: 'Páginas lidas', icon: BookOpen, color: 'text-amber-400', value: `${pages} páginas` },
                          { label: 'Dias de treino', icon: Dumbbell, color: 'text-rose-400', value: `${gym} dias` },
                          { label: 'Creatina tomada', icon: Pill, color: 'text-purple-400', value: `${creatine} dias` },
                          { label: 'Horas de estudo', icon: GraduationCap, color: 'text-violet-400', value: fmtStudy(study) },
                        ].map(item => {
                          const Icon = item.icon;
                          return (
                            <div key={item.label} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                              <Icon className={item.color} size={20} />
                              <div>
                                <p className="text-xs text-slate-400">{item.label}</p>
                                <p className="font-bold text-white">{item.value}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })()}

        </section>
      </div>
    </main>
  );
}
