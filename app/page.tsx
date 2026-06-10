'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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
  Settings, Check, X, Flame, Wind, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Goals {
  water_ml: number;
  steps: number;
  reading_pages: number;
  gym_days_per_week: number;
  study_minutes: number;
  meditation_minutes: number;
}

interface DailyData {
  water_ml: number;
  steps: number;
  reading_pages: number;
  gym_done: boolean;
  creatine_done: boolean;
  study_minutes: number;
  meditation_minutes: number;
}

type TabPeriod = 'hoje' | 'semana' | 'mes' | 'ano';
type HeatLevel = 'none' | 'low' | 'mid' | 'full';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_GOALS: Goals = {
  water_ml: 4000,
  steps: 10000,
  reading_pages: 10,
  gym_days_per_week: 5,
  study_minutes: 120,
  meditation_minutes: 10,
};

const DAY_PT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MONTH_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ── Helpers ──────────────────────────────────────────────────────────────────

const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const getTodayStr = () => dateStr(new Date());

const emptyDay = (): DailyData => ({
  water_ml: 0, steps: 0, reading_pages: 0,
  gym_done: false, creatine_done: false, study_minutes: 0, meditation_minutes: 0,
});

const getWeekDates = (offsetWeeks = 0): string[] => {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offsetWeeks * 7);
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
      <div className={`h-full ${color} transition-all duration-500`} style={{ width: `${p}%` }} />
    </div>
  );
}

// ── Quick-add buttons ─────────────────────────────────────────────────────────

