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
import CalendarHeatmap from '@/components/CalendarHeatmap';

// ─── types ────────────────────────────────────────────────────────────────────

interface Movie {
  id: string;
  name: string;
  director: string;
  genres: string[];
  coverUrl?: string;
  durationMinutes: number;
  watchDate?: string;    // YYYY-MM-DD
  addedDate: string;     // YYYY-MM-DD
  rating?: number;       // 0–10
  status: 'watchlist' | 'watched';
}

type ModalType = null | 'addMovie' | 'watchMovie' | 'editMovie';
type TlScale   = 'month' | 'quarter' | 'year' | 'all';
type StatView  = 'week' | 'month' | 'year';

// ─── constants ────────────────────────────────────────────────────────────────

const GENRES = [
  'Ação', 'Aventura', 'Animação', 'Comédia', 'Crime', 'Documentário',
  'Drama', 'Fantasia', 'Ficção Científica', 'Terror', 'Suspense', 'Thriller',
  'Romance', 'Musical', 'Biografia', 'Histórico', 'Guerra', 'Mistério', 'Western',
];

const MONTHS_PT    = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// Níveis de intensidade do heatmap (1 filme, 2, 3, 4+)
const HEATMAP_LEVELS = ['bg-violet-500/30', 'bg-violet-500/55', 'bg-violet-500/75', 'bg-violet-500/95'];

// ─── helpers ──────────────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function parseDate(s: string) { return new Date(s + 'T12:00:00'); }
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
  const watchDates = allMovies.filter(m => m.watchDate).map(m => parseDate(m.watchDate!));
  const earliest = watchDates.length ? new Date(Math.min(...watchDates.map(d => d.getTime()))) : now;
  return { start: earliest, end: now };
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
      <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0d1b2a] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
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

// ─── DirectorSelect ───────────────────────────────────────────────────────────

