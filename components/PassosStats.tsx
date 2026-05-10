'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { collection, doc, getDocs, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import {
  Footprints, Ruler, Flame, Trophy, Copy, Check, Wifi,
  ChevronLeft, ChevronRight, Upload, RefreshCw,
} from 'lucide-react';

const MONTHS_PT = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const WEEKDAYS = ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
const CHART_H = 100;

interface DayData { steps?: number; walking_distance_km?: number; }
type ViewPeriod = 'week' | 'month' | 'year';

interface BarData {
  key: string; label: string; steps: number; km: number;
  isToday?: boolean; isFuture?: boolean;
}

function toDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function getTodayStr() {
  const t = new Date();
  return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
}
function getWeekDates(offset = 0): string[] {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  });
}
function fmtSteps(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}
function calcStreak(allData: Record<string, DayData>, goal: number, today: string): number {
  let count = 0;
  const d = new Date(today + 'T12:00:00');
  while (true) {
    const str = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
    if ((allData[str]?.steps ?? 0) >= goal) { count++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return count;
}
function getFirstDayOffset(year: number, month: number) {
  const dow = new Date(year, month, 1).getDay();
  return dow === 0 ? 6 : dow - 1;
}
function stepsBg(steps: number, goal: number) {
  if (steps === 0) return 'border-white/5 bg-slate-900/40 text-slate-500';
  const p = steps / goal;
  if (p >= 1) return 'border-transparent bg-emerald-500/25 text-emerald-300';
  if (p >= 0.5) return 'border-transparent bg-amber-500/20 text-amber-300';
  return 'border-transparent bg-rose-500/15 text-rose-400';
}
function barColor(steps: number, goal: number) {
  if (steps === 0) return 'bg-slate-700/40';
  const p = steps / goal;
  if (p >= 1) return 'bg-emerald-500';
  if (p >= 0.5) return 'bg-amber-500';
  return 'bg-rose-500';
}
function getWeekLabel(dates: string[]) {
  if (!dates.length) return '';
  const first = new Date(dates[0] + 'T12:00:00');
  const last  = new Date(dates[6] + 'T12:00:00');
  if (first.getMonth() === last.getMonth())
    return `${first.getDate()}–${last.getDate()} ${MONTHS_SHORT[first.getMonth()]} ${first.getFullYear()}`;
  if (first.getFullYear() === last.getFullYear())
    return `${first.getDate()} ${MONTHS_SHORT[first.getMonth()]} – ${last.getDate()} ${MONTHS_SHORT[last.getMonth()]} ${first.getFullYear()}`;
  return `${first.getDate()} ${MONTHS_SHORT[first.getMonth()]} ${first.getFullYear()} – ${last.getDate()} ${MONTHS_SHORT[last.getMonth()]} ${last.getFullYear()}`;
}

function BarChart({ bars, maxVal, goalSteps, showGoalLine = false }: {
  bars: BarData[]; maxVal: number; goalSteps: number; showGoalLine?: boolean;
}) {
  const goalBottom = showGoalLine && maxVal > 0 && goalSteps <= maxVal
    ? (goalSteps / maxVal) * CHART_H : null;

  return (
    <div>
      <div className="relative flex items-end gap-px" style={{ height: CHART_H }}>
        {goalBottom !== null && (
          <div className="pointer-events-none absolute left-0 right-0 border-t border-dashed border-emerald-500/30"
            style={{ bottom: goalBottom }} />
        )}
        {bars.map(({ key, steps, isToday, isFuture }) => {
          const h = maxVal > 0 && steps > 0 && !isFuture
            ? Math.max((steps / maxVal) * CHART_H, 2) : 0;
          return (
            <div key={key} style={{ flex: 1, height: CHART_H, display: 'flex', alignItems: 'flex-end' }}>
              <div
                style={{ width: '100%', height: Math.max(h, 2) }}
                className={`rounded-t-sm transition-all duration-500 ${
                  steps > 0 && !isFuture
                    ? `${barColor(steps, goalSteps)}${isToday ? ' ring-1 ring-white/20' : ''}`
                    : 'bg-slate-800/30'
                }`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-px mt-1.5">
        {bars.map(({ key, label, isToday }) => (
          <div key={key} style={{ flex: 1 }}
            className={`text-center text-[9px] leading-none truncate ${
              isToday ? 'font-bold text-emerald-400' : 'text-slate-600'
            }`}>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PassosStats() {
  const { user } = useAuth();
  const todayStr = getTodayStr();

  const [allData, setAllData]       = useState<Record<string, DayData>>({});
  const [loading, setLoading]       = useState(true);
  const [goalSteps, setGoalSteps]   = useState(10000);
  const [currentYear, setCurrentYear]   = useState(new Date().getFullYear());
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [healthToken, setHealthToken]   = useState<string | null>(null);
  const [copied, setCopied]         = useState(false);
  const [origin, setOrigin]         = useState('');
  const [importing, setImporting]   = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [viewPeriod, setViewPeriod] = useState<ViewPeriod>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [logsSnap, goalsSnap, tokenSnap] = await Promise.all([
        getDocs(collection(db, 'users', user.uid, 'daily_logs')),
        getDoc(doc(db, 'users', user.uid, 'settings', 'goals')),
        getDoc(doc(db, 'health_tokens', user.uid)),
      ]);
      const data: Record<string, DayData> = {};
      logsSnap.docs.forEach(d => { data[d.id] = d.data() as DayData; });
      setAllData(data);
      if (goalsSnap.exists()) setGoalSteps(goalsSnap.data().steps ?? 10000);
      if (tokenSnap.exists()) {
        setHealthToken(tokenSnap.data().token);
      } else {
        const token = crypto.randomUUID();
        await setDoc(doc(db, 'health_tokens', user.uid), { token, userId: user.uid });
        setHealthToken(token);
      }
    } catch (e) {
      console.error('Erro ao carregar dados de passos:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── today ──────────────────────────────────────────────────────────────────
  const todaySteps = allData[todayStr]?.steps ?? 0;
  const todayKm    = allData[todayStr]?.walking_distance_km ?? 0;
  const stepsPct   = Math.min((todaySteps / goalSteps) * 100, 100);

  const streak  = useMemo(() => calcStreak(allData, goalSteps, todayStr), [allData, goalSteps, todayStr]);
  const bestDay = useMemo(() => {
    let best = { date: '', steps: 0 };
    for (const [date, d] of Object.entries(allData))
      if ((d.steps ?? 0) > best.steps) best = { date, steps: d.steps! };
    return best;
  }, [allData]);
  const totalKmAllTime = useMemo(
    () => Object.values(allData).reduce((a, d) => a + (d.walking_distance_km ?? 0), 0),
    [allData]
  );

  // ── month days (shared by calendar + month chart) ──────────────────────────
  const monthDays = useMemo(() => {
    const days = new Date(currentYear, currentMonth + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => {
      const date = toDateStr(currentYear, currentMonth, i + 1);
      return { date, day: i + 1, data: allData[date] ?? {} as DayData };
    });
  }, [allData, currentYear, currentMonth]);

  const firstDayOffset = useMemo(
    () => getFirstDayOffset(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  // ── chart bars ─────────────────────────────────────────────────────────────
  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  const weekBars = useMemo((): BarData[] =>
    weekDates.map((date, i) => ({
      key: date, label: WEEKDAYS[i],
      steps: allData[date]?.steps ?? 0,
      km:    allData[date]?.walking_distance_km ?? 0,
      isToday: date === todayStr, isFuture: date > todayStr,
    })), [weekDates, allData, todayStr]);

  const monthBars = useMemo((): BarData[] =>
    monthDays.map(({ date, day, data }) => ({
      key: date,
      label: day % 10 === 0 || day === 1 ? String(day) : '',
      steps: data.steps ?? 0,
      km:    data.walking_distance_km ?? 0,
      isToday: date === todayStr, isFuture: date > todayStr,
    })), [monthDays, todayStr]);

  const yearBars = useMemo((): BarData[] => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, m) => {
      const prefix  = `${currentYear}-${String(m + 1).padStart(2, '0')}`;
      const entries = Object.entries(allData).filter(([d]) => d.startsWith(prefix));
      const steps   = entries.reduce((s, [, d]) => s + (d.steps ?? 0), 0);
      const km      = entries.reduce((s, [, d]) => s + (d.walking_distance_km ?? 0), 0);
      const isFuture = currentYear > now.getFullYear() ||
        (currentYear === now.getFullYear() && m > now.getMonth());
      return { key: String(m), label: MONTHS_SHORT[m], steps, km, isFuture };
    });
  }, [allData, currentYear]);

  const chartBars = viewPeriod === 'week' ? weekBars : viewPeriod === 'month' ? monthBars : yearBars;
  const chartMax  = useMemo(
    () => Math.max(...chartBars.map(b => b.steps), goalSteps),
    [chartBars, goalSteps]
  );

  // ── period stats ───────────────────────────────────────────────────────────
  const periodStats = useMemo(() => {
    const active = chartBars.filter(b => !b.isFuture && b.steps > 0);
    const totalSteps = active.reduce((s, b) => s + b.steps, 0);
    const totalKm    = active.reduce((s, b) => s + b.km, 0);
    const n = active.length;
    return {
      totalSteps, totalKm, n,
      avgSteps: n > 0 ? Math.round(totalSteps / n) : 0,
      avgKm:    n > 0 ? totalKm / n : 0,
    };
  }, [chartBars]);

  // ── period navigation ──────────────────────────────────────────────────────
  const periodLabel = useMemo(() => {
    if (viewPeriod === 'week')  return getWeekLabel(weekDates);
    if (viewPeriod === 'month') return `${MONTHS_PT[currentMonth]} ${currentYear}`;
    return String(currentYear);
  }, [viewPeriod, weekDates, currentMonth, currentYear]);

  const now = new Date();
  const isAtCurrentPeriod =
    viewPeriod === 'week'  ? weekOffset >= 0 :
    viewPeriod === 'month' ? currentYear === now.getFullYear() && currentMonth === now.getMonth() :
    currentYear >= now.getFullYear();

  const prevPeriod = () => {
    if (viewPeriod === 'week') { setWeekOffset(o => o - 1); return; }
    if (viewPeriod === 'month') {
      if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
      else setCurrentMonth(m => m - 1);
    } else setCurrentYear(y => y - 1);
  };
  const nextPeriod = () => {
    if (isAtCurrentPeriod) return;
    if (viewPeriod === 'week') { setWeekOffset(o => o + 1); return; }
    if (viewPeriod === 'month') {
      if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
      else setCurrentMonth(m => m + 1);
    } else setCurrentYear(y => y + 1);
  };

  // calendar-only navigation (always navigates months)
  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentYear === now.getFullYear() && currentMonth === now.getMonth()) return;
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  const copyUrl = () => {
    if (!healthToken || !origin) return;
    navigator.clipboard.writeText(`${origin}/api/health/import?token=${healthToken}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !healthToken) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res  = await fetch(`/api/health/import?token=${healthToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });
      const data = await res.json();
      if (res.ok) {
        setImportResult(data.message ?? `✅ ${data.datesProcessed} dias importados`);
        await loadData();
      } else {
        setImportResult(`❌ ${data.error ?? 'Erro ao importar'}`);
      }
    } catch (err) {
      setImportResult(`❌ Erro: ${String(err)}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (loading) {
    return <div className="flex h-48 items-center justify-center text-slate-500">Carregando dados...</div>;
  }

  const avgLabel = viewPeriod === 'year' ? 'Méd./mês' : 'Méd./dia';

  return (
    <div className="space-y-5">

      {/* Refresh */}
      <div className="flex justify-end">
        <button onClick={loadData} disabled={loading}
          className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-400 transition hover:border-emerald-500/30 hover:text-emerald-300 disabled:opacity-40">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Atualizar
        </button>
      </div>

      {/* Today */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl sm:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <Footprints size={18} className="text-emerald-400" />
            <span className="font-semibold text-white">Passos hoje</span>
            <span className="ml-auto text-sm font-bold text-emerald-400">{Math.round(stepsPct)}%</span>
          </div>
          <p className="mb-3 text-4xl font-bold text-white">
            {todaySteps.toLocaleString('pt-BR')}
            <span className="ml-2 text-base font-normal text-slate-400">/ {goalSteps.toLocaleString('pt-BR')}</span>
          </p>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: `${stepsPct}%` }} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {todaySteps >= goalSteps ? '🎉 Meta batida hoje!' : `Faltam ${(goalSteps - todaySteps).toLocaleString('pt-BR')} passos`}
          </p>
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <Ruler size={18} className="text-cyan-400" />
            <span className="font-semibold text-white">Distância</span>
          </div>
          <p className="text-4xl font-bold text-white">
            {todayKm.toFixed(2)}<span className="ml-1 text-base font-normal text-slate-400">km</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">hoje</p>
        </div>
      </div>

      {/* Records */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2">
            <Flame size={15} className="text-orange-400" />
            <span className="text-sm font-medium text-slate-200">Sequência atual</span>
          </div>
          <p className="text-3xl font-bold text-white">
            {streak}<span className="ml-2 text-sm font-normal text-slate-400">dias com meta</span>
          </p>
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2">
            <Trophy size={15} className="text-yellow-400" />
            <span className="text-sm font-medium text-slate-200">Melhor dia</span>
          </div>
          <p className="text-3xl font-bold text-white">
            {bestDay.steps.toLocaleString('pt-BR')}<span className="ml-2 text-sm font-normal text-slate-400">passos</span>
          </p>
          {bestDay.date && (
            <p className="mt-1 text-xs text-slate-500">
              {new Date(bestDay.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
            </p>
          )}
        </div>
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
          <div className="mb-2 flex items-center gap-2">
            <Ruler size={15} className="text-cyan-400" />
            <span className="text-sm font-medium text-slate-200">Total percorrido</span>
          </div>
          <p className="text-3xl font-bold text-white">
            {totalKmAllTime.toFixed(0)}<span className="ml-2 text-sm font-normal text-slate-400">km</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">desde o início</p>
        </div>
      </div>

      {/* Period analysis */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
        {/* Tabs */}
        <div className="mb-5 flex gap-1 rounded-2xl border border-white/5 bg-slate-900/40 p-1">
          {(['week', 'month', 'year'] as ViewPeriod[]).map(p => (
            <button key={p} onClick={() => setViewPeriod(p)}
              className={`flex-1 rounded-xl py-1.5 text-xs font-medium transition ${
                viewPeriod === p ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {p === 'week' ? 'Semana' : p === 'month' ? 'Mês' : 'Ano'}
            </button>
          ))}
        </div>

        {/* Navigation */}
        <div className="mb-4 flex items-center justify-between">
          <button onClick={prevPeriod}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-emerald-500/30 hover:text-white">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium text-slate-200">{periodLabel}</span>
          <button onClick={nextPeriod} disabled={isAtCurrentPeriod}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-emerald-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Bar chart */}
        <BarChart bars={chartBars} maxVal={chartMax} goalSteps={goalSteps}
          showGoalLine={viewPeriod !== 'year'} />

        {/* Stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-white/5 pt-5">
          {[
            { label: 'Total Passos',     value: periodStats.totalSteps.toLocaleString('pt-BR'), unit: '' },
            { label: 'Distância Total',  value: periodStats.totalKm.toFixed(1), unit: 'km' },
            { label: `${avgLabel} Passos`, value: periodStats.avgSteps.toLocaleString('pt-BR'), unit: '' },
            { label: `${avgLabel} Dist.`,  value: periodStats.avgKm.toFixed(1), unit: 'km' },
          ].map(({ label, value, unit }) => (
            <div key={label} className="rounded-2xl border border-white/5 bg-slate-900/40 p-4">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-slate-600">{label}</p>
              <p className="text-xl font-bold text-white">
                {value}{unit && <span className="ml-1 text-sm font-normal text-slate-400">{unit}</span>}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-right text-[10px] text-slate-600">
          Média sobre {periodStats.n} {viewPeriod === 'year' ? 'meses' : 'dias'} com dados
        </p>
      </div>

      {/* Calendar */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
        <div className="mb-5 flex items-center justify-between">
          <button onClick={prevMonth}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-emerald-500/30 hover:text-white">
            <ChevronLeft size={16} />
          </button>
          <h3 className="text-sm font-medium text-slate-200">{MONTHS_PT[currentMonth]} {currentYear}</h3>
          <button onClick={nextMonth}
            disabled={currentYear === now.getFullYear() && currentMonth === now.getMonth()}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-emerald-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-30">
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="mb-2 grid grid-cols-7 gap-1">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-[10px] font-medium uppercase tracking-widest text-slate-600">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDayOffset }).map((_, i) => <div key={i} className="h-14" />)}
          {monthDays.map(({ date, day, data }) => {
            const steps    = data.steps ?? 0;
            const km       = data.walking_distance_km ?? 0;
            const isFuture = date > todayStr;
            const isToday  = date === todayStr;
            return (
              <div key={date}
                title={steps > 0 ? `${steps.toLocaleString('pt-BR')} passos · ${km.toFixed(2)} km` : undefined}
                className={[
                  'relative flex h-14 w-full flex-col items-center justify-center gap-px rounded-xl border text-xs font-medium transition',
                  isFuture ? 'border-white/5 text-slate-700' : stepsBg(steps, goalSteps),
                  isToday  ? 'ring-2 ring-emerald-400/60 ring-offset-1 ring-offset-[#08101a]' : '',
                ].join(' ')}>
                <span className="text-sm leading-none">{day}</span>
                {steps > 0 && !isFuture && (
                  <span className="text-[9px] leading-none opacity-70">{fmtSteps(steps)}</span>
                )}
                {km > 0 && !isFuture && (
                  <span className="text-[8px] leading-none opacity-50">{km.toFixed(1)}km</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-white/5 pt-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-500/25" /> Meta</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-500/20" /> Parcial</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-rose-500/15" /> Pouco</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-white/5 bg-slate-900/40" /> Sem dados</span>
        </div>
      </div>

      {/* Health Auto Export setup */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
        <div className="mb-3 flex items-center gap-2">
          <Wifi size={15} className="text-tamagochi-300" />
          <span className="text-sm font-medium text-slate-200">Health Auto Export Pro</span>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Sincronize automaticamente com o Apple Saúde. O app enviará os dados para este endpoint a cada sync.
        </p>

        {healthToken ? (
          <>
            <div className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-slate-500 break-all">
              {origin}/api/health/import?token=<span className="text-slate-300">{healthToken.slice(0, 12)}…</span>
            </div>
            <button onClick={copyUrl}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-tamagochi-500/30 bg-tamagochi-500/10 py-2.5 text-sm font-medium text-tamagochi-300 transition hover:bg-tamagochi-500/15">
              {copied ? <><Check size={13} /> Copiado!</> : <><Copy size={13} /> Copiar URL</>}
            </button>
            <div className="mt-3 border-t border-white/5 pt-3">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-600">Importar histórico</p>
              <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
              <button onClick={() => fileRef.current?.click()} disabled={importing}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/15 disabled:opacity-50">
                {importing
                  ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" /> Importando...</>
                  : <><Upload size={13} /> Selecionar JSON exportado</>}
              </button>
              {importResult && <p className="mt-2 text-center text-xs text-slate-400">{importResult}</p>}
            </div>
          </>
        ) : (
          <div className="h-10 animate-pulse rounded-xl bg-slate-900/60" />
        )}

        <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-600">Como configurar</p>
          {[
            'Abra o Health Auto Export Pro',
            'Vá em Export Destinations → Add Destination → REST API',
            'Cole a URL acima · Method: POST',
            'Em Metrics, selecione Steps e Walking + Running Distance',
            'Ative Auto Export e defina frequência (ex: a cada hora)',
            'Para importar histórico: toque em Export Now → All Data',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-tamagochi-500/15 text-[9px] font-bold text-tamagochi-400">{i + 1}</span>
              <span className="text-[11px] leading-snug text-slate-400">{step}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
