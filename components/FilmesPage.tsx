'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import {
  Plus, ChevronLeft, ChevronRight, X, Check, Star,
  Clock, RefreshCw, Trash2,
} from 'lucide-react';

// ─── types ────────────────────────────────────────────────────────────────────

interface Movie {
  id: string;
  name: string;
  director: string;
  coverUrl?: string;
  durationMinutes: number;
  watchDate?: string;    // YYYY-MM-DD
  addedDate: string;     // YYYY-MM-DD
  rating?: number;       // 0–10
  status: 'watchlist' | 'watched';
}

type ModalType = null | 'addMovie' | 'watchMovie' | 'movieDetail';
type TlScale   = 'month' | 'quarter' | 'year' | 'all';
type StatView  = 'week' | 'month' | 'year';

// ─── helpers ──────────────────────────────────────────────────────────────────

const MONTHS_PT    = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseDate(s: string) { return new Date(s + 'T12:00:00'); }
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function fmtDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ''}` : `${m}min`;
}

function getTimelineRange(scale: TlScale, tlYear: number, tlMonth: number, allMovies: Movie[]): { start: Date; end: Date } {
  const now = new Date();
  if (scale === 'month') {
    return { start: new Date(tlYear, tlMonth, 1), end: new Date(tlYear, tlMonth + 1, 0) };
  }
  if (scale === 'quarter') {
    const q = Math.floor(tlMonth / 3);
    return { start: new Date(tlYear, q * 3, 1), end: new Date(tlYear, q * 3 + 3, 0) };
  }
  if (scale === 'year') {
    return { start: new Date(tlYear, 0, 1), end: new Date(tlYear, 11, 31) };
  }
  // all
  const watchDates = allMovies.filter(m => m.watchDate).map(m => parseDate(m.watchDate!));
  const earliest = watchDates.length ? new Date(Math.min(...watchDates.map(d => d.getTime()))) : now;
  return { start: earliest, end: now };
}

function getXTicks(start: Date, end: Date, scale: TlScale): { label: string; pct: number }[] {
  const total = daysBetween(start, end) || 1;
  const ticks: { label: string; pct: number }[] = [];

  if (scale === 'month') {
    for (let d = new Date(start); d <= end; d = addDays(d, 5)) {
      ticks.push({ label: String(d.getDate()), pct: daysBetween(start, d) / total * 100 });
    }
  } else if (scale === 'quarter') {
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      ticks.push({ label: MONTHS_SHORT[cur.getMonth()], pct: daysBetween(start, cur) / total * 100 });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
  } else if (scale === 'year') {
    for (let m = 0; m < 12; m++) {
      const d = new Date(start.getFullYear(), m, 1);
      if (d >= start && d <= end)
        ticks.push({ label: MONTHS_SHORT[m], pct: daysBetween(start, d) / total * 100 });
    }
  } else {
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      ticks.push({
        label: `${MONTHS_SHORT[cur.getMonth()]} ${String(cur.getFullYear()).slice(2)}`,
        pct: daysBetween(start, cur) / total * 100,
      });
      cur = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
    }
  }
  return ticks.filter(t => t.pct >= 0 && t.pct <= 100);
}

function periodDates(view: StatView): { start: string; end: string } {
  const now   = new Date();
  const today = todayStr();
  if (view === 'week') {
    const dow = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    const start = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
    return { start, end: today };
  }
  if (view === 'month') {
    return {
      start: `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`,
      end: today,
    };
  }
  return { start: `${now.getFullYear()}-01-01`, end: today };
}

// ─── Modal base ───────────────────────────────────────────────────────────────

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

const inputCls = 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-violet-500/50 focus:bg-white/8 transition';

// ─── Main component ───────────────────────────────────────────────────────────

export default function FilmesPage() {
  const { user } = useAuth();

  const [movies,  setMovies]  = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);

  // modal
  const [modal,           setModal]           = useState<ModalType>(null);
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);

  // timeline
  const [tlScale, setTlScale] = useState<TlScale>('month');
  const [tlYear,  setTlYear]  = useState(new Date().getFullYear());
  const [tlMonth, setTlMonth] = useState(new Date().getMonth());

  // stats
  const [statView,        setStatView]        = useState<StatView>('month');
  const [showWatchedYear, setShowWatchedYear] = useState(new Date().getFullYear());
  const [showMovieList,   setShowMovieList]   = useState(false);

  // ── add movie form ──
  const [mvName,     setMvName]     = useState('');
  const [mvDirector, setMvDirector] = useState('');
  const [mvCover,    setMvCover]    = useState('');
  const [mvDuration, setMvDuration] = useState('');
  const [mvStatus,   setMvStatus]   = useState<'watchlist' | 'watched'>('watched');
  const [mvDate,     setMvDate]     = useState(todayStr());
  const [mvRating,   setMvRating]   = useState('');
  const [mvSaving,   setMvSaving]   = useState(false);

  // ── watch movie form ──
  const [wtDate,   setWtDate]   = useState(todayStr());
  const [wtRating, setWtRating] = useState('');
  const [wtSaving, setWtSaving] = useState(false);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'movies'));
      setMovies(snap.docs.map(d => ({ id: d.id, ...d.data() } as Movie)));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── derived ───────────────────────────────────────────────────────────────
  const selectedMovie = useMemo(
    () => movies.find(m => m.id === selectedMovieId) ?? null,
    [movies, selectedMovieId]
  );

  const watchedMovies = useMemo(
    () => movies.filter(m => m.status === 'watched'),
    [movies]
  );

  // timeline
  const tlRange = useMemo(
    () => getTimelineRange(tlScale, tlYear, tlMonth, movies),
    [tlScale, tlYear, tlMonth, movies]
  );
  const tlDays  = useMemo(() => Math.max(daysBetween(tlRange.start, tlRange.end), 1), [tlRange]);
  const tlTicks = useMemo(() => getXTicks(tlRange.start, tlRange.end, tlScale), [tlRange, tlScale]);

  const moviesInTimeline = useMemo(() => {
    return watchedMovies
      .filter(m => m.watchDate)
      .map(m => {
        const date = parseDate(m.watchDate!);
        if (date < tlRange.start || date > tlRange.end) return null;
        const pct = daysBetween(tlRange.start, date) / tlDays * 100;
        return { movie: m, pct };
      })
      .filter(Boolean) as { movie: Movie; pct: number }[];
  }, [watchedMovies, tlRange, tlDays]);

  // stats
  const statPeriod = useMemo(() => periodDates(statView), [statView]);

  const statMovies = useMemo(() => {
    const inPeriod = watchedMovies.filter(
      m => m.watchDate && m.watchDate >= statPeriod.start && m.watchDate <= statPeriod.end
    );
    const count    = inPeriod.length;
    const totalMin = inPeriod.reduce((s, m) => s + m.durationMinutes, 0);
    const ratings  = inPeriod.filter(m => m.rating != null).map(m => m.rating!);
    const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    const best      = inPeriod.reduce<Movie | null>(
      (best, m) => (m.rating ?? 0) > (best?.rating ?? -1) ? m : best, null
    );
    return { count, totalMin, avgRating: Math.round(avgRating * 10) / 10, best };
  }, [watchedMovies, statPeriod]);

  const monthlyMovies = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const prefix = `${new Date().getFullYear()}-${String(m+1).padStart(2,'0')}`;
      const inMonth = watchedMovies.filter(mv => mv.watchDate?.startsWith(prefix));
      const count   = inMonth.length;
      const hours   = Math.round(inMonth.reduce((s, mv) => s + mv.durationMinutes, 0) / 60 * 10) / 10;
      return { month: m, count, hours };
    });
  }, [watchedMovies]);

  const monthlyMax = Math.max(...monthlyMovies.map(m => m.count), 1);

  const watchedThisYear = useMemo(
    () => movies.filter(m => m.status === 'watched' && m.watchDate?.startsWith(String(showWatchedYear))),
    [movies, showWatchedYear]
  );

  // ── timeline navigation ───────────────────────────────────────────────────
  const now = new Date();
  const tlAtPresent =
    tlScale === 'all' ? true :
    tlScale === 'month' ? tlYear === now.getFullYear() && tlMonth === now.getMonth() :
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
  async function handleAddMovie() {
    if (!user || !mvName || !mvDuration) return;
    setMvSaving(true);
    try {
      const ref = await addDoc(collection(db, 'users', user.uid, 'movies'), {
        name: mvName,
        director: mvDirector,
        coverUrl: mvCover || null,
        durationMinutes: Number(mvDuration),
        addedDate: todayStr(),
        status: mvStatus,
        watchDate: mvStatus === 'watched' ? mvDate : null,
        rating: mvStatus === 'watched' && mvRating ? Number(mvRating) : null,
        createdAt: Timestamp.now(),
      });
      setMovies(prev => [...prev, {
        id: ref.id,
        name: mvName,
        director: mvDirector,
        coverUrl: mvCover || undefined,
        durationMinutes: Number(mvDuration),
        addedDate: todayStr(),
        status: mvStatus,
        watchDate: mvStatus === 'watched' ? mvDate : undefined,
        rating: mvStatus === 'watched' && mvRating ? Number(mvRating) : undefined,
      }]);
      setModal(null);
      setMvName(''); setMvDirector(''); setMvCover(''); setMvDuration('');
      setMvStatus('watched'); setMvDate(todayStr()); setMvRating('');
    } finally { setMvSaving(false); }
  }

  async function handleWatchMovie() {
    if (!user || !selectedMovieId) return;
    setWtSaving(true);
    try {
      await updateDoc(doc(db, 'users', user.uid, 'movies', selectedMovieId), {
        status: 'watched',
        watchDate: wtDate,
        rating: wtRating ? Number(wtRating) : null,
      });
      setMovies(prev => prev.map(m =>
        m.id === selectedMovieId
          ? { ...m, status: 'watched', watchDate: wtDate, rating: wtRating ? Number(wtRating) : undefined }
          : m
      ));
      setModal(null);
      setWtDate(todayStr()); setWtRating('');
    } finally { setWtSaving(false); }
  }

  async function handleDeleteMovie(movieId: string) {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'movies', movieId));
    setMovies(prev => prev.filter(m => m.id !== movieId));
    setModal(null);
  }

  function openDetail(movie: Movie) {
    setSelectedMovieId(movie.id);
    setModal('movieDetail');
  }

  function openWatch(movieId: string) {
    setSelectedMovieId(movieId);
    setWtDate(todayStr());
    setModal('watchMovie');
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="flex h-48 items-center justify-center text-slate-500">Carregando...</div>;
  }

  const watchlistMovies = movies.filter(m => m.status === 'watchlist');

  return (
    <div className="space-y-5">

      {/* Actions row */}
      <div className="flex items-center gap-3">
        <button onClick={() => setModal('addMovie')}
          className="flex items-center gap-2 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-300 transition hover:bg-violet-500/20">
          <Plus size={15} /> Adicionar Filme
        </button>
        <button onClick={loadData}
          className="ml-auto flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-400 transition hover:border-emerald-500/30 hover:text-emerald-300">
          <RefreshCw size={12} /> Atualizar
        </button>
      </div>

      {/* Watchlist */}
      {watchlistMovies.length > 0 && (
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
          <p className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-500">Para assistir</p>
          <div className="space-y-3">
            {watchlistMovies.map(movie => (
              <div key={movie.id} className="flex items-center gap-4">
                {movie.coverUrl
                  ? <img src={movie.coverUrl} alt="" className="h-12 w-9 rounded-md object-cover shrink-0" />
                  : <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded-md bg-violet-500/20 text-base font-bold text-violet-300">{movie.name[0]}</div>
                }
                <div className="flex-1 min-w-0">
                  <button onClick={() => openDetail(movie)}
                    className="text-sm font-medium text-white hover:text-violet-300 transition truncate block text-left">
                    {movie.name}
                  </button>
                  <p className="text-xs text-slate-500 truncate">{movie.director}</p>
                  <p className="text-xs text-slate-600">{fmtDuration(movie.durationMinutes)}</p>
                </div>
                <button onClick={() => openWatch(movie.id)}
                  className="shrink-0 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/20">
                  Marcar assistido
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
        {/* Scale tabs + navigation */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-2xl border border-white/5 bg-slate-900/40 p-1">
            {(['month','quarter','year','all'] as TlScale[]).map(s => (
              <button key={s} onClick={() => setTlScale(s)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  tlScale === s ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
                }`}>
                {s === 'month' ? 'Mês' : s === 'quarter' ? 'Trimestre' : s === 'year' ? 'Ano' : 'Tudo'}
              </button>
            ))}
          </div>

          {tlScale !== 'all' && (
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={tlPrev}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-violet-500/30 hover:text-white">
                <ChevronLeft size={15} />
              </button>
              <span className="min-w-[120px] text-center text-sm font-medium text-slate-200">{tlLabel}</span>
              <button onClick={tlNext} disabled={tlAtPresent}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-violet-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-30">
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          {tlScale === 'all' && (
            <span className="ml-auto text-sm font-medium text-slate-400">{tlLabel}</span>
          )}
        </div>

        {moviesInTimeline.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-600">Nenhum filme assistido neste período.</p>
        ) : (
          <div>
            {/* X-axis ticks */}
            <div className="relative mb-2 ml-28 h-5 border-b border-white/5">
              {tlTicks.map((tick, i) => (
                <span key={i}
                  className="absolute -translate-x-1/2 text-[9px] text-slate-600"
                  style={{ left: `${tick.pct}%`, bottom: 4 }}>
                  {tick.label}
                </span>
              ))}
            </div>

            {/* Movie rows — dot at watchDate */}
            <div className="space-y-1.5" style={{ overflow: 'visible' }}>
              {moviesInTimeline.map(({ movie, pct }) => (
                <div key={movie.id} className="flex items-center gap-2" style={{ height: 36 }}>
                  {/* Label */}
                  <button onClick={() => openDetail(movie)}
                    className="w-28 shrink-0 text-right text-[11px] text-slate-400 truncate hover:text-violet-300 transition pr-2">
                    {movie.name}
                  </button>
                  {/* Dot area */}
                  <div className="relative flex-1" style={{ height: 36, overflow: 'visible' }}>
                    <div className="group/dot absolute top-1/2 -translate-y-1/2"
                      style={{ left: `${pct}%`, transform: 'translateX(-50%) translateY(-50%)' }}>
                      <button
                        className="block h-4 w-4 rounded-full bg-violet-500/70 border-2 border-violet-400/50 hover:bg-violet-400 hover:scale-125 transition"
                        onClick={() => openDetail(movie)}
                      />
                      {/* Tooltip */}
                      <div className="pointer-events-none absolute z-30 opacity-0 group-hover/dot:opacity-100 transition-opacity"
                        style={{ bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 }}>
                        <div className="rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 shadow-xl" style={{ minWidth: 110 }}>
                          <p className="text-center text-[10px] font-semibold text-white whitespace-nowrap">{movie.name}</p>
                          {movie.director && <p className="text-center text-[9px] text-slate-400">{movie.director}</p>}
                          <p className="text-center text-[9px] text-violet-400">{fmtDuration(movie.durationMinutes)}</p>
                          {movie.rating != null && <p className="text-center text-[9px] text-yellow-400">★ {movie.rating}/10</p>}
                        </div>
                        <div className="mx-auto h-1.5 w-1.5 -translate-y-px rotate-45 border-b border-r border-white/10 bg-slate-800" />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
        <p className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-500">Estatísticas</p>

        {/* Period tabs */}
        <div className="mb-5 flex gap-1 rounded-2xl border border-white/5 bg-slate-900/40 p-1">
          {(['week','month','year'] as StatView[]).map(v => (
            <button key={v} onClick={() => setStatView(v)}
              className={`flex-1 rounded-xl py-1.5 text-xs font-medium transition ${
                statView === v ? 'bg-violet-500/20 text-violet-300' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {v === 'week' ? 'Semana' : v === 'month' ? 'Mês' : 'Ano'}
            </button>
          ))}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Filmes assistidos', value: String(statMovies.count) },
            { label: 'Horas assistidas',  value: fmtDuration(statMovies.totalMin) },
            { label: 'Nota média',        value: statMovies.avgRating > 0 ? `${statMovies.avgRating}/10` : '–' },
            {
              label: 'Melhor nota',
              value: statMovies.best?.name ?? '–',
              sub: statMovies.best?.rating != null ? `${statMovies.best.rating}/10` : '',
            },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-2xl border border-white/5 bg-slate-900/40 p-4">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-slate-600">{label}</p>
              <p className="text-xl font-bold text-white truncate" title={value}>{value}</p>
              {sub && <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p>}
            </div>
          ))}
        </div>

        {/* Monthly movies bar chart */}
        <div className="mt-5 border-t border-white/5 pt-5">
          <p className="mb-3 text-xs text-slate-500">Filmes por mês ({new Date().getFullYear()})</p>
          <div className="flex items-end gap-px" style={{ height: 80 }}>
            {monthlyMovies.map(({ month, count, hours }) => {
              const h = monthlyMax > 0 ? Math.max(count / monthlyMax * 80, count > 0 ? 2 : 0) : 0;
              const isCur = month === new Date().getMonth();
              return (
                <div key={month} style={{ flex: 1, height: 80, display: 'flex', alignItems: 'flex-end', position: 'relative' }}
                  className="group/mb">
                  {count > 0 && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 opacity-0 transition-opacity group-hover/mb:opacity-100">
                      <div className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-[9px] text-white whitespace-nowrap shadow-xl">
                        {count} filme{count > 1 ? 's' : ''} · {hours}h
                      </div>
                    </div>
                  )}
                  <div style={{ width: '100%', height: Math.max(h, 2) }}
                    className={`rounded-t-sm transition-all duration-500 ${
                      count > 0 ? (isCur ? 'bg-violet-400' : 'bg-violet-600/60') : 'bg-slate-800/30'
                    }`} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-px mt-1">
            {monthlyMovies.map(({ month }) => (
              <div key={month} style={{ flex: 1 }}
                className={`text-center text-[9px] ${month === new Date().getMonth() ? 'font-bold text-violet-400' : 'text-slate-600'}`}>
                {MONTHS_SHORT[month]}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Watched per year */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowWatchedYear(y => y - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white transition">
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-medium text-slate-200">{showWatchedYear}</span>
            <button onClick={() => setShowWatchedYear(y => y + 1)}
              disabled={showWatchedYear >= new Date().getFullYear()}
              className="flex h-7 w-7 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white transition disabled:opacity-30 disabled:pointer-events-none">
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white">{watchedThisYear.length}</span>
            <span className="text-xs text-slate-500">filmes assistidos</span>
            {watchedThisYear.length > 0 && (
              <button onClick={() => setShowMovieList(v => !v)}
                className="text-[11px] text-violet-400 hover:text-violet-300 transition">
                {showMovieList ? 'Ocultar' : 'Ver lista'}
              </button>
            )}
          </div>
        </div>

        {showMovieList && watchedThisYear.length > 0 && (
          <div className="space-y-2 border-t border-white/5 pt-4">
            {[...watchedThisYear]
              .sort((a, b) => (b.watchDate ?? '').localeCompare(a.watchDate ?? ''))
              .map(movie => (
                <div key={movie.id} className="flex items-center gap-3">
                  {movie.coverUrl
                    ? <img src={movie.coverUrl} alt="" className="h-10 w-7 rounded object-cover shrink-0" />
                    : <div className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-violet-500/20 text-sm font-bold text-violet-300">{movie.name[0]}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{movie.name}</p>
                    <p className="text-xs text-slate-500 truncate">{movie.director}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-600">{fmtDuration(movie.durationMinutes)}</span>
                    {movie.rating != null && (
                      <div className="flex items-center gap-1">
                        <Star size={11} className="text-yellow-400 fill-yellow-400" />
                        <span className="text-xs font-medium text-yellow-300">{movie.rating}/10</span>
                      </div>
                    )}
                    {movie.watchDate && (
                      <span className="text-[10px] text-slate-600">
                        {new Date(movie.watchDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}

        {watchedThisYear.length === 0 && (
          <p className="text-center text-sm text-slate-600 py-2">Nenhum filme assistido em {showWatchedYear}.</p>
        )}
      </div>

      {/* ── Modals ── */}

      {modal === 'addMovie' && (
        <Modal title="Adicionar Filme" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nome do filme *">
              <input className={inputCls} value={mvName} onChange={e => setMvName(e.target.value)} placeholder="Ex: Interestelar" />
            </Field>
            <Field label="Diretor">
              <input className={inputCls} value={mvDirector} onChange={e => setMvDirector(e.target.value)} placeholder="Ex: Christopher Nolan" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duração (minutos) *">
                <input className={inputCls} type="number" min={1} value={mvDuration} onChange={e => setMvDuration(e.target.value)} placeholder="169" />
              </Field>
              <Field label="Status">
                <select className={inputCls} value={mvStatus} onChange={e => setMvStatus(e.target.value as 'watchlist' | 'watched')}>
                  <option value="watched">Já assistido</option>
                  <option value="watchlist">Watchlist</option>
                </select>
              </Field>
            </div>
            {mvStatus === 'watched' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data assistido">
                  <input className={inputCls} type="date" value={mvDate} onChange={e => setMvDate(e.target.value)} />
                </Field>
                <Field label="Nota (0–10)">
                  <input className={inputCls} type="number" min={0} max={10} step={0.5}
                    value={mvRating} onChange={e => setMvRating(e.target.value)} placeholder="8.5" />
                </Field>
              </div>
            )}
            <Field label="URL da capa (opcional)">
              <input className={inputCls} value={mvCover} onChange={e => setMvCover(e.target.value)} placeholder="https://..." />
            </Field>
            <button onClick={handleAddMovie} disabled={!mvName || !mvDuration || mvSaving}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl border border-violet-500/30 bg-violet-500/15 py-2.5 text-sm font-medium text-violet-300 transition hover:bg-violet-500/25 disabled:opacity-50">
              {mvSaving ? 'Salvando...' : <><Check size={14} /> Salvar filme</>}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'watchMovie' && selectedMovie && (
        <Modal title={`Marcar como assistido`} onClose={() => setModal(null)}>
          <p className="mb-4 text-sm text-slate-400">{selectedMovie.name}</p>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nota (0–10)">
                <input className={inputCls} type="number" min={0} max={10} step={0.5}
                  value={wtRating} onChange={e => setWtRating(e.target.value)} placeholder="8.5" />
              </Field>
              <Field label="Data assistido">
                <input className={inputCls} type="date" value={wtDate} onChange={e => setWtDate(e.target.value)} />
              </Field>
            </div>
            <button onClick={handleWatchMovie} disabled={wtSaving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 py-2.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50">
              {wtSaving ? 'Salvando...' : <><Check size={14} /> Marcar como assistido</>}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'movieDetail' && selectedMovie && (
        <Modal title={selectedMovie.name} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div className="flex gap-4">
              {selectedMovie.coverUrl
                ? <img src={selectedMovie.coverUrl} alt="" className="h-24 w-16 rounded-lg object-cover shrink-0" />
                : <div className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-2xl font-bold text-violet-300">{selectedMovie.name[0]}</div>
              }
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white">{selectedMovie.name}</p>
                {selectedMovie.director && <p className="text-sm text-slate-400">{selectedMovie.director}</p>}
                <p className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                  <Clock size={11} /> {fmtDuration(selectedMovie.durationMinutes)}
                </p>
                {selectedMovie.status === 'watched' && selectedMovie.watchDate && (
                  <p className="text-xs text-emerald-400">
                    Assistido em {new Date(selectedMovie.watchDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                  </p>
                )}
                {selectedMovie.status === 'watchlist' && (
                  <p className="mt-1 text-xs text-violet-400">Na watchlist</p>
                )}
                {selectedMovie.rating != null && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-yellow-400">
                    <Star size={11} className="fill-yellow-400" /> {selectedMovie.rating}/10
                  </p>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              {selectedMovie.status === 'watchlist' && (
                <button onClick={() => openWatch(selectedMovie.id)}
                  className="flex-1 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition">
                  Marcar como assistido
                </button>
              )}
              <button onClick={() => handleDeleteMovie(selectedMovie.id)}
                className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs font-medium text-red-400 hover:bg-red-500/20 transition">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}
