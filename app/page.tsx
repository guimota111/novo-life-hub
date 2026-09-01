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

// Sem teto — usado no ranking de "melhor semana" (beber 5000ml de meta 4000ml = 125%)
const pctUncapped = (val: number, goal: number) => (val / (goal || 1)) * 100;

const mondayOf = (dateKey: string): string => {
  const d = new Date(dateKey + 'T12:00:00');
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return dateStr(d);
};

const weekDatesFrom = (mondayKey: string): string[] => {
  const monday = new Date(mondayKey + 'T12:00:00');
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return dateStr(d);
  });
};

function habitScore(d: DailyData, goals: Goals) {
  const completed = [
    d.water_ml >= goals.water_ml,
    d.steps >= goals.steps,
    d.reading_pages >= goals.reading_pages,
    d.gym_done,
    d.creatine_done,
    d.study_minutes >= goals.study_minutes,
    d.meditation_minutes >= goals.meditation_minutes,
  ].filter(Boolean).length;
  const pctSum =
    pctUncapped(d.water_ml, goals.water_ml) +
    pctUncapped(d.steps, goals.steps) +
    pctUncapped(d.reading_pages, goals.reading_pages) +
    (d.gym_done ? 100 : 0) +
    (d.creatine_done ? 100 : 0) +
    pctUncapped(d.study_minutes, goals.study_minutes) +
    pctUncapped(d.meditation_minutes, goals.meditation_minutes);
  return { completed, pctSum };
}

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
          className="rounded-xl border border-white/10 bg-slate-900/60 px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-tamagochi-500/40 hover:bg-tamagochi-900/30 disabled:opacity-40 sm:px-3"
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
      <div className="flex items-start gap-4 sm:items-center">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${bubbleBg}`}>
          <Icon size={18} className={iconColor} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="font-semibold text-white">{label}</span>
            {valueNode}
          </div>
          <ProgressBar value={pctVal} goal={100} color={barColor} />
          {/* No celular a coluna da direita não cabe ao lado da barra: sequência
              e comparativo com ontem descem para baixo dela. */}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 sm:hidden">
            <StreakBadge count={streak.count} capped={streak.capped} />
            {yesterdayNode}
          </div>
        </div>
        <div className="hidden w-32 shrink-0 flex-col items-end gap-1 sm:flex">
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

// ── Month bar chart component (largo, uma linha por hábito) ────────────────────

function MonthBarChart({
  label, icon: Icon, iconColor, fullCls, partialCls,
  dates, today, getDayValue, goal, formatTotal,
  deltaCurrent, deltaPrev, compareLabel,
}: {
  label: string;
  icon: React.ElementType;
  iconColor: string;
  fullCls: string;
  partialCls: string;
  dates: string[];
  today: string;
  getDayValue: (dateKey: string) => number;
  goal: number;
  formatTotal: (v: number) => string;
  deltaCurrent: number;
  deltaPrev: number;
  compareLabel: string;
}) {
  const BAR_H = 90;
  const vals = dates.map(getDayValue);
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
        <DeltaVs current={deltaCurrent} prev={deltaPrev} fmtAbs={formatTotal} vs={compareLabel} showPct />
      </div>
      <div className="relative mb-1" style={{ height: `${BAR_H}px` }}>
        <div
          className="absolute left-0 right-0 border-t border-dashed border-white/20 pointer-events-none"
          style={{ bottom: `${(goal / maxVal) * BAR_H}px` }}
        />
        <div className="absolute inset-0 flex items-end gap-[2px]">
          {dates.map(d => {
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
      <div className="flex justify-between text-[9px] text-slate-500">
        <span>Dia 1</span>
        <span>Dia {dates.length}</span>
      </div>
    </div>
  );
}

// ── Month boolean strip (academia / creatina) ───────────────────────────────────

function MonthBoolStrip({
  label, icon: Icon, iconColor, activeCls,
  dates, today, getDayDone, total, goalLabel,
  deltaCurrent, deltaPrev, compareLabel,
}: {
  label: string;
  icon: React.ElementType;
  iconColor: string;
  activeCls: string;
  dates: string[];
  today: string;
  getDayDone: (dateKey: string) => boolean;
  total: string;
  goalLabel: string;
  deltaCurrent: number;
  deltaPrev: number;
  compareLabel: string;
}) {
  const fmtDias = (v: number) => `${v} ${v === 1 ? 'dia' : 'dias'}`;
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} className={iconColor} />
          <span className="text-sm font-medium text-slate-200">{label}</span>
        </div>
        <span className="text-sm font-bold text-slate-200">{total}{goalLabel}</span>
      </div>
      <div className="mb-3 text-right">
        <DeltaVs current={deltaCurrent} prev={deltaPrev} fmtAbs={fmtDias} vs={compareLabel} />
      </div>
      <div className="mb-1 flex gap-[2px]">
        {dates.map(d => {
          const isFuture = d > today;
          const done = getDayDone(d);
          const isToday = d === today;
          return (
            <div
              key={d}
              className={[
                'h-6 flex-1 rounded-sm transition',
                isFuture ? 'bg-slate-900/20' : done ? activeCls : 'bg-slate-900/50',
                isToday ? 'ring-1 ring-white/30 ring-offset-1 ring-offset-[#08101a]' : '',
              ].join(' ')}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-slate-500">
        <span>Dia 1</span>
        <span>Dia {dates.length}</span>
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
  const [weekCompareMode, setWeekCompareMode] = useState<'last' | 'best'>('last');
  const [monthCompareMode, setMonthCompareMode] = useState<'last' | 'best'>('last');
  const [allLogsData, setAllLogsData] = useState<Record<string, DailyData> | null>(null);
  const [allLogsLoading, setAllLogsLoading] = useState(false);

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

  // Carrega todo o histórico sob demanda (só quando "comparar com melhor semana" é usado)
  const loadAllLogs = useCallback(async () => {
    if (!user || allLogsData || allLogsLoading) return;
    setAllLogsLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'daily_logs'));
      const result: Record<string, DailyData> = {};
      snap.docs.forEach(d => { result[d.id] = { ...emptyDay(), ...(d.data() as Partial<DailyData>) }; });
      setAllLogsData(result);
    } finally {
      setAllLogsLoading(false);
    }
  }, [user, allLogsData, allLogsLoading]);

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

  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();
  const daysInCurMonth = new Date(curYear, curMonth + 1, 0).getDate();
  const daysElapsed = Math.min(parseInt(today.split('-')[2], 10), daysInCurMonth);

  const monthDayKeys = (year: number, month: number): string[] => {
    const days = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => dateStr(new Date(year, month, i + 1)));
  };

  const getMonthDay = (k: string): DailyData =>
    k === today ? todayData : (monthData[k] ?? allLogsData?.[k] ?? emptyDay());

  const buildMergedMonth = (year: number, month: number): Record<string, DailyData> => {
    const result: Record<string, DailyData> = {};
    monthDayKeys(year, month).forEach(k => { result[k] = getMonthDay(k); });
    return result;
  };

  const getDayData = (dateKey: string): DailyData =>
    dateKey === today ? todayData : (weekData[dateKey] ?? emptyDay());

  const gymDaysThisWeek = weekDates.filter(d =>
    d === today ? todayData.gym_done : (weekData[d]?.gym_done ?? false)
  ).length;

  // Melhor semana já registrada: mais hábitos completados (soma dos 7 dias),
  // com empate resolvido pela soma das porcentagens do dia (sem teto de 100%).
  const bestWeek = useMemo(() => {
    if (!allLogsData) return null;
    const currentMonday = weekDates[0];
    const merged: Record<string, DailyData> = { ...allLogsData, [today]: todayData };
    const mondays = Array.from(new Set(Object.keys(merged).map(mondayOf))).sort();

    let best: { dates: string[]; completed: number; pctSum: number } | null = null;
    for (const monday of mondays) {
      if (monday === currentMonday) continue;
      const dates = weekDatesFrom(monday);
      let completed = 0, pctSum = 0, hasData = false;
      for (const k of dates) {
        if (k > today) continue;
        const d = merged[k];
        if (!d) continue;
        if (d.water_ml || d.steps || d.reading_pages || d.gym_done || d.creatine_done || d.study_minutes || d.meditation_minutes) hasData = true;
        const score = habitScore(d, goals);
        completed += score.completed;
        pctSum += score.pctSum;
      }
      if (!hasData) continue;
      if (!best || completed > best.completed || (completed === best.completed && pctSum > best.pctSum)) {
        best = { dates, completed, pctSum };
      }
    }
    return best;
  }, [allLogsData, weekDates, today, todayData, goals]);

  const isBestWeekMode = weekCompareMode === 'best' && !!bestWeek;
  const displayWeekDates = isBestWeekMode ? bestWeek!.dates : weekDates;
  const getDisplayDay = (k: string): DailyData =>
    isBestWeekMode ? (allLogsData?.[k] ?? emptyDay()) : getDayData(k);
  const weekCompareLabel = isBestWeekMode ? 'semana atual' : 'semana passada';

  // Melhor mês já registrado: mesma lógica da melhor semana, mas olhando só
  // os primeiros N dias de cada mês (N = dias já passados do mês atual), pra
  // comparar períodos equivalentes.
  const bestMonth = useMemo(() => {
    if (!allLogsData) return null;
    const merged: Record<string, DailyData> = { ...allLogsData, [today]: todayData };
    const currentYm = `${curYear}-${String(curMonth + 1).padStart(2, '0')}`;
    const yms = Array.from(new Set(Object.keys(merged).map(k => k.slice(0, 7)))).sort();

    let best: { year: number; month: number; completed: number; pctSum: number } | null = null;
    for (const ym of yms) {
      if (ym === currentYm) continue;
      const [yy, mm] = ym.split('-').map(Number);
      const y = yy, m = mm - 1;
      const daysInM = new Date(y, m + 1, 0).getDate();
      const windowLen = Math.min(daysElapsed, daysInM);
      let completed = 0, pctSum = 0, hasData = false;
      for (let d = 1; d <= windowLen; d++) {
        const k = dateStr(new Date(y, m, d));
        const day = merged[k];
        if (!day) continue;
        if (day.water_ml || day.steps || day.reading_pages || day.gym_done || day.creatine_done || day.study_minutes || day.meditation_minutes) hasData = true;
        const score = habitScore(day, goals);
        completed += score.completed;
        pctSum += score.pctSum;
      }
      if (!hasData) continue;
      if (!best || completed > best.completed || (completed === best.completed && pctSum > best.pctSum)) {
        best = { year: y, month: m, completed, pctSum };
      }
    }
    return best;
  }, [allLogsData, today, todayData, goals, curYear, curMonth, daysElapsed]);

  const isBestMonthMode = monthCompareMode === 'best' && !!bestMonth;
  const dispMonthYear = isBestMonthMode ? bestMonth!.year : curYear;
  const dispMonthMonth = isBestMonthMode ? bestMonth!.month : curMonth;
  const monthCompareLabel = isBestMonthMode ? 'mês atual' : 'mês passado';

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

        <section className="min-w-0 flex-1 space-y-6">
          {/* Header */}
          <header className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-tamagochi-300">Tamagochi Me</p>
                <h1 className="text-3xl font-semibold text-white sm:text-4xl">Visão do Dia</h1>
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
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur-xl sm:p-8">

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
                        className="rounded-xl border border-white/10 bg-slate-900/60 px-2.5 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-blue-500/30 hover:text-blue-300 disabled:opacity-30 sm:px-3"
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
            const dispStart = displayWeekDates[0].split('-').reverse().slice(0, 2).join('/');
            const dispEnd = displayWeekDates[6].split('-').reverse().slice(0, 2).join('/');

            // Modo padrão: compara com o mesmo período elapsed da semana passada.
            // Modo "melhor semana": exibe a melhor semana e compara com a semana atual (completa).
            const elapsed = weekDates.filter(d => d <= today).length;
            const prevTotalFor = (get: (d: DailyData) => number) =>
              isBestWeekMode
                ? weekDates.reduce((a, k) => a + get(getDayData(k)), 0)
                : lastWeekDates.slice(0, elapsed).reduce((a, k) => a + get(lastWeekData[k] ?? emptyDay()), 0);

            const creatineDaysCurrentWeek = weekDates.filter(d => getDayData(d).creatine_done).length;
            const gymDaysDisplay = displayWeekDates.filter(d => getDisplayDay(d).gym_done).length;
            const creatineDaysDisplay = displayWeekDates.filter(d => getDisplayDay(d).creatine_done).length;
            const gymDaysCompareVal = isBestWeekMode
              ? gymDaysThisWeek
              : lastWeekDates.slice(0, elapsed).filter(d => lastWeekData[d]?.gym_done).length;
            const creatineDaysCompareVal = isBestWeekMode
              ? creatineDaysCurrentWeek
              : lastWeekDates.slice(0, elapsed).filter(d => lastWeekData[d]?.creatine_done).length;
            const fmtDias = (v: number) => `${v} ${v === 1 ? 'dia' : 'dias'}`;

            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  <p className="text-sm uppercase tracking-widest text-tamagochi-300">
                    {isBestWeekMode ? `Sua melhor semana: ${dispStart} – ${dispEnd}` : `Semana ${dispStart} – ${dispEnd}`}
                    {' '}· comparativo com {weekCompareLabel}
                  </p>
                  <button
                    onClick={() => {
                      if (weekCompareMode === 'last') { loadAllLogs(); setWeekCompareMode('best'); }
                      else setWeekCompareMode('last');
                    }}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-tamagochi-500/40 hover:bg-tamagochi-900/20"
                  >
                    {weekCompareMode === 'best' ? 'Voltar à semana atual' : 'Comparar com melhor semana'}
                  </button>
                </div>
                {weekCompareMode === 'best' && !bestWeek && (
                  <p className="px-1 text-xs text-slate-500">
                    {allLogsLoading ? 'Procurando sua melhor semana…' : 'Ainda não há outra semana registrada para comparar.'}
                  </p>
                )}

                {/* Quantitative habits — bar charts */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <WeekBarChart
                    label="Água" icon={Droplet} iconColor="text-blue-400"
                    fullCls="bg-blue-500/80" partialCls="bg-blue-500/35"
                    weekDates={displayWeekDates} today={today}
                    getDayValue={d => getDisplayDay(d).water_ml}
                    goal={goals.water_ml}
                    formatTotal={v => `${fmtNum(v)} ml`}
                    prevTotal={prevTotalFor(d => d.water_ml)}
                  />
                  <WeekBarChart
                    label="Passos" icon={Footprints} iconColor="text-emerald-400"
                    fullCls="bg-emerald-500/80" partialCls="bg-emerald-500/35"
                    weekDates={displayWeekDates} today={today}
                    getDayValue={d => getDisplayDay(d).steps}
                    goal={goals.steps}
                    formatTotal={v => fmtNum(v)}
                    prevTotal={prevTotalFor(d => d.steps)}
                  />
                  <WeekBarChart
                    label="Leitura" icon={BookOpen} iconColor="text-amber-400"
                    fullCls="bg-amber-500/80" partialCls="bg-amber-500/35"
                    weekDates={displayWeekDates} today={today}
                    getDayValue={d => getDisplayDay(d).reading_pages}
                    goal={goals.reading_pages}
                    formatTotal={v => `${v} págs`}
                    prevTotal={prevTotalFor(d => d.reading_pages)}
                  />
                  <WeekBarChart
                    label="Estudo" icon={GraduationCap} iconColor="text-violet-400"
                    fullCls="bg-violet-500/80" partialCls="bg-violet-500/35"
                    weekDates={displayWeekDates} today={today}
                    getDayValue={d => getDisplayDay(d).study_minutes}
                    goal={goals.study_minutes}
                    formatTotal={fmtStudy}
                    prevTotal={prevTotalFor(d => d.study_minutes)}
                  />
                  <WeekBarChart
                    label="Meditação" icon={Wind} iconColor="text-teal-400"
                    fullCls="bg-teal-500/80" partialCls="bg-teal-500/35"
                    weekDates={displayWeekDates} today={today}
                    getDayValue={d => getDisplayDay(d).meditation_minutes}
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
                      <span className="text-sm font-bold text-rose-400">{gymDaysDisplay}/{goals.gym_days_per_week} dias</span>
                    </div>
                    <div className="mb-3 text-right">
                      <DeltaVs current={gymDaysDisplay} prev={gymDaysCompareVal} fmtAbs={fmtDias} vs={weekCompareLabel} />
                    </div>
                    <div className="mb-3 flex gap-1.5">
                      {displayWeekDates.map((d, i) => {
                        const isFuture = d > today;
                        const done = getDisplayDay(d).gym_done;
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
                    <ProgressBar value={gymDaysDisplay} goal={goals.gym_days_per_week} color="bg-rose-500" />
                  </div>

                  <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Pill size={14} className="text-purple-400" />
                        <span className="text-sm font-medium text-slate-200">Creatina</span>
                      </div>
                      {!isBestWeekMode && streaks.creatine.count > 0 && (
                        <div className="flex items-center gap-1">
                          <Flame size={12} className="text-purple-400" />
                          <span className="text-sm font-bold text-purple-300">
                            {streaks.creatine.count}{streaks.creatine.capped ? '+' : ''} dias
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="mb-3 text-right">
                      <DeltaVs current={creatineDaysDisplay} prev={creatineDaysCompareVal} fmtAbs={fmtDias} vs={weekCompareLabel} />
                    </div>
                    <div className="mb-3 flex gap-1.5">
                      {displayWeekDates.map((d, i) => {
                        const isFuture = d > today;
                        const done = getDisplayDay(d).creatine_done;
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
                      {creatineDaysDisplay} / 7 dias {isBestWeekMode ? 'nessa semana' : 'esta semana'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── MÊS ───────────────────────────────────────────────────────── */}
          {tab === 'mes' && (() => {
            const dispDates = monthDayKeys(dispMonthYear, dispMonthMonth);
            const dispMerged = buildMergedMonth(dispMonthYear, dispMonthMonth);
            const stats = monthlyStats(dispMerged, dispMonthYear, dispMonthMonth);

            const prevRef = new Date(curYear, curMonth - 1, 1);
            const otherYear = isBestMonthMode ? curYear : prevRef.getFullYear();
            const otherMonth = isBestMonthMode ? curMonth : prevRef.getMonth();
            const otherDaysInMonth = new Date(otherYear, otherMonth + 1, 0).getDate();
            const windowLen = Math.min(daysElapsed, dispDates.length, otherDaysInMonth);

            const otherMerged = buildMergedMonth(otherYear, otherMonth);
            const windowStats = monthlyStats(dispMerged, dispMonthYear, dispMonthMonth, windowLen);
            const otherStats = monthlyStats(otherMerged, otherYear, otherMonth, windowLen);

            // "Totais do mês" é sempre o mês atual de fato (independe de estar
            // exibindo o melhor mês nos gráficos acima), comparado com o mesmo
            // período do mês passado ou do melhor mês, e projetado pro mês inteiro.
            const curMonthTotals = isBestMonthMode ? otherStats : windowStats;
            const compareMonthTotals = isBestMonthMode ? windowStats : otherStats;
            const projFactor = daysElapsed > 0 ? daysInCurMonth / daysElapsed : 1;
            const fmtLitros = (v: number) => `${(v / 1000).toFixed(1)} L`;
            const fmtDiasR = (v: number) => `${Math.round(v)} ${Math.round(v) === 1 ? 'dia' : 'dias'}`;
            const fmtPaginas = (v: number) => `${Math.round(v)} páginas`;
            const fmtStudyR = (v: number) => fmtStudy(Math.round(v));
            const fmtNumR = (v: number) => fmtNum(Math.round(v));

            const monthTotalsItems = [
              { label: 'Água consumida', icon: Droplet, color: 'text-blue-400', cur: curMonthTotals.water, compare: compareMonthTotals.water, fmtVal: fmtLitros },
              { label: 'Passos dados', icon: Footprints, color: 'text-emerald-400', cur: curMonthTotals.steps, compare: compareMonthTotals.steps, fmtVal: fmtNumR },
              { label: 'Páginas lidas', icon: BookOpen, color: 'text-amber-400', cur: curMonthTotals.pages, compare: compareMonthTotals.pages, fmtVal: fmtPaginas },
              { label: 'Dias de treino', icon: Dumbbell, color: 'text-rose-400', cur: curMonthTotals.gym, compare: compareMonthTotals.gym, fmtVal: fmtDiasR },
              { label: 'Creatina tomada', icon: Pill, color: 'text-purple-400', cur: curMonthTotals.creatine, compare: compareMonthTotals.creatine, fmtVal: fmtDiasR },
              { label: 'Horas de estudo', icon: GraduationCap, color: 'text-violet-400', cur: curMonthTotals.study, compare: compareMonthTotals.study, fmtVal: fmtStudyR },
              { label: 'Meditação total', icon: Wind, color: 'text-teal-400', cur: curMonthTotals.meditation, compare: compareMonthTotals.meditation, fmtVal: fmtStudyR },
            ];

            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  <div>
                    <p className="text-sm uppercase tracking-widest text-tamagochi-300">
                      {isBestMonthMode ? 'Seu melhor mês: ' : ''}{MONTH_PT[dispMonthMonth]} {dispMonthYear}
                      {' '}· {stats.daysLogged} dias registrados
                    </p>
                    <p className="text-xs text-slate-500">
                      Comparativo dos primeiros {windowLen} dias vs {MONTH_PT[otherMonth]} {otherYear}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (monthCompareMode === 'last') { loadAllLogs(); setMonthCompareMode('best'); }
                      else setMonthCompareMode('last');
                    }}
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-tamagochi-500/40 hover:bg-tamagochi-900/20"
                  >
                    {monthCompareMode === 'best' ? 'Voltar ao mês atual' : 'Comparar com melhor mês'}
                  </button>
                </div>
                {monthCompareMode === 'best' && !bestMonth && (
                  <p className="px-1 text-xs text-slate-500">
                    {allLogsLoading ? 'Procurando seu melhor mês…' : 'Ainda não há outro mês registrado para comparar.'}
                  </p>
                )}

                {!monthFetched ? (
                  <p className="text-center text-slate-400">Carregando dados do mês...</p>
                ) : (
                  <div className="space-y-4">
                    <MonthBarChart
                      label="Água" icon={Droplet} iconColor="text-blue-400"
                      fullCls="bg-blue-500/80" partialCls="bg-blue-500/35"
                      dates={dispDates} today={today} goal={goals.water_ml}
                      getDayValue={d => dispMerged[d]?.water_ml ?? 0}
                      formatTotal={v => `${fmtNum(v)} ml`}
                      deltaCurrent={windowStats.water} deltaPrev={otherStats.water} compareLabel={monthCompareLabel}
                    />
                    <MonthBarChart
                      label="Passos" icon={Footprints} iconColor="text-emerald-400"
                      fullCls="bg-emerald-500/80" partialCls="bg-emerald-500/35"
                      dates={dispDates} today={today} goal={goals.steps}
                      getDayValue={d => dispMerged[d]?.steps ?? 0}
                      formatTotal={fmtNum}
                      deltaCurrent={windowStats.steps} deltaPrev={otherStats.steps} compareLabel={monthCompareLabel}
                    />
                    <MonthBarChart
                      label="Leitura" icon={BookOpen} iconColor="text-amber-400"
                      fullCls="bg-amber-500/80" partialCls="bg-amber-500/35"
                      dates={dispDates} today={today} goal={goals.reading_pages}
                      getDayValue={d => dispMerged[d]?.reading_pages ?? 0}
                      formatTotal={v => `${v} págs`}
                      deltaCurrent={windowStats.pages} deltaPrev={otherStats.pages} compareLabel={monthCompareLabel}
                    />
                    <MonthBarChart
                      label="Estudo" icon={GraduationCap} iconColor="text-violet-400"
                      fullCls="bg-violet-500/80" partialCls="bg-violet-500/35"
                      dates={dispDates} today={today} goal={goals.study_minutes}
                      getDayValue={d => dispMerged[d]?.study_minutes ?? 0}
                      formatTotal={fmtStudy}
                      deltaCurrent={windowStats.study} deltaPrev={otherStats.study} compareLabel={monthCompareLabel}
                    />
                    <MonthBarChart
                      label="Meditação" icon={Wind} iconColor="text-teal-400"
                      fullCls="bg-teal-500/80" partialCls="bg-teal-500/35"
                      dates={dispDates} today={today} goal={goals.meditation_minutes}
                      getDayValue={d => dispMerged[d]?.meditation_minutes ?? 0}
                      formatTotal={fmtStudy}
                      deltaCurrent={windowStats.meditation} deltaPrev={otherStats.meditation} compareLabel={monthCompareLabel}
                    />
                    <MonthBoolStrip
                      label="Academia" icon={Dumbbell} iconColor="text-rose-400" activeCls="bg-rose-500/70"
                      dates={dispDates} today={today}
                      getDayDone={d => dispMerged[d]?.gym_done ?? false}
                      total={`${stats.gym}`} goalLabel=" dias"
                      deltaCurrent={windowStats.gym} deltaPrev={otherStats.gym} compareLabel={monthCompareLabel}
                    />
                    <MonthBoolStrip
                      label="Creatina" icon={Pill} iconColor="text-purple-400" activeCls="bg-purple-500/70"
                      dates={dispDates} today={today}
                      getDayDone={d => dispMerged[d]?.creatine_done ?? false}
                      total={`${stats.creatine}`} goalLabel=" dias"
                      deltaCurrent={windowStats.creatine} deltaPrev={otherStats.creatine} compareLabel={monthCompareLabel}
                    />

                    {/* Totais do mês */}
                    <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                      <p className="mb-1 text-sm uppercase tracking-widest text-tamagochi-300">Totais do mês</p>
                      <p className="mb-4 text-xs text-slate-500">
                        Projeção pelo ritmo dos primeiros {daysElapsed} {daysElapsed === 1 ? 'dia' : 'dias'} · comparado com {monthCompareLabel}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {monthTotalsItems.map(item => {
                          const Icon = item.icon;
                          const projected = item.cur * projFactor;
                          return (
                            <div key={item.label} className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
                              <div className="mb-2 flex items-center gap-3">
                                <Icon className={item.color} size={20} />
                                <div className="min-w-0">
                                  <p className="text-xs text-slate-400">{item.label}</p>
                                  <p className="font-bold text-white">{item.fmtVal(item.cur)}</p>
                                </div>
                              </div>
                              <p className="text-[11px] text-slate-500">Projeção p/ o mês: {item.fmtVal(projected)}</p>
                              <div className="mt-1">
                                <DeltaVs current={item.cur} prev={item.compare} fmtAbs={item.fmtVal} vs={monthCompareLabel} showPct />
                              </div>
                            </div>
                          );
                        })}
                      </div>
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
                      <p className="mb-2 text-[11px] text-slate-500 sm:hidden">deslize para o lado →</p>
                      <table className="w-full min-w-[600px] text-sm">
                        <thead>
                          <tr>
                            <th className="sticky left-0 z-10 w-24 bg-[#141c25] pb-3 pr-2 text-left text-xs font-medium text-slate-400 sm:w-28">Meta</th>
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
                                <td className="sticky left-0 z-10 bg-[#141c25] py-2 pr-3">
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
