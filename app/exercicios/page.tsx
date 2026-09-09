'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  collection, doc, setDoc, addDoc, getDocs, deleteDoc,
  query, where, documentId, orderBy,
} from 'firebase/firestore';
import {
  Dumbbell, Flame, Check, Plus, X, Loader2, ChevronLeft, ChevronRight,
  Activity, Zap, TrendingUp, Trash2, Footprints, Bike,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type AerobicType = 'corrida_rua' | 'corrida_esteira' | 'bike_outdoor' | 'bike_indoor';

interface AerobicSession {
  id: string;
  type: AerobicType;
  date: string;
  duration_min: number;
  distance_km: number;
  avg_speed_kmh: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const AEROBIC_TYPES = [
  { id: 'corrida_rua'     as AerobicType, label: 'Corrida de Rua',  icon: Footprints, color: 'text-emerald-400', barCls: 'bg-emerald-400', selCls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  { id: 'corrida_esteira' as AerobicType, label: 'Corrida Esteira', icon: Activity,   color: 'text-sky-400',     barCls: 'bg-sky-400',     selCls: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  { id: 'bike_outdoor'    as AerobicType, label: 'Bike Outdoor',    icon: Bike,       color: 'text-amber-400',   barCls: 'bg-amber-400',   selCls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  { id: 'bike_indoor'     as AerobicType, label: 'Bike Indoor',     icon: Zap,        color: 'text-rose-400',    barCls: 'bg-rose-400',    selCls: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
] as const;

const DAY_PT       = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MONTH_PT_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ── Helpers ───────────────────────────────────────────────────────────────────

const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const todayKey = () => dateStr(new Date());

const fmtSpeed = (s: number) => `${s.toFixed(1)} km/h`;
const fmtDist  = (d: number) => `${d.toFixed(1)} km`;
const fmtDur   = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)}h${m % 60 > 0 ? ` ${m % 60}min` : ''}` : `${m}min`;

function calcStreak(logs: Record<string, boolean>): number {
  const t = todayKey();
  const cur = new Date(t + 'T12:00:00');
  if (!logs[t]) cur.setDate(cur.getDate() - 1);
  let count = 0;
  for (let i = 0; i < 400; i++) {
    const k = dateStr(cur);
    if (logs[k]) { count++; cur.setDate(cur.getDate() - 1); }
    else break;
  }
  return count;
}

function monthCount(logs: Record<string, boolean>, year: number, month: number): number {
  const days = new Date(year, month + 1, 0).getDate();
  let n = 0;
  for (let d = 1; d <= days; d++) if (logs[dateStr(new Date(year, month, d))]) n++;
  return n;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExerciciosPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'academia' | 'aerobico'>('academia');

  // ── Academia ──────────────────────────────────────────────────────────────

  const [viewDate, setViewDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [gymLogs, setGymLogs] = useState<Record<string, boolean>>({});
  const [gymLoading, setGymLoading] = useState(false);
  const [savingDay, setSavingDay] = useState<string | null>(null);

  const loadGymData = useCallback(async (year: number, month: number) => {
    if (!user) return;
    setGymLoading(true);
    try {
      const start = dateStr(new Date(year, month - 3, 1));
      const end   = dateStr(new Date(year, month + 1, 0));
      const snap = await getDocs(query(
        collection(db, 'users', user.uid, 'daily_logs'),
        where(documentId(), '>=', start),
        where(documentId(), '<=', end),
      ));
      const result: Record<string, boolean> = {};
      snap.docs.forEach(d => { result[d.id] = d.data().gym_done === true; });
      setGymLogs(prev => ({ ...prev, ...result }));
    } finally {
      setGymLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadGymData(viewDate.getFullYear(), viewDate.getMonth());
  }, [loadGymData, viewDate]);

  const toggleGymDay = async (key: string) => {
    if (!user || savingDay) return;
    const newVal = !gymLogs[key];
    setSavingDay(key);
    setGymLogs(prev => ({ ...prev, [key]: newVal }));
    try {
      await setDoc(doc(db, 'users', user.uid, 'daily_logs', key), { gym_done: newVal, updatedAt: new Date() }, { merge: true });
    } catch {
      setGymLogs(prev => ({ ...prev, [key]: !newVal }));
    } finally {
      setSavingDay(null);
    }
  };

  const today = todayKey();

  const gymStreak    = useMemo(() => calcStreak(gymLogs), [gymLogs]);
  const thisMonthCnt = useMemo(() => monthCount(gymLogs, viewDate.getFullYear(), viewDate.getMonth()), [gymLogs, viewDate]);
  const prevMonthCnt = useMemo(() => {
    const p = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1);
    return monthCount(gymLogs, p.getFullYear(), p.getMonth());
  }, [gymLogs, viewDate]);

  const cal = useMemo(() => {
    const y = viewDate.getFullYear();
    const m = viewDate.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const firstDow = new Date(y, m, 1).getDay();
    const offset = firstDow === 0 ? 6 : firstDow - 1;
    return { y, m, daysInMonth, offset };
  }, [viewDate]);

  const isCurrentMonth = viewDate.getMonth() === new Date().getMonth() && viewDate.getFullYear() === new Date().getFullYear();

  // ── Aeróbico ──────────────────────────────────────────────────────────────

  const [sessions, setSessions]       = useState<AerobicSession[]>([]);
  const [sessLoading, setSessLoading] = useState(false);
  const [showForm, setShowForm]       = useState(false);
  const [formData, setFormData]       = useState({ type: 'corrida_rua' as AerobicType, date: todayKey(), duration: '', distance: '' });
  const [formSaving, setFormSaving]   = useState(false);
  const [deletingId, setDeletingId]   = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    if (!user) return;
    setSessLoading(true);
    try {
      const snap = await getDocs(query(
        collection(db, 'users', user.uid, 'aerobic_sessions'),
        orderBy('date', 'desc'),
      ));
      setSessions(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<AerobicSession, 'id'>) })));
    } finally {
      setSessLoading(false);
    }
  }, [user]);

  useEffect(() => { if (user) loadSessions(); }, [user, loadSessions]);

  const saveSession = async () => {
    if (!user) return;
    const dur = Number(formData.duration);
    const dist = Number(formData.distance);
    if (!dur || !dist || !formData.date) return;
    const avg_speed_kmh = +(dist * 60 / dur).toFixed(2);
    setFormSaving(true);
    try {
      const payload = { type: formData.type, date: formData.date, duration_min: dur, distance_km: dist, avg_speed_kmh, created_at: new Date() };
      const ref = await addDoc(collection(db, 'users', user.uid, 'aerobic_sessions'), payload);
      const newSession: AerobicSession = { id: ref.id, type: payload.type, date: payload.date, duration_min: payload.duration_min, distance_km: payload.distance_km, avg_speed_kmh: payload.avg_speed_kmh };
      setSessions(prev => [newSession, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
      setShowForm(false);
      setFormData({ type: 'corrida_rua', date: todayKey(), duration: '', distance: '' });
    } finally {
      setFormSaving(false);
    }
  };

  const deleteSession = async (id: string) => {
    if (!user) return;
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'aerobic_sessions', id));
      setSessions(prev => prev.filter(s => s.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const aerobicStats = useMemo(() =>
    AEROBIC_TYPES.map(t => {
      const typed = sessions.filter(s => s.type === t.id);
      if (!typed.length) return { ...t, count: 0, avgSpeed: 0, avgDist: 0, bestSpeed: 0, bestDist: 0, recent: [] as AerobicSession[] };
      const avgSpeed  = +(typed.reduce((s, x) => s + x.avg_speed_kmh, 0) / typed.length).toFixed(1);
      const avgDist   = +(typed.reduce((s, x) => s + x.distance_km,  0) / typed.length).toFixed(1);
      const bestSpeed = +Math.max(...typed.map(x => x.avg_speed_kmh)).toFixed(1);
      const bestDist  = +Math.max(...typed.map(x => x.distance_km)).toFixed(1);
      const recent    = [...typed].reverse().slice(-8);
      return { ...t, count: typed.length, avgSpeed, avgDist, bestSpeed, bestDist, recent };
    }),
  [sessions]);

  const speedPreview = formData.duration && formData.distance && Number(formData.duration) > 0
    ? (Number(formData.distance) * 60 / Number(formData.duration)).toFixed(1)
    : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />
        <section className="min-w-0 flex-1 space-y-6">

          {/* Header */}
          <header className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl sm:p-8">
            <p className="text-sm uppercase tracking-[0.3em] text-tamagochi-300">Tamagochi Me</p>
            <h1 className="text-3xl font-semibold text-white sm:text-4xl">Exercícios</h1>
            <p className="mt-1 text-slate-400">Academia e atividades aeróbicas</p>
          </header>

          {/* Tab bar */}
          <div className="flex gap-2 rounded-3xl border border-white/10 bg-white/5 p-2 backdrop-blur-xl">
            {(['academia', 'aerobico'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-2xl py-2.5 text-sm font-medium transition
                  ${tab === t ? 'bg-tamagochi-500 text-slate-950 shadow-lg' : 'text-slate-400 hover:text-white'}`}
              >
                {t === 'academia' ? 'Academia' : 'Aeróbico'}
              </button>
            ))}
          </div>

          {/* ── ACADEMIA ─────────────────────────────────────────────────── */}
          {tab === 'academia' && (
            <div className="space-y-4">

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                {([
                  { label: 'Sequência atual', value: gymStreak > 0 ? `${gymStreak} dias` : '—', Icon: Flame,   color: gymStreak > 0 ? 'text-orange-400' : 'text-slate-600' },
                  { label: MONTH_PT_FULL[viewDate.getMonth()],  value: `${thisMonthCnt} dias`,   Icon: Dumbbell, color: 'text-rose-400' },
                  { label: MONTH_PT_FULL[(viewDate.getMonth() + 11) % 12], value: `${prevMonthCnt} dias`, Icon: Check, color: 'text-slate-400' },
                ] as const).map(s => (
                  <div key={s.label} className="rounded-3xl border border-white/10 bg-white/5 p-3 text-center backdrop-blur-xl sm:rounded-[2rem] sm:p-5">
                    <s.Icon size={20} className={`mx-auto mb-2 ${s.color}`} />
                    <p className="text-base font-bold text-white sm:text-xl">{s.value}</p>
                    <p className="mt-0.5 text-[11px] leading-tight text-slate-500 sm:text-xs">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Calendar */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:p-6">
                {/* Month navigator */}
                <div className="mb-6 flex items-center justify-between gap-2">
                  <button
                    onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
                    className="rounded-xl border border-white/10 bg-slate-900/60 p-2 text-slate-300 transition hover:bg-white/10"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="text-center">
                    <p className="text-lg font-semibold text-white">
                      {MONTH_PT_FULL[viewDate.getMonth()]} {viewDate.getFullYear()}
                    </p>
                    <p className="text-xs text-slate-500">Toque em um dia para marcar ou desmarcar</p>
                  </div>
                  <button
                    onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
                    disabled={isCurrentMonth}
                    className="rounded-xl border border-white/10 bg-slate-900/60 p-2 text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>

                {/* Day headers */}
                <div className="mb-2 grid grid-cols-7 gap-1">
                  {DAY_PT.map(d => (
                    <div key={d} className="text-center text-[11px] font-medium text-slate-500">{d}</div>
                  ))}
                </div>

                {gymLoading ? (
                  <div className="flex h-40 items-center justify-center">
                    <Loader2 size={24} className="animate-spin text-tamagochi-400" />
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: cal.offset }).map((_, i) => <div key={`e-${i}`} />)}
                    {Array.from({ length: cal.daysInMonth }, (_, i) => {
                      const dayNum = i + 1;
                      const k = dateStr(new Date(cal.y, cal.m, dayNum));
                      const isFuture = k > today;
                      const done     = gymLogs[k] ?? false;
                      const isToday  = k === today;
                      const isSaving = savingDay === k;

                      return (
                        <button
                          key={k}
                          onClick={() => !isFuture && toggleGymDay(k)}
                          disabled={isFuture || !!savingDay}
                          className={[
                            'relative flex h-11 flex-col items-center justify-center rounded-xl text-sm font-medium transition-all',
                            isFuture ? 'cursor-default text-slate-700 bg-slate-900/20' :
                            done     ? 'bg-rose-500/70 text-white hover:bg-rose-500/90 cursor-pointer' :
                                       'bg-slate-900/40 text-slate-400 hover:bg-slate-800/60 cursor-pointer',
                            isToday  ? 'ring-2 ring-tamagochi-400/60 ring-offset-1 ring-offset-[#08101a]' : '',
                          ].join(' ')}
                        >
                          {isSaving ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <>
                              {done && !isFuture && (
                                <Check size={10} className="absolute top-1 right-1 opacity-70" />
                              )}
                              <span>{dayNum}</span>
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* NFC / API info */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                <div className="flex items-start gap-3">
                  <Zap size={18} className="mt-0.5 shrink-0 text-tamagochi-400" />
                  <div>
                    <p className="font-medium text-white">Marcar treino via NFC ou Atalho</p>
                    <p className="mt-1.5 text-sm text-slate-400">
                      Acesse{' '}
                      <code className="rounded bg-slate-800/80 px-1.5 py-0.5 text-xs text-tamagochi-300">
                        /api/gym/toggle?token=SEU_TOKEN
                      </code>{' '}
                      para marcar o treino de hoje automaticamente. Mesmo sistema da creatina — cadastre um token na coleção{' '}
                      <code className="rounded bg-slate-800/80 px-1.5 py-0.5 text-xs text-slate-300">nfc_tokens</code>{' '}
                      no Firestore com os campos <code className="text-xs text-slate-300">token</code> e <code className="text-xs text-slate-300">userId</code>.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── AERÓBICO ─────────────────────────────────────────────────── */}
          {tab === 'aerobico' && (
            <div className="space-y-4">

              {/* Add button */}
              <div className="flex justify-end">
                <button
                  onClick={() => setShowForm(v => !v)}
                  className={`flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold transition
                    ${showForm
                      ? 'border border-white/10 bg-slate-900/60 text-slate-300 hover:bg-white/10'
                      : 'bg-tamagochi-500 text-slate-950 hover:bg-tamagochi-400'
                    }`}
                >
                  {showForm ? <><X size={16} /> Cancelar</> : <><Plus size={16} /> Nova sessão</>}
                </button>
              </div>

              {/* Add form */}
              {showForm && (
                <div className="rounded-[2rem] border border-tamagochi-500/20 bg-white/5 p-6 backdrop-blur-xl">
                  <p className="mb-5 font-semibold text-white">Registrar sessão aeróbica</p>

                  {/* Type selector */}
                  <div className="mb-5">
                    <p className="mb-2 text-xs text-slate-400">Tipo de atividade</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {AEROBIC_TYPES.map(t => {
                        const Icon = t.icon;
                        return (
                          <button
                            key={t.id}
                            onClick={() => setFormData(f => ({ ...f, type: t.id }))}
                            className={[
                              'flex flex-col items-center gap-2 rounded-2xl border p-3 text-xs font-medium transition',
                              formData.type === t.id
                                ? t.selCls
                                : 'border-white/10 bg-slate-900/40 text-slate-400 hover:border-white/20',
                            ].join(' ')}
                          >
                            <Icon size={20} />
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Fields */}
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      { label: 'Data', type: 'date', max: todayKey(), val: formData.date,     set: (v: string) => setFormData(f => ({ ...f, date: v })),     placeholder: '' },
                      { label: 'Duração (min)',  type: 'number', max: '600', val: formData.duration, set: (v: string) => setFormData(f => ({ ...f, duration: v })), placeholder: 'ex: 45' },
                      { label: 'Distância (km)', type: 'number', max: '500', val: formData.distance, set: (v: string) => setFormData(f => ({ ...f, distance: v })), placeholder: 'ex: 8.5' },
                    ].map(field => (
                      <div key={field.label}>
                        <label className="mb-1.5 block text-xs text-slate-400">{field.label}</label>
                        <input
                          type={field.type}
                          max={field.max}
                          min={field.type === 'number' ? '0.1' : undefined}
                          step={field.label.includes('km') ? '0.1' : undefined}
                          value={field.val}
                          onChange={e => field.set(e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-tamagochi-400/50 focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>

                  {/* Speed preview */}
                  {speedPreview && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl bg-tamagochi-500/10 px-4 py-2.5 text-sm">
                      <Zap size={14} className="text-tamagochi-400" />
                      <span className="text-slate-400">Velocidade média:</span>
                      <span className="font-bold text-tamagochi-300">{speedPreview} km/h</span>
                    </div>
                  )}

                  <button
                    onClick={saveSession}
                    disabled={!formData.duration || !formData.distance || !formData.date || formSaving}
                    className="mt-4 flex items-center gap-2 rounded-2xl bg-tamagochi-500 px-6 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-tamagochi-400 disabled:opacity-40"
                  >
                    {formSaving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    Salvar sessão
                  </button>
                </div>
              )}

              {/* Stats per type */}
              {sessLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-tamagochi-400" />
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {aerobicStats.map(stat => {
                    const Icon = stat.icon;
                    if (stat.count === 0) return (
                      <div key={stat.id} className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl opacity-40">
                        <div className="flex items-center gap-2">
                          <Icon size={16} className={stat.color} />
                          <span className="text-sm font-medium text-slate-300">{stat.label}</span>
                        </div>
                        <p className="mt-2 text-xs text-slate-600">Nenhuma sessão ainda</p>
                      </div>
                    );

                    const maxSpeed = Math.max(...stat.recent.map(s => s.avg_speed_kmh), 1);

                    return (
                      <div key={stat.id} className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Icon size={16} className={stat.color} />
                            <span className="text-sm font-medium text-slate-200">{stat.label}</span>
                          </div>
                          <span className={`text-sm font-bold ${stat.color}`}>{stat.count} sessões</span>
                        </div>

                        <div className="mb-4 grid grid-cols-2 gap-2">
                          {[
                            { label: 'Vel. média',  value: fmtSpeed(stat.avgSpeed) },
                            { label: 'Dist. média', value: fmtDist(stat.avgDist) },
                            { label: 'Melhor vel.', value: fmtSpeed(stat.bestSpeed) },
                            { label: 'Maior dist.', value: fmtDist(stat.bestDist) },
                          ].map(m => (
                            <div key={m.label} className="rounded-xl bg-slate-900/40 px-3 py-2">
                              <p className="text-[10px] text-slate-500">{m.label}</p>
                              <p className="text-sm font-bold text-white">{m.value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Mini sparkline — speed over last sessions */}
                        {stat.recent.length > 1 && (
                          <div>
                            <p className="mb-1.5 flex items-center gap-1 text-[10px] text-slate-500">
                              <TrendingUp size={10} />
                              Velocidade — últimas {stat.recent.length} sessões
                            </p>
                            <div className="flex h-10 items-end gap-0.5">
                              {stat.recent.map((s, i) => (
                                <div
                                  key={s.id}
                                  title={`${s.date}: ${fmtSpeed(s.avg_speed_kmh)}`}
                                  className={`flex-1 rounded-t-sm transition-all ${stat.barCls}`}
                                  style={{
                                    height: `${Math.max((s.avg_speed_kmh / maxSpeed) * 40, 2)}px`,
                                    opacity: 0.35 + (i / stat.recent.length) * 0.65,
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Session history */}
              {sessions.length > 0 && (
                <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
                  <p className="mb-4 text-sm font-medium text-slate-200">Histórico de sessões</p>
                  <div className="space-y-2">
                    {sessions.slice(0, 30).map(s => {
                      const t = AEROBIC_TYPES.find(x => x.id === s.type)!;
                      const Icon = t.icon;
                      return (
                        <div
                          key={s.id}
                          className="flex items-center gap-3 rounded-2xl border border-white/5 bg-slate-900/30 px-4 py-3"
                        >
                          <Icon size={16} className={t.color} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-white">{t.label}</p>
                            <p className="text-xs text-slate-500">
                              {s.date.split('-').reverse().join('/')} · {fmtDur(s.duration_min)}
                            </p>
                          </div>
                          <div className="text-right text-xs">
                            <p className="font-semibold text-white">{fmtDist(s.distance_km)}</p>
                            <p className="text-slate-400">{fmtSpeed(s.avg_speed_kmh)}</p>
                          </div>
                          <button
                            onClick={() => deleteSession(s.id)}
                            disabled={deletingId === s.id}
                            className="ml-2 rounded-lg p-1.5 text-slate-600 transition hover:bg-rose-500/20 hover:text-rose-400 disabled:opacity-30"
                          >
                            {deletingId === s.id
                              ? <Loader2 size={14} className="animate-spin" />
                              : <Trash2 size={14} />
                            }
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {!sessLoading && sessions.length === 0 && !showForm && (
                <div className="rounded-[2rem] border border-white/10 bg-white/5 p-12 text-center backdrop-blur-xl">
                  <Activity size={32} className="mx-auto mb-3 text-slate-600" />
                  <p className="text-slate-400">Nenhuma sessão registrada ainda</p>
                  <p className="mt-1 text-xs text-slate-600">Clique em &ldquo;Nova sessão&rdquo; para começar</p>
                </div>
              )}
            </div>
          )}

        </section>
      </div>
    </main>
  );
}
