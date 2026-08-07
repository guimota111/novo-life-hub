'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  collection, doc, getDocs, addDoc, deleteDoc, setDoc, increment, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import {
  Plus, ChevronLeft, ChevronRight, X, Check, Clock,
  RefreshCw, Trash2, GraduationCap, Settings,
} from 'lucide-react';
import CalendarHeatmap from '@/components/CalendarHeatmap';

// ─── Color palette ────────────────────────────────────────────────────────────

const COLORS = [
  { key: 'cyan',    dot: 'bg-cyan-500',    text: 'text-cyan-300',    ring: 'ring-cyan-500',    cardBg: 'bg-cyan-500/10',    cardBorder: 'border-cyan-500/30',    levels: ['bg-cyan-500/25',    'bg-cyan-500/50',    'bg-cyan-500/75',    'bg-cyan-500/95']    },
  { key: 'sky',     dot: 'bg-sky-500',     text: 'text-sky-300',     ring: 'ring-sky-500',     cardBg: 'bg-sky-500/10',     cardBorder: 'border-sky-500/30',     levels: ['bg-sky-500/25',     'bg-sky-500/50',     'bg-sky-500/75',     'bg-sky-500/95']     },
  { key: 'emerald', dot: 'bg-emerald-500', text: 'text-emerald-300', ring: 'ring-emerald-500', cardBg: 'bg-emerald-500/10', cardBorder: 'border-emerald-500/30', levels: ['bg-emerald-500/25', 'bg-emerald-500/50', 'bg-emerald-500/75', 'bg-emerald-500/95'] },
  { key: 'violet',  dot: 'bg-violet-500',  text: 'text-violet-300',  ring: 'ring-violet-500',  cardBg: 'bg-violet-500/10',  cardBorder: 'border-violet-500/30',  levels: ['bg-violet-500/25',  'bg-violet-500/50',  'bg-violet-500/75',  'bg-violet-500/95']  },
  { key: 'amber',   dot: 'bg-amber-500',   text: 'text-amber-300',   ring: 'ring-amber-500',   cardBg: 'bg-amber-500/10',   cardBorder: 'border-amber-500/30',   levels: ['bg-amber-500/25',   'bg-amber-500/50',   'bg-amber-500/75',   'bg-amber-500/95']   },
  { key: 'rose',    dot: 'bg-rose-500',    text: 'text-rose-300',    ring: 'ring-rose-500',    cardBg: 'bg-rose-500/10',    cardBorder: 'border-rose-500/30',    levels: ['bg-rose-500/25',    'bg-rose-500/50',    'bg-rose-500/75',    'bg-rose-500/95']    },
  { key: 'orange',  dot: 'bg-orange-500',  text: 'text-orange-300',  ring: 'ring-orange-500',  cardBg: 'bg-orange-500/10',  cardBorder: 'border-orange-500/30',  levels: ['bg-orange-500/25',  'bg-orange-500/50',  'bg-orange-500/75',  'bg-orange-500/95']  },
  { key: 'pink',    dot: 'bg-pink-500',    text: 'text-pink-300',    ring: 'ring-pink-500',    cardBg: 'bg-pink-500/10',    cardBorder: 'border-pink-500/30',    levels: ['bg-pink-500/25',    'bg-pink-500/50',    'bg-pink-500/75',    'bg-pink-500/95']    },
] as const;

type ColorKey = typeof COLORS[number]['key'];

function getColor(key: string) {
  return COLORS.find(c => c.key === key) ?? COLORS[0];
}

// ─── types ────────────────────────────────────────────────────────────────────

interface StudyArea {
  id: string;
  name: string;
  colorKey: ColorKey;
}

interface StudySession {
  id: string;
  areaId: string;
  subArea: string;
  topic: string;
  date: string;            // YYYY-MM-DD
  durationMinutes: number;
  notes?: string;
}

type ModalType = null | 'addArea' | 'addSession' | 'manageAreas' | 'sessionDetail';
type TlScale   = 'month' | 'quarter' | 'year' | 'all';
type StatView  = 'week' | 'month' | 'year';

// ─── helpers ──────────────────────────────────────────────────────────────────