function DirectorSelect({ value, onChange, directors }: {
  value: string;
  onChange: (v: string) => void;
  directors: string[];
}) {
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => directors.filter(d => d.toLowerCase().includes(value.toLowerCase())),
    [directors, value]
  );

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Ex: Christopher Nolan"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-white/10 bg-[#0d1b2a] py-1 shadow-xl">
          {filtered.map(d => (
            <button key={d} type="button"
              className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 transition"
              onMouseDown={() => { onChange(d); setOpen(false); }}>
              {d}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── GenreMultiSelect ─────────────────────────────────────────────────────────

function GenreMultiSelect({ selected, onChange }: {
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(genre: string) {
    onChange(selected.includes(genre)
      ? selected.filter(g => g !== genre)
      : [...selected, genre]
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {GENRES.map(genre => (
        <button key={genre} type="button"
          onClick={() => toggle(genre)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition border ${
            selected.includes(genre)
              ? 'border-violet-500/50 bg-violet-500/20 text-violet-300'
              : 'border-white/10 bg-white/5 text-slate-500 hover:border-white/20 hover:text-slate-300'
          }`}>
          {genre}
        </button>
      ))}
    </div>
  );
}

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
  const [mvGenres,   setMvGenres]   = useState<string[]>([]);
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

  // ── edit movie form ──
  const [editName,     setEditName]     = useState('');
  const [editDirector, setEditDirector] = useState('');
  const [editGenres,   setEditGenres]   = useState<string[]>([]);
  const [editCover,    setEditCover]    = useState('');
  const [editDuration, setEditDuration] = useState('');
  const [editStatus,   setEditStatus]   = useState<'watchlist' | 'watched'>('watched');
  const [editDate,     setEditDate]     = useState('');
  const [editRating,   setEditRating]   = useState('');
  const [editSaving,   setEditSaving]   = useState(false);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'movies'));
      setMovies(snap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, genres: data.genres ?? [] } as Movie;
      }));
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

  const directorList = useMemo(
    () => [...new Set(movies.map(m => m.director).filter(Boolean))].sort(),
    [movies]
  );

  // timeline
  const tlRange = useMemo(
    () => getTimelineRange(tlScale, tlYear, tlMonth, movies),
    [tlScale, tlYear, tlMonth, movies]
  );

  const moviesByDate = useMemo(() => {
    const map: Record<string, Movie[]> = {};
    watchedMovies.forEach(m => {
      if (!m.watchDate) return;
      (map[m.watchDate] ??= []).push(m);
    });
    return map;
  }, [watchedMovies]);

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
        genres: mvGenres,
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
        genres: mvGenres,
        coverUrl: mvCover || undefined,
        durationMinutes: Number(mvDuration),
        addedDate: todayStr(),
        status: mvStatus,
        watchDate: mvStatus === 'watched' ? mvDate : undefined,
        rating: mvStatus === 'watched' && mvRating ? Number(mvRating) : undefined,
      }]);
      setModal(null);
      setMvName(''); setMvDirector(''); setMvGenres([]); setMvCover(''); setMvDuration('');
      setMvStatus('watched'); setMvDate(todayStr()); setMvRating('');
    } finally { setMvSaving(false); }
  }

  async function handleEditMovie() {
    if (!user || !selectedMovieId || !editName || !editDuration) return;
    setEditSaving(true);
    try {
      const updates = {
        name: editName,
        director: editDirector,
        genres: editGenres,
        coverUrl: editCover || null,
        durationMinutes: Number(editDuration),
        status: editStatus,
        watchDate: editStatus === 'watched' ? editDate : null,
        rating: editStatus === 'watched' && editRating ? Number(editRating) : null,
      };
      await updateDoc(doc(db, 'users', user.uid, 'movies', selectedMovieId), updates);
      setMovies(prev => prev.map(m =>
        m.id === selectedMovieId
          ? {
              ...m,
              name: editName,
              director: editDirector,
              genres: editGenres,
              coverUrl: editCover || undefined,
              durationMinutes: Number(editDuration),
              status: editStatus,
              watchDate: editStatus === 'watched' ? editDate : undefined,
              rating: editStatus === 'watched' && editRating ? Number(editRating) : undefined,
            }
          : m
      ));
      setModal(null);
    } finally { setEditSaving(false); }
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

  function openEdit(movie: Movie) {
    setSelectedMovieId(movie.id);
    setEditName(movie.name);
    setEditDirector(movie.director);
    setEditGenres(movie.genres ?? []);
    setEditCover(movie.coverUrl ?? '');
    setEditDuration(String(movie.durationMinutes));
    setEditStatus(movie.status);
    setEditDate(movie.watchDate ?? todayStr());
    setEditRating(movie.rating != null ? String(movie.rating) : '');
    setModal('editMovie');
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
                  <button onClick={() => openEdit(movie)}
                    className="text-sm font-medium text-white hover:text-violet-300 transition truncate block text-left">
                    {movie.name}
                  </button>
                  <p className="text-xs text-slate-500 truncate">{movie.director}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-600">{fmtDuration(movie.durationMinutes)}</p>
                    {(movie.genres ?? []).length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {(movie.genres ?? []).slice(0, 2).map(g => (
                          <span key={g} className="rounded-full border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-400">{g}</span>
                        ))}
                      </div>
                    )}
                  </div>
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

        {!Object.keys(moviesByDate).some(k => { const d = parseDate(k); return d >= tlRange.start && d <= tlRange.end; }) ? (
          <p className="py-8 text-center text-sm text-slate-600">Nenhum filme assistido neste período.</p>
        ) : (
          <>
            <CalendarHeatmap
              start={tlRange.start}
              end={tlRange.end}
              today={todayStr()}
              getCell={key => {
                const list = moviesByDate[key];
                if (!list || list.length === 0) return null;
                const level = Math.min(list.length, 4);
                return {
                  colorClass: HEATMAP_LEVELS[level - 1],
                  tooltip: (
                    <div>
                      <p className="text-center text-[10px] font-semibold text-white whitespace-nowrap">
                        {parseDate(key).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                        {' · '}{list.length} {list.length === 1 ? 'filme' : 'filmes'}
                      </p>
                      <div className="mt-1 space-y-0.5">
                        {list.map(m => (
                          <button key={m.id} onClick={() => openEdit(m)}
                            className="block w-full max-w-[160px] truncate text-left text-[9px] text-violet-300 hover:text-violet-100">
                            {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  ),
                };
              }}
            />
            <div className="mt-4 flex items-center gap-1.5 border-t border-white/5 pt-4 text-xs text-slate-500">
              <span>Menos</span>
              <span className="h-3 w-3 rounded-sm bg-slate-900/40" />
              {HEATMAP_LEVELS.map(cls => <span key={cls} className={`h-3 w-3 rounded-sm ${cls}`} />)}
              <span>Mais</span>
            </div>
          </>
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
                <button key={movie.id} onClick={() => openEdit(movie)}
                  className="flex w-full items-center gap-3 rounded-2xl p-1.5 transition hover:bg-white/5 text-left">
                  {movie.coverUrl
                    ? <img src={movie.coverUrl} alt="" className="h-10 w-7 rounded object-cover shrink-0" />
                    : <div className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-violet-500/20 text-sm font-bold text-violet-300">{movie.name[0]}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{movie.name}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs text-slate-500 truncate">{movie.director}</p>
                      {(movie.genres ?? []).slice(0, 2).map(g => (
                        <span key={g} className="rounded-full border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[9px] text-violet-400">{g}</span>
                      ))}
                    </div>
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
                </button>
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
              <DirectorSelect value={mvDirector} onChange={setMvDirector} directors={directorList} />
            </Field>
            <Field label="Gêneros">
              <GenreMultiSelect selected={mvGenres} onChange={setMvGenres} />
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

      {modal === 'editMovie' && selectedMovie && (
        <Modal title="Editar Filme" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nome do filme *">
              <input className={inputCls} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Ex: Interestelar" />
            </Field>
            <Field label="Diretor">
              <DirectorSelect value={editDirector} onChange={setEditDirector} directors={directorList} />
            </Field>
            <Field label="Gêneros">
              <GenreMultiSelect selected={editGenres} onChange={setEditGenres} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Duração (minutos) *">
                <input className={inputCls} type="number" min={1} value={editDuration} onChange={e => setEditDuration(e.target.value)} placeholder="169" />
              </Field>
              <Field label="Status">
                <select className={inputCls} value={editStatus} onChange={e => setEditStatus(e.target.value as 'watchlist' | 'watched')}>
                  <option value="watched">Já assistido</option>
                  <option value="watchlist">Watchlist</option>
                </select>
              </Field>
            </div>
            {editStatus === 'watched' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data assistido">
                  <input className={inputCls} type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                </Field>
                <Field label="Nota (0–10)">
                  <input className={inputCls} type="number" min={0} max={10} step={0.5}
                    value={editRating} onChange={e => setEditRating(e.target.value)} placeholder="8.5" />
                </Field>
              </div>
            )}
            <Field label="URL da capa (opcional)">
              <input className={inputCls} value={editCover} onChange={e => setEditCover(e.target.value)} placeholder="https://..." />
            </Field>
            <div className="flex gap-2 pt-1">
              <button onClick={handleEditMovie} disabled={!editName || !editDuration || editSaving}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-violet-500/30 bg-violet-500/15 py-2.5 text-sm font-medium text-violet-300 transition hover:bg-violet-500/25 disabled:opacity-50">
                {editSaving ? 'Salvando...' : <><Check size={14} /> Salvar alterações</>}
              </button>
              <button onClick={() => handleDeleteMovie(selectedMovie.id)}
                className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/20 transition">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  );
}
