'use client';

import Sidebar from '@/components/Sidebar';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { collection, doc, setDoc, increment, onSnapshot, getDocs } from 'firebase/firestore';
import { Droplet, History, ChevronDown } from 'lucide-react';

// ─── constants ────────────────────────────────────────────────────────────────

const META = 4000;
const DAYS_SHORT   = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function dStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmtMl(ml: number) {
  if (ml === 0) return '0ml';
  return ml >= 1000 ? `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)}L` : `${ml}ml`;
}

// ─── Bar chart component ──────────────────────────────────────────────────────

interface BarDatum {
  key: string;
  label: string;
  sublabel?: string;
  value: number;
  isHighlight?: boolean;
  isFuture?: boolean;
  isEmpty?: boolean;
}

function BarChart({
  data, maxVal, goalVal, height = 100, gapClass = 'gap-1',
}: {
  data: BarDatum[];
  maxVal: number;
  goalVal: number;
  height?: number;
  gapClass?: string;
}) {
  const goalPct = maxVal > 0 ? Math.min(goalVal / maxVal * 100, 97) : 50;

  return (
    <div className="relative" style={{ height }}>
      {/* Goal dashed line */}
      {maxVal > 0 && (
        <div className="pointer-events-none absolute left-0 right-0 flex items-center z-10"
          style={{ bottom: `${goalPct}%` }}>
          <div className="flex-1 border-t border-dashed border-cyan-500/25" />
          <span className="shrink-0 pl-1 text-[8px] text-cyan-500/50">meta</span>
        </div>
      )}

      {/* Bars */}
      <div className={`absolute inset-0 flex items-end ${gapClass}`}>
        {data.map(d => {
          const h = d.isFuture || d.isEmpty
            ? 2
            : d.value > 0
              ? Math.max(d.value / maxVal * 100, 3)
              : 2;
          const metGoal = d.value >= goalVal;

          let barCls: string;
          if (d.isEmpty || d.value === 0) {
            barCls = 'bg-slate-800/30';
          } else if (d.isHighlight) {
            barCls = 'bg-gradient-to-t from-blue-500 to-cyan-400';
          } else if (metGoal) {
            barCls = 'bg-blue-500/70';
          } else {
            barCls = 'bg-blue-900/60';
          }

          return (
            <div key={d.key}
              style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', position: 'relative' }}
              className="group/bar">
              {/* Tooltip */}
              {!d.isFuture && d.value > 0 && (
                <div className="pointer-events-none absolute bottom-full mb-1 left-1/2 -translate-x-1/2 z-20 opacity-0 group-hover/bar:opacity-100 transition-opacity">
                  <div className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 shadow-xl whitespace-nowrap">
                    <p className="text-[9px] font-semibold text-white">{fmtMl(d.value)}</p>
                    {d.sublabel && <p className="text-[8px] text-slate-400">{d.sublabel}</p>}
                  </div>
                </div>
              )}
              <div
                style={{ width: '85%', height: `${h}%` }}
                className={`rounded-t-md transition-all duration-500 ${barCls}`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HidratacaoPage() {
  const { user } = useAuth();

  const [loading,     setLoading]     = useState(false);
  const [mensagem,    setMensagem]    = useState('');
  const [showPassado, setShowPassado] = useState(false);

  const [waterToday, setWaterToday] = useState(0);
  const [allLogs,    setAllLogs]    = useState<Record<string, number>>({});

  const [mlPassado,   setMlPassado]   = useState('500');
  const [dataPassada, setDataPassada] = useState('');

  // ── Real-time today ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    const ref = doc(db, 'users', user.uid, 'daily_logs', todayStr());
    const unsub = onSnapshot(ref, snap => {
      setWaterToday(snap.exists() ? snap.data().water_ml || 0 : 0);
    });
    return () => unsub();
  }, [user]);

  // ── Historical logs ────────────────────────────────────────────────────────
  const loadLogs = useCallback(async () => {
    if (!user) return;
    const snap = await getDocs(collection(db, 'users', user.uid, 'daily_logs'));
    const logs: Record<string, number> = {};
    snap.docs.forEach(d => { if (d.data().water_ml) logs[d.id] = d.data().water_ml; });
    setAllLogs(logs);
  }, [user]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  // ── Add water ──────────────────────────────────────────────────────────────
  const addWater = async (ml: number, targetDate: string) => {
    if (!user) return;
    setLoading(true);
    setMensagem('');
    try {
      await setDoc(
        doc(db, 'users', user.uid, 'daily_logs', targetDate),
        { water_ml: increment(ml), updatedAt: new Date() },
        { merge: true }
      );
      if (targetDate !== todayStr()) {
        setAllLogs(prev => ({ ...prev, [targetDate]: (prev[targetDate] ?? 0) + ml }));
        setMensagem(`+${ml}ml adicionados para ${targetDate.split('-').reverse().join('/')}`);
        setDataPassada('');
        setMlPassado('500');
        setShowPassado(false);
        setTimeout(() => setMensagem(''), 4000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ── Combined log map (today from real-time) ────────────────────────────────
  const logs = useMemo(() => ({ ...allLogs, [todayStr()]: waterToday }), [allLogs, waterToday]);

  // ── Week data ──────────────────────────────────────────────────────────────
  const weekData = useMemo<BarDatum[]>(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      const str = dStr(d);
      return {
        key: str,
        label: DAYS_SHORT[d.getDay()],
        value: logs[str] ?? 0,
        isHighlight: i === 6,
      };
    });
  }, [logs]);

  const weekMax       = Math.max(...weekData.map(d => d.value), META);
  const weekTotal     = weekData.reduce((s, d) => s + d.value, 0);
  const weekGoalDays  = weekData.filter(d => d.value >= META).length;

  // ── Month data ─────────────────────────────────────────────────────────────
  const monthData = useMemo<BarDatum[]>(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = todayStr();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      const str = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isFuture = str > today;
      return {
        key: str,
        label: String(d),
        sublabel: `dia ${d}`,
        value: isFuture ? 0 : (logs[str] ?? 0),
        isHighlight: str === today,
        isFuture,
      };
    });
  }, [logs]);

  const monthMax       = Math.max(...monthData.filter(d => !d.isFuture).map(d => d.value), META);
  const monthTotal     = monthData.filter(d => !d.isFuture).reduce((s, d) => s + d.value, 0);
  const monthGoalDays  = monthData.filter(d => !d.isFuture && d.value >= META).length;
  const monthActiveDays = monthData.filter(d => !d.isFuture && d.value > 0).length;

  // ── Year data (avg/dia por mês) ────────────────────────────────────────────
  const yearData = useMemo<BarDatum[]>(() => {
    const year = new Date().getFullYear();
    const today = todayStr();
    const curMonth = new Date().getMonth();
    return Array.from({ length: 12 }, (_, m) => {
      const prefix = `${year}-${String(m+1).padStart(2,'0')}`;
      const daysInMonth = new Date(year, m + 1, 0).getDate();
      let total = 0; let active = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const str = `${prefix}-${String(d).padStart(2,'0')}`;
        if (str > today) break;
        const ml = logs[str] ?? 0;
        if (ml > 0) { total += ml; active++; }
      }
      const avg = active > 0 ? Math.round(total / active) : 0;
      return {
        key: String(m),
        label: MONTHS_SHORT[m],
        sublabel: active > 0 ? `${active} dias` : undefined,
        value: avg,
        isHighlight: m === curMonth,
        isEmpty: m > curMonth || active === 0,
      };
    });
  }, [logs]);

  const yearMax = Math.max(...yearData.map(d => d.value), META);
  const curMonth = new Date().getMonth();

  // ── Today progress ─────────────────────────────────────────────────────────
  const pct       = Math.min((waterToday / META) * 100, 100);
  const remaining = Math.max(META - waterToday, 0);

  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />

        <section className="flex-1 space-y-5">

          {/* ── Header + quick-add ── */}
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
            <div className="mb-4 flex items-center gap-3">
              <Droplet className="text-blue-400 shrink-0" size={22} />
              <h1 className="text-lg font-semibold text-white">Hidratação</h1>
              <div className="ml-auto text-right">
                <p className="text-xl font-bold text-blue-400 leading-none">{fmtMl(waterToday)}</p>
                <p className="text-[10px] text-slate-500">de {fmtMl(META)}</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-1 h-3 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-700"
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mb-5 flex justify-between text-[10px] text-slate-500">
              <span>{Math.round(pct)}%</span>
              <span>{remaining > 0 ? `faltam ${fmtMl(remaining)}` : '✓ meta atingida hoje!'}</span>
            </div>

            {/* Quick-add buttons */}
            <div className="flex flex-wrap gap-2">
              {[100, 250, 500, 750, 1000].map(ml => (
                <button key={ml}
                  onClick={() => addWater(ml, todayStr())}
                  disabled={loading}
                  className="flex items-center gap-1.5 rounded-2xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm font-semibold text-blue-300 transition hover:border-blue-400/40 hover:bg-blue-500/20 disabled:opacity-50">
                  <Droplet size={12} />
                  +{ml >= 1000 ? '1L' : `${ml}ml`}
                </button>
              ))}
            </div>

            {/* Success message */}
            {mensagem && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-300">
                <Droplet size={12} /> {mensagem}
              </div>
            )}
          </div>

          {/* ── Week + Month charts ── */}
          <div className="grid gap-5 lg:grid-cols-2">

            {/* Week */}
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
              <div className="mb-0.5 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Semana</p>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-bold text-white">{fmtMl(weekTotal)}</span>
                  <span className="text-slate-500">{weekGoalDays}/7 metas ✓</span>
                </div>
              </div>
              <p className="mb-4 text-[10px] text-slate-600">Últimos 7 dias</p>

              <BarChart data={weekData} maxVal={weekMax} goalVal={META} height={90} />

              <div className="mt-1 flex gap-1">
                {weekData.map(d => (
                  <div key={d.key} style={{ flex: 1 }}
                    className={`text-center text-[9px] ${d.isHighlight ? 'font-bold text-blue-400' : 'text-slate-600'}`}>
                    {d.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Month */}
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
              <div className="mb-0.5 flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
                  {MONTHS_SHORT[new Date().getMonth()]}
                </p>
                <div className="flex items-center gap-3 text-xs">
                  <span className="font-bold text-white">{fmtMl(monthTotal)}</span>
                  <span className="text-slate-500">{monthGoalDays} metas ✓</span>
                </div>
              </div>
              <p className="mb-4 text-[10px] text-slate-600">{monthActiveDays} dias com registro</p>

              <BarChart data={monthData} maxVal={monthMax} goalVal={META} height={90} gapClass="gap-px" />

              <div className="mt-1 flex gap-px">
                {monthData.map(d => (
                  <div key={d.key} style={{ flex: 1 }}
                    className={`text-center text-[8px] ${
                      d.isHighlight
                        ? 'font-bold text-blue-400'
                        : d.isFuture
                          ? 'text-transparent'
                          : Number(d.label) % 5 === 0
                            ? 'text-slate-600'
                            : 'text-transparent'
                    }`}>
                    {Number(d.label) % 5 === 0 || d.isHighlight ? d.label : '.'}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Year chart ── */}
          <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
            <div className="mb-0.5 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
                {new Date().getFullYear()}
              </p>
              <span className="text-[10px] text-slate-500">média diária por mês · meta {fmtMl(META)}/dia</span>
            </div>
            <p className="mb-4 text-[10px] text-slate-600">
              Média de {fmtMl(yearData[curMonth]?.value ?? 0)}/dia este mês
            </p>

            <BarChart data={yearData} maxVal={yearMax} goalVal={META} height={100} />

            <div className="mt-1 flex gap-1">
              {yearData.map(d => (
                <div key={d.key} style={{ flex: 1 }}
                  className={`text-center text-[9px] ${
                    Number(d.key) === curMonth ? 'font-bold text-blue-400' : 'text-slate-600'
                  }`}>
                  {d.label}
                </div>
              ))}
            </div>
          </div>

          {/* ── Retroactive form ── */}
          <div className="rounded-[2rem] border border-white/10 bg-white/5 shadow-glow backdrop-blur-xl overflow-hidden">
            <button onClick={() => setShowPassado(!showPassado)}
              className="flex w-full items-center justify-between p-5 transition hover:bg-white/5">
              <div className="flex items-center gap-3">
                <History className="text-slate-400 shrink-0" size={17} />
                <div className="text-left">
                  <p className="text-sm font-medium text-white">Registro retroativo</p>
                  <p className="text-xs text-slate-500">Adicione água a um dia anterior</p>
                </div>
              </div>
              <ChevronDown
                className={`text-slate-400 transition-transform shrink-0 ${showPassado ? 'rotate-180' : ''}`}
                size={17}
              />
            </button>

            {showPassado && (
              <form
                onSubmit={e => { e.preventDefault(); if (dataPassada && mlPassado) addWater(Number(mlPassado), dataPassada); }}
                className="border-t border-white/5 px-5 pb-5 pt-4">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">Data</label>
                    <input type="date" required max={todayStr()} value={dataPassada}
                      onChange={e => setDataPassada(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500/50 transition" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-400">Quantidade (ml)</label>
                    <input type="number" required min="50" step="50" value={mlPassado}
                      onChange={e => setMlPassado(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500/50 transition" />
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-blue-500/30 bg-blue-500/10 py-2.5 text-sm font-medium text-blue-300 transition hover:bg-blue-500/20 disabled:opacity-50">
                  <History size={14} /> Salvar no histórico
                </button>
              </form>
            )}
          </div>

        </section>
      </div>
    </main>
  );
}