const MONTHS_PT    = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dateToStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseDate(s: string) { return new Date(s + 'T12:00:00'); }
function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m}min`;
}

function getTimelineRange(scale: TlScale, tlYear: number, tlMonth: number, allSessions: StudySession[]): { start: Date; end: Date } {
  const now = new Date();
  if (scale === 'month') return { start: new Date(tlYear, tlMonth, 1), end: new Date(tlYear, tlMonth + 1, 0) };
  if (scale === 'quarter') {
    const q = Math.floor(tlMonth / 3);
    return { start: new Date(tlYear, q * 3, 1), end: new Date(tlYear, q * 3 + 3, 0) };
  }
  if (scale === 'year') return { start: new Date(tlYear, 0, 1), end: new Date(tlYear, 11, 31) };
  const dates = allSessions.map(s => parseDate(s.date));
  const earliest = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : now;
  return { start: earliest, end: now };
}

function periodDates(view: StatView): { start: string; end: string } {
  const now = new Date();
  const today = todayStr();
  if (view === 'week') {
    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    return { start: dateToStr(monday), end: today };
  }
  if (view === 'month') {
    return { start: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`, end: today };
  }
  return { start: `${now.getFullYear()}-01-01`, end: today };
}

// ─── Modal + Field ────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0d1b2a] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-400 transition hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-400">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50 transition';

// ─── Main component ───────────────────────────────────────────────────────────