function QuickAdd({
  options, onAdd, disabled, label = '+',
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

// ── Streak badge ─────────────────────────────────────────────────────────────

function StreakBadge({ count, capped }: { count: number; capped: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${count > 0 ? 'text-orange-300' : 'text-slate-600'}`}>
      <Flame size={12} className={count > 0 ? 'text-orange-400' : 'text-slate-600'} />
      {count}{capped ? '+' : ''} {count === 1 ? 'dia' : 'dias'}
    </span>
  );
}

// ── Delta vs período anterior ────────────────────────────────────────────────

function DeltaVs({
  current, prev, fmtAbs, vs, showPct = false,
}: {
  current: number;
  prev: number;
  fmtAbs: (n: number) => string;
  vs: string;
  showPct?: boolean;
}) {
  const diff = current - prev;
  if (prev === 0 && current === 0) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-slate-600"><Minus size={11} /> sem dados vs {vs}</span>;
  }
  if (diff === 0) {
    return <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Minus size={11} /> = {vs}</span>;
  }
  const up = diff > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const pctTxt = showPct && prev > 0 ? ` (${up ? '+' : '−'}${Math.abs(Math.round((diff / prev) * 100))}%)` : '';
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
      <Icon size={11} />
      {up ? '+' : '−'}{fmtAbs(Math.abs(diff))}{pctTxt} vs {vs}
    </span>
  );
}

// ── Habit row (card HOJE) ────────────────────────────────────────────────────

function HabitRow({
  icon: Icon, iconColor, bubbleBg, barColor, label,
  valueNode, pctVal, streak, yesterdayNode, controls,
}: {
  icon: React.ElementType;
  iconColor: string;
  bubbleBg: string;
  barColor: string;
  label: string;
  valueNode: React.ReactNode;
  pctVal: number;
  streak: { count: number; capped: boolean };
  yesterdayNode: React.ReactNode;
  controls?: React.ReactNode;
}) {
  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${bubbleBg}`}>
          <Icon size={18} className={iconColor} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="font-semibold text-white">{label}</span>
            {valueNode}
          </div>
          <ProgressBar value={pctVal} goal={100} color={barColor} />
        </div>
        <div className="flex w-24 shrink-0 flex-col items-end gap-1 sm:w-32">
          <StreakBadge count={streak.count} capped={streak.capped} />
          {yesterdayNode}
        </div>
      </div>
      {controls && <div className="mt-3 pl-14">{controls}</div>}
    </div>
  );
}

// ── Week bar chart component ──────────────────────────────────────────────────

function WeekBarChart({
  label, icon: Icon, iconColor, fullCls, partialCls,
  weekDates, today, getDayValue, goal, formatTotal, prevTotal,
}: {
  label: string;
  icon: React.ElementType;
  iconColor: string;
  fullCls: string;
  partialCls: string;
  weekDates: string[];
  today: string;
  getDayValue: (dateKey: string) => number;
  goal: number;
  formatTotal: (v: number) => string;
  prevTotal?: number;
}) {
  const BAR_H = 80;
  const vals = weekDates.map(getDayValue);
  const maxVal = Math.max(goal, ...vals, 1);
  const total = vals.reduce((a, v) => a + v, 0);

  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="mb-1 flex items-center gap-2">
        <Icon size={14} className={iconColor} />
        <span className="text-sm font-medium text-slate-200">{label}</span>
        <span className="ml-auto text-xs text-slate-400">{formatTotal(total)}</span>
      </div>
      <div className="mb-3 text-right">
        {prevTotal !== undefined && (
          <DeltaVs current={total} prev={prevTotal} fmtAbs={formatTotal} vs="semana passada" showPct />
        )}
      </div>
      <div className="relative mb-1" style={{ height: `${BAR_H}px` }}>
        <div
          className="absolute left-0 right-0 border-t border-dashed border-white/20 pointer-events-none"
          style={{ bottom: `${(goal / maxVal) * BAR_H}px` }}
        />
        <div className="absolute inset-0 flex items-end gap-1">
          {weekDates.map((d, i) => {
            const val = getDayValue(d);
            const isFuture = d > today;
            const isToday = d === today;
            const met = !isFuture && val >= goal;
            const h = isFuture || val === 0 ? 2 : Math.max((val / maxVal) * BAR_H, 3);
            return (
              <div key={d} className="flex-1 flex items-end h-full">
                <div
                  className={[
                    'w-full rounded-t-sm transition-all',
                    isFuture ? 'bg-slate-900/30' : val === 0 ? 'bg-slate-900/30' : met ? fullCls : partialCls,
                    isToday ? 'ring-1 ring-white/30 ring-offset-1 ring-offset-[#08101a]' : '',
                  ].join(' ')}
                  style={{ height: `${h}px` }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-1">
        {weekDates.map((d, i) => (
          <div key={d} className="flex-1 text-center">
            <span className={`text-[9px] ${d === today ? 'text-tamagochi-300 font-semibold' : 'text-slate-500'}`}>
              {DAY_PT[i][0]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Month heatmap component ───────────────────────────────────────────────────

function MonthHeatmap({
  icon: Icon, iconColor, label,
  days, firstDayOffset, today,
  fullCls, midCls, lowCls,
  getLevel,
}: {
  icon: React.ElementType;
  iconColor: string;
  label: string;
  days: { k: string; day: number; isFuture: boolean; data: DailyData }[];
  firstDayOffset: number;
  today: string;
  fullCls: string;
  midCls: string;
  lowCls: string;
  getLevel: (d: DailyData) => HeatLevel;
}) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="mb-3 flex items-center gap-2">
        <Icon size={14} className={iconColor} />
        <span className="text-sm font-medium text-slate-200">{label}</span>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {DAY_PT.map(d => (
          <div key={d} className="text-center text-[7px] text-slate-600">{d[0]}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: firstDayOffset }).map((_, i) => <div key={`e-${i}`} />)}
        {days.map(({ k, day, isFuture, data }) => {
          const level = isFuture ? null : getLevel(data);
          const isToday = k === today;
          return (
            <div
              key={k}
              className={[
                'h-5 flex items-start p-0.5 rounded-sm',
                isToday ? 'ring-1 ring-white/40 ring-offset-1 ring-offset-[#08101a]' : '',
                isFuture ? 'bg-slate-900/20' :
                level === 'full' ? fullCls :
                level === 'mid'  ? midCls :
                level === 'low'  ? lowCls :
                'bg-slate-900/40',
              ].join(' ')}
            >
              <span className={`text-[7px] leading-none font-medium ${
                isFuture ? 'text-slate-700' :
                level === 'none' ? 'text-slate-600' : 'text-white/70'
              }`}>{day}</span>
            </div>
          );
        })}
      </div>
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
  const [lastWeekData, setLastWeekData] = useState<Record<string, DailyData>>({});
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
    const unsub = onSnapshot(
      doc(db, 'users', user.uid, 'daily_logs', getTodayStr()),
      snap => setTodayData(snap.exists() ? { ...emptyDay(), ...(snap.data() as Partial<DailyData>) } : emptyDay())
    );
    getDoc(doc(db, 'users', user.uid, 'settings', 'goals')).then(snap => {
      if (snap.exists()) setGoals({ ...DEFAULT_GOALS, ...(snap.data() as Partial<Goals>) });
    });
    fetchDates(getWeekDates()).then(setWeekData);
    fetchDates(getWeekDates(-1)).then(setLastWeekData);
    return () => unsub();
  }, [user, fetchDates]);

  // Load month data eagerly — includes previous month for streaks and comparisons
  useEffect(() => {
    if (monthFetched || !user) return;
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const start = dateStr(prevMonth);
    fetchRange(start, getTodayStr()).then(data => { setMonthData(data); setMonthFetched(true); });
  }, [monthFetched, user, fetchRange]);

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
  const subtractWater = () => writeLog(getTodayStr(), { water_ml: Math.max(0, todayData.water_ml - 250) });
  const toggleCreatine = () => writeLog(getTodayStr(), { creatine_done: !todayData.creatine_done });
  const toggleGym = () => writeLog(getTodayStr(), { gym_done: !todayData.gym_done });

  // ── Computed ───────────────────────────────────────────────────────────────

  const weekDates = getWeekDates();
  const lastWeekDates = getWeekDates(-1);
  const today = getTodayStr();

  const getDayData = (dateKey: string): DailyData =>
    dateKey === today ? todayData : (weekData[dateKey] ?? emptyDay());

  const gymDaysThisWeek = weekDates.filter(d =>
    d === today ? todayData.gym_done : (weekData[d]?.gym_done ?? false)
  ).length;

  const habitDone = {
    water: todayData.water_ml >= goals.water_ml,
    steps: todayData.steps >= goals.steps,
    reading: todayData.reading_pages >= goals.reading_pages,
    gym: todayData.gym_done,
    creatine: todayData.creatine_done,
    study: todayData.study_minutes >= goals.study_minutes,
    meditation: todayData.meditation_minutes >= goals.meditation_minutes,
  };
  const completedToday = Object.values(habitDone).filter(Boolean).length;

  const overallScore = Math.round(
    (pct(todayData.water_ml, goals.water_ml) +
      pct(todayData.steps, goals.steps) +
      pct(todayData.reading_pages, goals.reading_pages) +
      (todayData.gym_done ? 100 : 0) +
      (todayData.creatine_done ? 100 : 0) +
      pct(todayData.study_minutes, goals.study_minutes) +
      pct(todayData.meditation_minutes, goals.meditation_minutes)) / 7
  );

  // Streaks: consecutive days with the habit completed. If today is still
  // pending, the streak counts from yesterday backwards (doesn't reset mid-day).
  const streaks = useMemo(() => {
    const all: Record<string, DailyData> = { ...monthData, [today]: todayData };
    const now = new Date();
    const dataStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12);
    const calc = (done: (d: DailyData) => boolean) => {
      const d = new Date(today + 'T12:00:00');
      if (!done(all[today] ?? emptyDay())) d.setDate(d.getDate() - 1);
      let count = 0;
      while (d >= dataStart) {
        if (done(all[dateStr(d)] ?? emptyDay())) { count++; d.setDate(d.getDate() - 1); }
        else break;
      }
      return { count, capped: d < dataStart };
    };
    return {
      water: calc(x => x.water_ml >= goals.water_ml),
      steps: calc(x => x.steps >= goals.steps),
      reading: calc(x => x.reading_pages >= goals.reading_pages),
      gym: calc(x => x.gym_done),
      creatine: calc(x => x.creatine_done),
      study: calc(x => x.study_minutes >= goals.study_minutes),
      meditation: calc(x => x.meditation_minutes >= goals.meditation_minutes),
    };
  }, [today, todayData, monthData, goals]);

  const yesterdayKey = useMemo(() => {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return dateStr(d);
  }, [today]);
  const yesterdayData = monthData[yesterdayKey] ?? emptyDay();
  const yesterdayScore = Math.round(
    (pct(yesterdayData.water_ml, goals.water_ml) +
      pct(yesterdayData.steps, goals.steps) +
      pct(yesterdayData.reading_pages, goals.reading_pages) +
      (yesterdayData.gym_done ? 100 : 0) +
      (yesterdayData.creatine_done ? 100 : 0) +
      pct(yesterdayData.study_minutes, goals.study_minutes) +
      pct(yesterdayData.meditation_minutes, goals.meditation_minutes)) / 7
  );

  const formatDate = () =>
    new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // ── Monthly stats helper ───────────────────────────────────────────────────

  const monthlyStats = (data: Record<string, DailyData>, year: number, month: number, maxDay?: number) => {
    const days = Math.min(new Date(year, month + 1, 0).getDate(), maxDay ?? 31);
    let water = 0, steps = 0, pages = 0, gym = 0, creatine = 0, study = 0, meditation = 0, daysLogged = 0;
    for (let d = 1; d <= days; d++) {
      const k = dateStr(new Date(year, month, d));
      if (k > today) break;
      const day = data[k] ?? emptyDay();
      if (day.water_ml || day.steps || day.reading_pages || day.gym_done || day.creatine_done || day.study_minutes || day.meditation_minutes) {
        daysLogged++;
        water += day.water_ml;
        steps += day.steps;
        pages += day.reading_pages;
        if (day.gym_done) gym++;
        if (day.creatine_done) creatine++;
        study += day.study_minutes;
        meditation += day.meditation_minutes;
      }
    }
    return { water, steps, pages, gym, creatine, study, meditation, daysLogged };
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const scoreColor = overallScore >= 80 ? 'text-emerald-400' : overallScore >= 50 ? 'text-amber-400' : 'text-rose-400';

  const yesterdayBool = (done: boolean) => (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
      Ontem:{done
        ? <Check size={11} className="text-emerald-400" />
        : <X size={11} className="text-rose-400" />}
    </span>
  );

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
              <Link
                href="/metas"
                className="flex items-center gap-2 self-start rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300 transition hover:border-tamagochi-500/30 hover:bg-white/10 sm:self-auto"
              >
                <Settings size={16} />
                Metas
              </Link>
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
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl sm:p-8">

              {/* Progresso geral do dia */}
              <div className="mb-6 border-b border-white/5 pb-6">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-tamagochi-300">Progresso de hoje</p>
                    <p className="mt-1 text-sm text-slate-400">{completedToday} de 7 hábitos completos</p>
                  </div>
                  <p className={`text-4xl font-bold ${scoreColor}`}>{overallScore}%</p>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-tamagochi-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${overallScore}%` }}
                  />
                </div>
                <div className="mt-2 text-right">
                  <DeltaVs current={overallScore} prev={yesterdayScore} fmtAbs={v => `${v}%`} vs="ontem" />
                </div>
              </div>

              <div className="divide-y divide-white/5">

                {/* Água */}
                <HabitRow
                  icon={Droplet} iconColor="text-blue-400" bubbleBg="bg-blue-500/15" barColor="bg-blue-500"
                  label="Água"
                  valueNode={
                    <span className="text-sm text-slate-400">
                      <span className="font-bold text-white">{fmtNum(todayData.water_ml)}</span> / {fmtNum(goals.water_ml)} ml
                      <span className="ml-2 font-bold text-blue-400">{Math.round(pct(todayData.water_ml, goals.water_ml))}%</span>
                    </span>
                  }
                  pctVal={pct(todayData.water_ml, goals.water_ml)}
                  streak={streaks.water}
                  yesterdayNode={<DeltaVs current={todayData.water_ml} prev={yesterdayData.water_ml} fmtAbs={v => `${fmtNum(v)} ml`} vs="ontem" />}
                  controls={
                    <div className="flex flex-wrap items-center gap-2">
                      <QuickAdd
                        options={[{ label: '250ml', value: 250 }, { label: '500ml', value: 500 }, { label: '750ml', value: 750 }, { label: '1L', value: 1000 }]}
                        onAdd={addWater}
                        disabled={busy}
                        label="+"
                      />
                      <button
                        onClick={subtractWater}
                        disabled={busy || todayData.water_ml === 0}
                        className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-blue-500/30 hover:text-blue-300 disabled:opacity-30"
                      >
                        −250ml
                      </button>
                    </div>
                  }
                />

                {/* Passos — sincronizado automaticamente */}
                <HabitRow
                  icon={Footprints} iconColor="text-emerald-400" bubbleBg="bg-emerald-500/15" barColor="bg-emerald-500"
                  label="Passos"
                  valueNode={
                    <span className="text-sm text-slate-400">
                      <span className="font-bold text-white">{fmtNum(todayData.steps)}</span> / {fmtNum(goals.steps)}
                      <span className="ml-2 font-bold text-emerald-400">{Math.round(pct(todayData.steps, goals.steps))}%</span>
                    </span>
                  }
                  pctVal={pct(todayData.steps, goals.steps)}
                  streak={streaks.steps}
                  yesterdayNode={<DeltaVs current={todayData.steps} prev={yesterdayData.steps} fmtAbs={fmtNum} vs="ontem" />}
                />

                {/* Leitura — atualizada via sessões de leitura */}
                <HabitRow
                  icon={BookOpen} iconColor="text-amber-400" bubbleBg="bg-amber-500/15" barColor="bg-amber-500"
                  label="Leitura"
                  valueNode={
                    <span className="text-sm text-slate-400">
                      <span className="font-bold text-white">{todayData.reading_pages}</span> / {goals.reading_pages} páginas
                      <span className="ml-2 font-bold text-amber-400">{Math.round(pct(todayData.reading_pages, goals.reading_pages))}%</span>
                    </span>
                  }
                  pctVal={pct(todayData.reading_pages, goals.reading_pages)}
                  streak={streaks.reading}
                  yesterdayNode={<DeltaVs current={todayData.reading_pages} prev={yesterdayData.reading_pages} fmtAbs={v => `${v} págs`} vs="ontem" />}
                />

                {/* Academia — só fui hoje ou não */}
                <HabitRow
                  icon={Dumbbell} iconColor="text-rose-400" bubbleBg="bg-rose-500/15" barColor="bg-rose-500"
                  label="Academia"
                  valueNode={
                    <span className={`text-sm font-semibold ${todayData.gym_done ? 'text-rose-300' : 'text-slate-500'}`}>
                      {todayData.gym_done ? 'Fui hoje' : 'Ainda não fui'}
                    </span>
                  }
                  pctVal={todayData.gym_done ? 100 : 0}
                  streak={streaks.gym}
                  yesterdayNode={yesterdayBool(yesterdayData.gym_done)}
                  controls={
                    <button
                      onClick={toggleGym}
                      disabled={busy}
                      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50
                        ${todayData.gym_done
                          ? 'border border-rose-500/30 bg-rose-500/20 text-rose-300 hover:bg-rose-500/10'
                          : 'border border-white/10 bg-slate-900/60 text-slate-400 hover:border-rose-500/30 hover:bg-rose-900/20 hover:text-rose-300'
                        }`}
                    >
                      {todayData.gym_done ? <><Check size={15} /> Fui hoje!</> : <><X size={15} /> Marcar treino</>}
                    </button>
                  }
                />

                {/* Creatina */}
                <HabitRow
                  icon={Pill} iconColor="text-purple-400" bubbleBg="bg-purple-500/15" barColor="bg-purple-500"
                  label="Creatina"
                  valueNode={
                    <span className={`text-sm font-semibold ${todayData.creatine_done ? 'text-purple-300' : 'text-slate-500'}`}>
                      {todayData.creatine_done ? 'Tomei hoje' : 'Ainda não tomei'}
                    </span>
                  }
                  pctVal={todayData.creatine_done ? 100 : 0}
                  streak={streaks.creatine}
                  yesterdayNode={yesterdayBool(yesterdayData.creatine_done)}
                  controls={
                    <button
                      onClick={toggleCreatine}
                      disabled={busy}
                      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-50
                        ${todayData.creatine_done
                          ? 'border border-purple-500/30 bg-purple-500/20 text-purple-300 hover:bg-purple-500/10'
                          : 'border border-white/10 bg-slate-900/60 text-slate-400 hover:border-purple-500/30 hover:bg-purple-900/20 hover:text-purple-300'
                        }`}
                    >
                      {todayData.creatine_done ? <><Check size={15} /> Tomei hoje!</> : <><X size={15} /> Marcar creatina</>}
                    </button>
                  }
                />

                {/* Estudo */}
                <HabitRow
                  icon={GraduationCap} iconColor="text-violet-400" bubbleBg="bg-violet-500/15" barColor="bg-violet-500"
                  label="Estudo"
                  valueNode={
                    <span className="text-sm text-slate-400">
                      <span className="font-bold text-white">{fmtStudy(todayData.study_minutes)}</span> / {fmtStudy(goals.study_minutes)}
                      <span className="ml-2 font-bold text-violet-400">{Math.round(pct(todayData.study_minutes, goals.study_minutes))}%</span>
                    </span>
                  }
                  pctVal={pct(todayData.study_minutes, goals.study_minutes)}
                  streak={streaks.study}
                  yesterdayNode={<DeltaVs current={todayData.study_minutes} prev={yesterdayData.study_minutes} fmtAbs={fmtStudy} vs="ontem" />}
                />

                {/* Meditação */}
                <HabitRow
                  icon={Wind} iconColor="text-teal-400" bubbleBg="bg-teal-500/15" barColor="bg-teal-500"
                  label="Meditação"
                  valueNode={
                    <span className="text-sm text-slate-400">
                      <span className="font-bold text-white">{fmtStudy(todayData.meditation_minutes)}</span> / {fmtStudy(goals.meditation_minutes)}
                      <span className="ml-2 font-bold text-teal-400">{Math.round(pct(todayData.meditation_minutes, goals.meditation_minutes))}%</span>
                    </span>
                  }
                  pctVal={pct(todayData.meditation_minutes, goals.meditation_minutes)}
                  streak={streaks.meditation}
                  yesterdayNode={<DeltaVs current={todayData.meditation_minutes} prev={yesterdayData.meditation_minutes} fmtAbs={fmtStudy} vs="ontem" />}
                />

              </div>
            </div>
          )}

          {/* ── SEMANA ────────────────────────────────────────────────────── */}
          {tab === 'semana' && (() => {
            const semStart = weekDates[0].split('-').reverse().slice(0, 2).join('/');
            const semEnd = weekDates[6].split('-').reverse().slice(0, 2).join('/');

            // Compare against the same elapsed period of last week (Mon..same weekday)
            const elapsed = weekDates.filter(d => d <= today).length;
            const prevTotalFor = (get: (d: DailyData) => number) =>
              lastWeekDates.slice(0, elapsed).reduce((a, k) => a + get(lastWeekData[k] ?? emptyDay()), 0);
            const gymDaysLastWeek = lastWeekDates.slice(0, elapsed).filter(d => lastWeekData[d]?.gym_done).length;
            const creatineDaysThisWeek = weekDates.filter(d => getDayData(d).creatine_done).length;
            const creatineDaysLastWeek = lastWeekDates.slice(0, elapsed).filter(d => lastWeekData[d]?.creatine_done).length;
            const fmtDias = (v: number) => `${v} ${v === 1 ? 'dia' : 'dias'}`;

            return (
              <div className="space-y-4">
                <p className="px-1 text-sm uppercase tracking-widest text-tamagochi-300">
                  Semana {semStart} – {semEnd} · comparativo com o mesmo período da semana passada
                </p>

                {/* Quantitative habits — bar charts */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <WeekBarChart
                    label="Água" icon={Droplet} iconColor="text-blue-400"
                    fullCls="bg-blue-500/80" partialCls="bg-blue-500/35"
                    weekDates={weekDates} today={today}
                    getDayValue={d => getDayData(d).water_ml}
                    goal={goals.water_ml}
                    formatTotal={v => `${fmtNum(v)} ml`}
                    prevTotal={prevTotalFor(d => d.water_ml)}
                  />
                  <WeekBarChart
                    label="Passos" icon={Footprints} iconColor="text-emerald-400"
                    fullCls="bg-emerald-500/80" partialCls="bg-emerald-500/35"
                    weekDates={weekDates} today={today}
                    getDayValue={d => getDayData(d).steps}
                    goal={goals.steps}
                    formatTotal={v => fmtNum(v)}
                    prevTotal={prevTotalFor(d => d.steps)}
                  />
                  <WeekBarChart
                    label="Leitura" icon={BookOpen} iconColor="text-amber-400"
                    fullCls="bg-amber-500/80" partialCls="bg-amber-500/35"
                    weekDates={weekDates} today={today}
                    getDayValue={d => getDayData(d).reading_pages}
                    goal={goals.reading_pages}
                    formatTotal={v => `${v} págs`}
                    prevTotal={prevTotalFor(d => d.reading_pages)}
                  />
                  <WeekBarChart
                    label="Estudo" icon={GraduationCap} iconColor="text-violet-400"
                    fullCls="bg-violet-500/80" partialCls="bg-violet-500/35"
                    weekDates={weekDates} today={today}
                    getDayValue={d => getDayData(d).study_minutes}
                    goal={goals.study_minutes}
                    formatTotal={fmtStudy}
                    prevTotal={prevTotalFor(d => d.study_minutes)}
                  />
                  <WeekBarChart
                    label="Meditação" icon={Wind} iconColor="text-teal-400"
                    fullCls="bg-teal-500/80" partialCls="bg-teal-500/35"
                    weekDates={weekDates} today={today}
                    getDayValue={d => getDayData(d).meditation_minutes}
                    goal={goals.meditation_minutes}
                    formatTotal={fmtStudy}
                    prevTotal={prevTotalFor(d => d.meditation_minutes)}
                  />
                </div>

                {/* Boolean habits — day strips */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Dumbbell size={14} className="text-rose-400" />
                        <span className="text-sm font-medium text-slate-200">Academia</span>
                      </div>
                      <span className="text-sm font-bold text-rose-400">{gymDaysThisWeek}/{goals.gym_days_per_week} dias</span>
                    </div>
                    <div className="mb-3 text-right">
                      <DeltaVs current={gymDaysThisWeek} prev={gymDaysLastWeek} fmtAbs={fmtDias} vs="semana passada" />
                    </div>
                    <div className="mb-3 flex gap-1.5">
                      {weekDates.map((d, i) => {
                        const isFuture = d > today;
                        const done = d === today ? todayData.gym_done : (weekData[d]?.gym_done ?? false);
                        const isToday = d === today;
                        return (
                          <div key={d} className="flex flex-1 flex-col items-center gap-1">
                            <div className={[
                              'flex h-9 w-full items-center justify-center rounded-xl transition',
                              isFuture ? 'bg-slate-900/20' : done ? 'bg-rose-500/70' : 'bg-slate-900/50',
                              isToday ? 'ring-1 ring-white/30 ring-offset-1 ring-offset-[#08101a]' : '',
                            ].join(' ')}>
                              {!isFuture && done && <Check size={12} className="text-white/80" />}
                            </div>
                            <span className={`text-[9px] ${isToday ? 'text-tamagochi-300 font-semibold' : 'text-slate-500'}`}>
                              {DAY_PT[i][0]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <ProgressBar value={gymDaysThisWeek} goal={goals.gym_days_per_week} color="bg-rose-500" />
                  </div>

                  <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Pill size={14} className="text-purple-400" />
                        <span className="text-sm font-medium text-slate-200">Creatina</span>
                      </div>
                      {streaks.creatine.count > 0 && (
                        <div className="flex items-center gap-1">
                          <Flame size={12} className="text-purple-400" />
                          <span className="text-sm font-bold text-purple-300">
                            {streaks.creatine.count}{streaks.creatine.capped ? '+' : ''} dias
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="mb-3 text-right">
                      <DeltaVs current={creatineDaysThisWeek} prev={creatineDaysLastWeek} fmtAbs={fmtDias} vs="semana passada" />
                    </div>
                    <div className="mb-3 flex gap-1.5">
                      {weekDates.map((d, i) => {
                        const isFuture = d > today;
                        const done = d === today ? todayData.creatine_done : (weekData[d]?.creatine_done ?? false);
                        const isToday = d === today;
                        return (
                          <div key={d} className="flex flex-1 flex-col items-center gap-1">
                            <div className={[
                              'flex h-9 w-full items-center justify-center rounded-xl transition',
                              isFuture ? 'bg-slate-900/20' : done ? 'bg-purple-500/70' : 'bg-slate-900/50',
                              isToday ? 'ring-1 ring-white/30 ring-offset-1 ring-offset-[#08101a]' : '',
                            ].join(' ')}>
                              {!isFuture && done && <Check size={12} className="text-white/80" />}
                            </div>
                            <span className={`text-[9px] ${isToday ? 'text-tamagochi-300 font-semibold' : 'text-slate-500'}`}>
                              {DAY_PT[i][0]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-500">
                      {creatineDaysThisWeek} / 7 dias esta semana
                    </p>
                  </div>
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

            // Same period of last month (days 1..daysElapsed)
            const prevRef = new Date(year, month - 1, 1);
            const prevYear = prevRef.getFullYear();
            const prevMonth = prevRef.getMonth();
            const prevDaysInMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
            const prevStats = monthlyStats(monthData, prevYear, prevMonth, Math.min(daysElapsed, prevDaysInMonth));
            const fmtDias = (v: number) => `${v} ${v === 1 ? 'dia' : 'dias'}`;

            const firstDow = new Date(year, month, 1).getDay();
            const firstDayOffset = firstDow === 0 ? 6 : firstDow - 1;
            const heatDays = Array.from({ length: daysInMonth }, (_, i) => {
              const k = dateStr(new Date(year, month, i + 1));
              return { k, day: i + 1, isFuture: k > today, data: mergedMonth[k] ?? emptyDay() };
            });

            return (
              <div className="space-y-4">
                {/* Summary cards */}
                <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                  <p className="mb-1 text-sm uppercase tracking-widest text-tamagochi-300">
                    {MONTH_PT[month]} {year} · {stats.daysLogged} dias registrados
                  </p>
                  <p className="mb-6 text-xs text-slate-500">
                    Comparativo com 1–{Math.min(daysElapsed, prevDaysInMonth)} de {MONTH_PT[prevMonth]}
                  </p>

                  {!monthFetched ? (
                    <p className="text-center text-slate-400">Carregando dados do mês...</p>
                  ) : (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {[
                        { label: 'Água', icon: Droplet, color: 'text-blue-400', bg: 'bg-blue-500', value: `${fmtNum(stats.water)} ml`, sub: `Média: ${fmtNum(Math.round(stats.water / Math.max(stats.daysLogged, 1)))} ml/dia`, pctVal: pct(stats.water, goals.water_ml * daysElapsed), cur: stats.water, prev: prevStats.water, fmtAbs: (v: number) => `${fmtNum(v)} ml` },
                        { label: 'Passos', icon: Footprints, color: 'text-emerald-400', bg: 'bg-emerald-500', value: fmtNum(stats.steps), sub: `Média: ${fmtNum(Math.round(stats.steps / Math.max(stats.daysLogged, 1)))}/dia`, pctVal: pct(stats.steps, goals.steps * daysElapsed), cur: stats.steps, prev: prevStats.steps, fmtAbs: fmtNum },
                        { label: 'Leitura', icon: BookOpen, color: 'text-amber-400', bg: 'bg-amber-500', value: `${stats.pages} páginas`, sub: `Média: ${(stats.pages / Math.max(stats.daysLogged, 1)).toFixed(1)}/dia`, pctVal: pct(stats.pages, goals.reading_pages * daysElapsed), cur: stats.pages, prev: prevStats.pages, fmtAbs: (v: number) => `${v} págs` },
                        { label: 'Academia', icon: Dumbbell, color: 'text-rose-400', bg: 'bg-rose-500', value: `${stats.gym} dias`, sub: `Meta: ${Math.round(goals.gym_days_per_week * (daysElapsed / 7))} dias`, pctVal: pct(stats.gym, Math.max(1, Math.round(goals.gym_days_per_week * (daysElapsed / 7)))), cur: stats.gym, prev: prevStats.gym, fmtAbs: fmtDias },
                        { label: 'Creatina', icon: Pill, color: 'text-purple-400', bg: 'bg-purple-500', value: `${stats.creatine} dias`, sub: `de ${daysElapsed} dias`, pctVal: pct(stats.creatine, daysElapsed), cur: stats.creatine, prev: prevStats.creatine, fmtAbs: fmtDias },
                        { label: 'Estudo', icon: GraduationCap, color: 'text-violet-400', bg: 'bg-violet-500', value: fmtStudy(stats.study), sub: `Média: ${fmtStudy(Math.round(stats.study / Math.max(stats.daysLogged, 1)))}/dia`, pctVal: pct(stats.study, goals.study_minutes * daysElapsed), cur: stats.study, prev: prevStats.study, fmtAbs: fmtStudy },
                        { label: 'Meditação', icon: Wind, color: 'text-teal-400', bg: 'bg-teal-500', value: fmtStudy(stats.meditation), sub: `Média: ${fmtStudy(Math.round(stats.meditation / Math.max(stats.daysLogged, 1)))}/dia`, pctVal: pct(stats.meditation, goals.meditation_minutes * daysElapsed), cur: stats.meditation, prev: prevStats.meditation, fmtAbs: fmtStudy },
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
                            <p className="text-xs text-slate-400">{item.sub}</p>
                            <p className="mb-3 mt-1">
                              <DeltaVs current={item.cur} prev={item.prev} fmtAbs={item.fmtAbs} vs="mês passado" showPct />
                            </p>
                            <ProgressBar value={item.pctVal} goal={100} color={item.bg} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Heatmaps por hábito */}
                {monthFetched && (
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <MonthHeatmap
                      icon={Droplet} iconColor="text-blue-400" label="Água"
                      days={heatDays} firstDayOffset={firstDayOffset} today={today}
                      fullCls="bg-blue-500/80" midCls="bg-blue-500/40" lowCls="bg-blue-500/20"
                      getLevel={d => pct(d.water_ml, goals.water_ml) >= 100 ? 'full' : pct(d.water_ml, goals.water_ml) >= 50 ? 'mid' : d.water_ml > 0 ? 'low' : 'none'}
                    />
                    <MonthHeatmap
                      icon={Footprints} iconColor="text-emerald-400" label="Passos"
                      days={heatDays} firstDayOffset={firstDayOffset} today={today}
                      fullCls="bg-emerald-500/80" midCls="bg-emerald-500/40" lowCls="bg-emerald-500/20"
                      getLevel={d => pct(d.steps, goals.steps) >= 100 ? 'full' : pct(d.steps, goals.steps) >= 50 ? 'mid' : d.steps > 0 ? 'low' : 'none'}
                    />
                    <MonthHeatmap
                      icon={BookOpen} iconColor="text-amber-400" label="Leitura"
                      days={heatDays} firstDayOffset={firstDayOffset} today={today}
                      fullCls="bg-amber-500/80" midCls="bg-amber-500/40" lowCls="bg-amber-500/20"
                      getLevel={d => pct(d.reading_pages, goals.reading_pages) >= 100 ? 'full' : pct(d.reading_pages, goals.reading_pages) >= 50 ? 'mid' : d.reading_pages > 0 ? 'low' : 'none'}
                    />
                    <MonthHeatmap
                      icon={Dumbbell} iconColor="text-rose-400" label="Academia"
                      days={heatDays} firstDayOffset={firstDayOffset} today={today}
                      fullCls="bg-rose-500/80" midCls="bg-rose-500/80" lowCls="bg-rose-500/80"
                      getLevel={d => d.gym_done ? 'full' : 'none'}
                    />
                    <MonthHeatmap
                      icon={Pill} iconColor="text-purple-400" label="Creatina"
                      days={heatDays} firstDayOffset={firstDayOffset} today={today}
                      fullCls="bg-purple-500/80" midCls="bg-purple-500/80" lowCls="bg-purple-500/80"
                      getLevel={d => d.creatine_done ? 'full' : 'none'}
                    />
                    <MonthHeatmap
                      icon={GraduationCap} iconColor="text-violet-400" label="Estudo"
                      days={heatDays} firstDayOffset={firstDayOffset} today={today}
                      fullCls="bg-violet-500/80" midCls="bg-violet-500/40" lowCls="bg-violet-500/20"
                      getLevel={d => pct(d.study_minutes, goals.study_minutes) >= 100 ? 'full' : pct(d.study_minutes, goals.study_minutes) >= 50 ? 'mid' : d.study_minutes > 0 ? 'low' : 'none'}
                    />
                    <MonthHeatmap
                      icon={Wind} iconColor="text-teal-400" label="Meditação"
                      days={heatDays} firstDayOffset={firstDayOffset} today={today}
                      fullCls="bg-teal-500/80" midCls="bg-teal-500/40" lowCls="bg-teal-500/20"
                      getLevel={d => pct(d.meditation_minutes, goals.meditation_minutes) >= 100 ? 'full' : pct(d.meditation_minutes, goals.meditation_minutes) >= 50 ? 'mid' : d.meditation_minutes > 0 ? 'low' : 'none'}
                    />
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
                            { label: 'Meditação', icon: Wind, color: 'text-teal-400', fn: (d: DailyData) => pct(d.meditation_minutes, goals.meditation_minutes) },
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

                {yearFetched && (() => {
                  let water = 0, steps = 0, pages = 0, gym = 0, creatine = 0, study = 0, meditation = 0;
                  for (const [k, d] of Object.entries({ ...yearData, [today]: todayData })) {
                    if (k.startsWith(String(year)) && k <= today) {
                      water += d.water_ml;
                      steps += d.steps;
                      pages += d.reading_pages;
                      if (d.gym_done) gym++;
                      if (d.creatine_done) creatine++;
                      study += d.study_minutes;
                      meditation += d.meditation_minutes;
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
                          { label: 'Meditação total', icon: Wind, color: 'text-teal-400', value: fmtStudy(meditation) },
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