export default function EstudoPage() {
  const { user } = useAuth();

  const [areas,    setAreas]    = useState<StudyArea[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading,  setLoading]  = useState(true);

  const [modal,             setModal]             = useState<ModalType>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // timeline
  const [tlScale, setTlScale] = useState<TlScale>('month');
  const [tlYear,  setTlYear]  = useState(new Date().getFullYear());
  const [tlMonth, setTlMonth] = useState(new Date().getMonth());

  // stats & history
  const [statView,   setStatView]   = useState<StatView>('month');
  const [filterArea, setFilterArea] = useState<string | null>(null);

  // add area form
  const [arName,   setArName]   = useState('');
  const [arColor,  setArColor]  = useState<ColorKey>('cyan');
  const [arSaving, setArSaving] = useState(false);

  // add session form
  const [ssArea,     setSsArea]     = useState('');
  const [ssSubArea,  setSsSubArea]  = useState('');
  const [ssTopic,    setSsTopic]    = useState('');
  const [ssDate,     setSsDate]     = useState(todayStr());
  const [ssDuration, setSsDuration] = useState('');
  const [ssNotes,    setSsNotes]    = useState('');
  const [ssSaving,   setSsSaving]   = useState(false);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [aSnap, sSnap] = await Promise.all([
        getDocs(collection(db, 'users', user.uid, 'study_areas')),
        getDocs(collection(db, 'users', user.uid, 'study_sessions')),
      ]);
      setAreas(aSnap.docs.map(d => ({ id: d.id, ...d.data() } as StudyArea)));
      setSessions(sSnap.docs.map(d => ({ id: d.id, ...d.data() } as StudySession)));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── derived ───────────────────────────────────────────────────────────────
  const selectedSession = useMemo(
    () => sessions.find(s => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId]
  );

  // autocomplete suggestions for subArea field (based on selected area's past sessions)
  const subAreaSuggestions = useMemo(() => {
    if (!ssArea) return [];
    const seen = new Set<string>();
    return sessions
      .filter(s => s.areaId === ssArea && s.subArea)
      .map(s => s.subArea)
      .filter(v => { if (seen.has(v)) return false; seen.add(v); return true; });
  }, [sessions, ssArea]);

  // timeline
  const tlRange = useMemo(
    () => getTimelineRange(tlScale, tlYear, tlMonth, sessions),
    [tlScale, tlYear, tlMonth, sessions]
  );

  const sessionsByDate = useMemo(() => {
    const map: Record<string, StudySession[]> = {};
    sessions.forEach(s => { (map[s.date] ??= []).push(s); });
    return map;
  }, [sessions]);

  // area-level stats (all time)
  const areaStats = useMemo(() => {
    const map: Record<string, { totalMin: number; sessionCount: number }> = {};
    sessions.forEach(s => {
      if (!map[s.areaId]) map[s.areaId] = { totalMin: 0, sessionCount: 0 };
      map[s.areaId].totalMin     += s.durationMinutes;
      map[s.areaId].sessionCount += 1;
    });
    return map;
  }, [sessions]);

  // period stats
  const statPeriod = useMemo(() => periodDates(statView), [statView]);

  const statData = useMemo(() => {
    const inPeriod = sessions.filter(s => s.date >= statPeriod.start && s.date <= statPeriod.end);
    const count      = inPeriod.length;
    const totalMin   = inPeriod.reduce((s, ss) => s + ss.durationMinutes, 0);
    const activeDays = new Set(inPeriod.map(s => s.date)).size;
    const avgMin     = activeDays > 0 ? Math.round(totalMin / activeDays) : 0;
    const byArea: Record<string, number> = {};
    inPeriod.forEach(s => { byArea[s.areaId] = (byArea[s.areaId] ?? 0) + s.durationMinutes; });
    const topAreaEntry = Object.entries(byArea).sort((a, b) => b[1] - a[1])[0];
    const topArea      = topAreaEntry ? areas.find(a => a.id === topAreaEntry[0]) : null;
    const topAreaMin   = topAreaEntry?.[1] ?? 0;
    return { count, totalMin, activeDays, avgMin, topArea, topAreaMin };
  }, [sessions, statPeriod, areas]);

  // monthly hours (current year)
  const monthlyHours = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const prefix = `${new Date().getFullYear()}-${String(m+1).padStart(2,'0')}`;
      const mins   = sessions.filter(s => s.date.startsWith(prefix)).reduce((sum, s) => sum + s.durationMinutes, 0);
      return { month: m, mins, hours: Math.round(mins / 60 * 10) / 10 };
    });
  }, [sessions]);

  const monthlyMax = Math.max(...monthlyHours.map(m => m.mins), 1);

  // history (last 30, filterable)
  const historySessions = useMemo(() => {
    return [...sessions]
      .filter(s => !filterArea || s.areaId === filterArea)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30);
  }, [sessions, filterArea]);

  // ── timeline navigation ───────────────────────────────────────────────────
  const now = new Date();
  const tlAtPresent =
    tlScale === 'all' ? true :
    tlScale === 'month'   ? tlYear === now.getFullYear() && tlMonth === now.getMonth() :
    tlScale === 'quarter' ? tlYear === now.getFullYear() && Math.floor(tlMonth/3) === Math.floor(now.getMonth()/3) :
    tlYear >= now.getFullYear();

  function tlPrev() {
    if (tlScale === 'month') {
      if (tlMonth === 0) { setTlMonth(11); setTlYear(y => y - 1); } else setTlMonth(m => m - 1);
    } else if (tlScale === 'quarter') {
      const q = Math.floor(tlMonth / 3);
      if (q === 0) { setTlMonth(9); setTlYear(y => y - 1); } else setTlMonth((q - 1) * 3);
    } else if (tlScale === 'year') {
      setTlYear(y => y - 1);
    }
  }
  function tlNext() {
    if (tlAtPresent) return;
    if (tlScale === 'month') {
      if (tlMonth === 11) { setTlMonth(0); setTlYear(y => y + 1); } else setTlMonth(m => m + 1);
    } else if (tlScale === 'quarter') {
      const q = Math.floor(tlMonth / 3);
      if (q === 3) { setTlMonth(0); setTlYear(y => y + 1); } else setTlMonth((q + 1) * 3);
    } else if (tlScale === 'year') {
      setTlYear(y => y + 1);
    }
  }

  const tlLabel = useMemo(() => {
    if (tlScale === 'month')   return `${MONTHS_PT[tlMonth]} ${tlYear}`;
    if (tlScale === 'quarter') return `T${Math.floor(tlMonth/3)+1} ${tlYear}`;
    if (tlScale === 'year')    return String(tlYear);
    return 'Todo o período';
  }, [tlScale, tlMonth, tlYear]);

  // ── actions ───────────────────────────────────────────────────────────────
  async function handleAddArea() {
    if (!user || !arName) return;
    setArSaving(true);
    try {
      const ref = await addDoc(collection(db, 'users', user.uid, 'study_areas'), {
        name: arName, colorKey: arColor, createdAt: Timestamp.now(),
      });
      setAreas(prev => [...prev, { id: ref.id, name: arName, colorKey: arColor }]);
      setArName(''); setArColor('cyan');
      setModal(null);
    } finally { setArSaving(false); }
  }

  async function handleAddSession() {
    if (!user || !ssArea || !ssTopic || !ssDuration) return;
    setSsSaving(true);
    try {
      const ref = await addDoc(collection(db, 'users', user.uid, 'study_sessions'), {
        areaId: ssArea, subArea: ssSubArea, topic: ssTopic,
        date: ssDate, durationMinutes: Number(ssDuration),
        notes: ssNotes || null, createdAt: Timestamp.now(),
      });
      await setDoc(doc(db, 'users', user.uid, 'daily_logs', ssDate), {
        study_minutes: increment(Number(ssDuration)), updatedAt: new Date(),
      }, { merge: true });
      setSessions(prev => [...prev, {
        id: ref.id, areaId: ssArea, subArea: ssSubArea, topic: ssTopic,
        date: ssDate, durationMinutes: Number(ssDuration),
        notes: ssNotes || undefined,
      }]);
      setModal(null);
      setSsArea(''); setSsSubArea(''); setSsTopic('');
      setSsDate(todayStr()); setSsDuration(''); setSsNotes('');
    } finally { setSsSaving(false); }
  }

  async function handleDeleteSession(sessionId: string) {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'study_sessions', sessionId));
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    setModal(null);
  }

  async function handleDeleteArea(areaId: string) {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'study_areas', areaId));
    setAreas(prev => prev.filter(a => a.id !== areaId));
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="flex h-48 items-center justify-center text-slate-500">Carregando...</div>;
  }

  return (
    <div className="space-y-5">

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => { setSsArea(areas[0]?.id ?? ''); setModal('addSession'); }}
          className="flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/20">
          <Plus size={15} /> Registrar Estudo
        </button>
        <button onClick={() => setModal('addArea')}
          className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-400 transition hover:border-cyan-500/30 hover:text-cyan-300">
          <Plus size={15} /> Nova Área
        </button>
        <button onClick={() => setModal('manageAreas')}
          className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-400 transition hover:border-cyan-500/30 hover:text-cyan-300">
          <Settings size={12} /> Gerenciar Áreas
        </button>
        <button onClick={loadData}
          className="ml-auto flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-400 transition hover:border-emerald-500/30 hover:text-emerald-300">
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>

      {/* Area summary cards */}
      {areas.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {areas.map(area => {
            const stats = areaStats[area.id] ?? { totalMin: 0, sessionCount: 0 };
            const c = getColor(area.colorKey);
            const active = filterArea === area.id;
            return (
              <button key={area.id}
                onClick={() => setFilterArea(f => f === area.id ? null : area.id)}
                className={`rounded-2xl border p-4 text-left transition ${
                  active
                    ? `${c.cardBg} ${c.cardBorder} ring-1 ${c.ring}/30`
                    : 'border-white/5 bg-slate-900/40 hover:border-white/10'
                }`}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.dot}`} />
                  <span className="text-xs font-medium text-white truncate">{area.name}</span>
                </div>
                <p className={`text-lg font-bold ${c.text}`}>{fmtDuration(stats.totalMin)}</p>
                <p className="text-[10px] text-slate-600">
                  {stats.sessionCount} sess{stats.sessionCount !== 1 ? 'ões' : 'ão'}
                </p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 text-center">
          <GraduationCap size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-sm text-slate-500 mb-3">Nenhuma área de estudo criada ainda.</p>
          <button onClick={() => setModal('addArea')}
            className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/20">
            <Plus size={14} /> Criar primeira área
          </button>
        </div>
      )}

      {/* Timeline */}
      {areas.length > 0 && (
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-1 rounded-2xl border border-white/5 bg-slate-900/40 p-1">
              {(['month','quarter','year','all'] as TlScale[]).map(s => (
                <button key={s} onClick={() => setTlScale(s)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                    tlScale === s ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
                  }`}>
                  {s === 'month' ? 'Mês' : s === 'quarter' ? 'Trimestre' : s === 'year' ? 'Ano' : 'Tudo'}
                </button>
              ))}
            </div>

            {tlScale !== 'all' && (
              <div className="flex items-center gap-2 ml-auto">
                <button onClick={tlPrev}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-cyan-500/30 hover:text-white">
                  <ChevronLeft size={15} />
                </button>
                <span className="min-w-[120px] text-center text-sm font-medium text-slate-200">{tlLabel}</span>
                <button onClick={tlNext} disabled={tlAtPresent}
                  className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-cyan-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-30">
                  <ChevronRight size={15} />
                </button>
              </div>
            )}
            {tlScale === 'all' && (
              <span className="ml-auto text-sm font-medium text-slate-400">{tlLabel}</span>
            )}
          </div>

          {!Object.keys(sessionsByDate).some(k => { const d = parseDate(k); return d >= tlRange.start && d <= tlRange.end; }) ? (
            <p className="py-8 text-center text-sm text-slate-600">Nenhuma sessão de estudo neste período.</p>
          ) : (
            <div>
              <CalendarHeatmap
                start={tlRange.start}
                end={tlRange.end}
                today={todayStr()}
                getCell={key => {
                  const list = sessionsByDate[key];
                  if (!list || list.length === 0) return null;
                  const totalMin = list.reduce((sum, s) => sum + s.durationMinutes, 0);
                  const byArea: Record<string, number> = {};
                  list.forEach(s => { byArea[s.areaId] = (byArea[s.areaId] ?? 0) + s.durationMinutes; });
                  const dominantAreaId = Object.entries(byArea).sort((a, b) => b[1] - a[1])[0][0];
                  const dominant = areas.find(a => a.id === dominantAreaId);
                  const c = getColor(dominant?.colorKey ?? 'cyan');
                  const level = totalMin >= 120 ? 4 : totalMin >= 60 ? 3 : totalMin >= 30 ? 2 : 1;
                  return {
                    colorClass: c.levels[level - 1],
                    tooltip: (
                      <div>
                        <p className="text-center text-[10px] font-semibold text-white whitespace-nowrap">
                          {parseDate(key).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                          {' · '}{fmtDuration(totalMin)}
                        </p>
                        <div className="mt-1 space-y-0.5">
                          {list.map(session => {
                            const a = areas.find(ar => ar.id === session.areaId);
                            const sc = getColor(a?.colorKey ?? 'cyan');
                            return (
                              <button key={session.id}
                                onClick={() => { setSelectedSessionId(session.id); setModal('sessionDetail'); }}
                                className={`block w-full max-w-[180px] truncate text-left text-[9px] ${sc.text} hover:brightness-125`}>
                                {a?.name ?? '?'} · {session.topic} ({fmtDuration(session.durationMinutes)})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ),
                  };
                }}
              />

              {/* Legend */}
              <div className="mt-4 flex flex-wrap gap-4 border-t border-white/5 pt-4">
                {areas
                  .filter(a => Object.values(sessionsByDate).some(list => list.some(s => s.areaId === a.id)))
                  .map(area => {
                    const c = getColor(area.colorKey);
                    return (
                      <span key={area.id} className="flex items-center gap-1.5 text-xs text-slate-500">
                        <span className={`h-2.5 w-2.5 rounded-full ${c.dot} opacity-70`} />
                        {area.name}
                      </span>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Statistics */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
        <p className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-500">Estatísticas</p>

        <div className="mb-5 flex gap-1 rounded-2xl border border-white/5 bg-slate-900/40 p-1">
          {(['week','month','year'] as StatView[]).map(v => (
            <button key={v} onClick={() => setStatView(v)}
              className={`flex-1 rounded-xl py-1.5 text-xs font-medium transition ${
                statView === v ? 'bg-cyan-500/20 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {v === 'week' ? 'Semana' : v === 'month' ? 'Mês' : 'Ano'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Sessões',         value: String(statData.count) },
            { label: 'Horas estudadas', value: fmtDuration(statData.totalMin) },
            { label: 'Média/dia ativo', value: fmtDuration(statData.avgMin) },
            {
              label: 'Área top',
              value: statData.topArea?.name ?? '–',
              sub: statData.topArea ? fmtDuration(statData.topAreaMin) : '',
            },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-2xl border border-white/5 bg-slate-900/40 p-4">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-slate-600">{label}</p>
              <p className="text-xl font-bold text-white truncate" title={value}>{value}</p>
              {sub && <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p>}
            </div>
          ))}
        </div>

        {/* Monthly hours bar chart */}
        <div className="mt-5 border-t border-white/5 pt-5">
          <p className="mb-3 text-xs text-slate-500">Horas por mês ({new Date().getFullYear()})</p>
          <div className="flex items-end gap-px" style={{ height: 80 }}>
            {monthlyHours.map(({ month, mins, hours }) => {
              const h = monthlyMax > 0 ? Math.max(mins / monthlyMax * 80, mins > 0 ? 2 : 0) : 0;
              const isCur = month === new Date().getMonth();
              return (
                <div key={month}
                  style={{ flex: 1, height: 80, display: 'flex', alignItems: 'flex-end', position: 'relative' }}
                  className="group/mb">
                  {mins > 0 && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 opacity-0 transition-opacity group-hover/mb:opacity-100">
                      <div className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-[9px] text-white whitespace-nowrap shadow-xl">
                        {hours}h
                      </div>
                    </div>
                  )}
                  <div style={{ width: '100%', height: Math.max(h, 2) }}
                    className={`rounded-t-sm transition-all duration-500 ${
                      mins > 0 ? (isCur ? 'bg-cyan-400' : 'bg-cyan-600/60') : 'bg-slate-800/30'
                    }`} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-px mt-1">
            {monthlyHours.map(({ month }) => (
              <div key={month} style={{ flex: 1 }}
                className={`text-center text-[9px] ${month === new Date().getMonth() ? 'font-bold text-cyan-400' : 'text-slate-600'}`}>
                {MONTHS_SHORT[month]}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Session history */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Histórico</p>
          {filterArea && (
            <button onClick={() => setFilterArea(null)} className="text-[11px] text-cyan-400 hover:text-cyan-300 transition">
              Limpar filtro
            </button>
          )}
        </div>

        {/* Area filter pills */}
        {areas.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {areas.map(area => {
              const c = getColor(area.colorKey);
              const active = filterArea === area.id;
              return (
                <button key={area.id}
                  onClick={() => setFilterArea(f => f === area.id ? null : area.id)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? `${c.cardBg} ${c.cardBorder} ${c.text}`
                      : 'border-white/5 bg-slate-900/30 text-slate-500 hover:text-slate-300'
                  }`}>
                  <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                  {area.name}
                </button>
              );
            })}
          </div>
        )}

        {historySessions.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-600">Nenhuma sessão registrada.</p>
        ) : (
          <div className="space-y-2">
            {historySessions.map(session => {
              const area = areas.find(a => a.id === session.areaId);
              const c = getColor(area?.colorKey ?? 'cyan');
              return (
                <div key={session.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/5 bg-slate-900/30 px-4 py-3">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-medium uppercase tracking-wide ${c.text}`}>{area?.name ?? '—'}</span>
                      {session.subArea && (
                        <span className="text-[10px] text-slate-500">· {session.subArea}</span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-white truncate">{session.topic}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-medium text-white">{fmtDuration(session.durationMinutes)}</p>
                      <p className="text-[10px] text-slate-600">
                        {new Date(session.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <button
                      onClick={() => { setSelectedSessionId(session.id); setModal('sessionDetail'); }}
                      className="text-slate-700 hover:text-slate-400 transition">
                      <Clock size={13} />
                    </button>
                    <button onClick={() => handleDeleteSession(session.id)}
                      className="text-slate-700 hover:text-red-400 transition">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modals ── */}

      {modal === 'addArea' && (
        <Modal title="Nova Área de Estudo" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nome da área *">
              <input className={inputCls} value={arName} onChange={e => setArName(e.target.value)}
                placeholder="Ex: Patologia" autoFocus />
            </Field>
            <Field label="Cor">
              <div className="flex gap-2 flex-wrap pt-1">
                {COLORS.map(c => (
                  <button key={c.key} onClick={() => setArColor(c.key)}
                    className={`h-7 w-7 rounded-full ${c.dot} transition hover:scale-110 ${
                      arColor === c.key ? `ring-2 ring-offset-2 ring-offset-[#0d1b2a] ${c.ring}` : 'opacity-60 hover:opacity-100'
                    }`} />
                ))}
              </div>
            </Field>
            <button onClick={handleAddArea} disabled={!arName || arSaving}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/15 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/25 disabled:opacity-50">
              {arSaving ? 'Salvando...' : <><Check size={14} /> Criar área</>}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'addSession' && (
        <Modal title="Registrar Sessão de Estudo" onClose={() => setModal(null)}>
          {areas.length === 0 ? (
            <div className="py-4 text-center space-y-3">
              <p className="text-sm text-slate-500">Crie uma área de estudo primeiro.</p>
              <button onClick={() => setModal('addArea')}
                className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300 hover:bg-cyan-500/20 transition">
                <Plus size={14} /> Criar área
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label="Grande área *">
                <select className={inputCls} value={ssArea}
                  onChange={e => { setSsArea(e.target.value); setSsSubArea(''); }}>
                  <option value="">Selecione...</option>
                  {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>

              <Field label="Pequena área">
                <input className={inputCls}
                  list="subarea-datalist"
                  value={ssSubArea}
                  onChange={e => setSsSubArea(e.target.value)}
                  placeholder="Ex: Hematopatologia"
                />
                <datalist id="subarea-datalist">
                  {subAreaSuggestions.map(s => <option key={s} value={s} />)}
                </datalist>
              </Field>

              <Field label="Tópico / Conteúdo *">
                <input className={inputCls} value={ssTopic} onChange={e => setSsTopic(e.target.value)}
                  placeholder="Ex: Biópsia de medula óssea" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Duração (min) *">
                  <input className={inputCls} type="number" min={1} value={ssDuration}
                    onChange={e => setSsDuration(e.target.value)} placeholder="60" />
                </Field>
                <Field label="Data">
                  <input className={inputCls} type="date" value={ssDate} onChange={e => setSsDate(e.target.value)} />
                </Field>
              </div>

              <Field label="Observações">
                <textarea className={`${inputCls} resize-none`} rows={2} value={ssNotes}
                  onChange={e => setSsNotes(e.target.value)} placeholder="Opcional..." />
              </Field>

              <button onClick={handleAddSession} disabled={!ssArea || !ssTopic || !ssDuration || ssSaving}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/15 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/25 disabled:opacity-50">
                {ssSaving ? 'Salvando...' : <><Check size={14} /> Registrar sessão</>}
              </button>
            </div>
          )}
        </Modal>
      )}

      {modal === 'manageAreas' && (
        <Modal title="Gerenciar Áreas" onClose={() => setModal(null)}>
          <div className="space-y-3">
            {areas.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">Nenhuma área criada.</p>
            ) : (
              areas.map(area => {
                const c = getColor(area.colorKey);
                const stats = areaStats[area.id] ?? { totalMin: 0, sessionCount: 0 };
                return (
                  <div key={area.id}
                    className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-3">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${c.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white">{area.name}</p>
                      <p className="text-[10px] text-slate-600">
                        {stats.sessionCount} sess{stats.sessionCount !== 1 ? 'ões' : 'ão'} · {fmtDuration(stats.totalMin)}
                      </p>
                    </div>
                    <button onClick={() => handleDeleteArea(area.id)}
                      className="text-slate-700 hover:text-red-400 transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })
            )}
            <button onClick={() => setModal('addArea')}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/20">
              <Plus size={14} /> Adicionar área
            </button>
          </div>
        </Modal>
      )}

      {modal === 'sessionDetail' && selectedSession && (() => {
        const area = areas.find(a => a.id === selectedSession.areaId);
        const c = getColor(area?.colorKey ?? 'cyan');
        return (
          <Modal title="Detalhes da Sessão" onClose={() => setModal(null)}>
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/5 bg-slate-900/40 p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
                  <span className={`text-xs font-medium ${c.text}`}>{area?.name ?? '—'}</span>
                  {selectedSession.subArea && (
                    <span className="text-xs text-slate-500">· {selectedSession.subArea}</span>
                  )}
                </div>
                <p className="font-semibold text-white">{selectedSession.topic}</p>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <Clock size={11} /> {fmtDuration(selectedSession.durationMinutes)}
                  </span>
                  <span>{new Date(selectedSession.date + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                </div>
                {selectedSession.notes && (
                  <p className="border-t border-white/5 pt-2 text-sm text-slate-400">{selectedSession.notes}</p>
                )}
              </div>
              <button onClick={() => handleDeleteSession(selectedSession.id)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-500/20">
                <Trash2 size={14} /> Excluir sessão
              </button>
            </div>
          </Modal>
        );
      })()}

    </div>
  );
}
