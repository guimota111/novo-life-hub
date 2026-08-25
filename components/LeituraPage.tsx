'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc, increment, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import {
  Plus, ChevronLeft, ChevronRight, X, Check, Star, BookOpen,
  RefreshCw, Trash2, History,
} from 'lucide-react';

// ─── types ────────────────────────────────────────────────────────────────────

interface Book {
  id: string;
  name: string;
  author: string;
  genres: string[];
  coverUrl?: string;
  totalPages: number;
  startDate: string;       // YYYY-MM-DD
  finishDate?: string;
  rating?: number;         // 0–10
  status: 'reading' | 'finished';
}

interface ReadingSession {
  id: string;
  bookId: string;
  date: string;            // YYYY-MM-DD
  pagesRead: number;
}

type ModalType = null | 'addBook' | 'addSession' | 'finishBook' | 'editBook';
type TlScale   = 'month' | 'quarter' | 'year' | 'all';
type StatView  = 'week' | 'month' | 'year';
type SessionInput = 'pages' | 'current';

// ─── constants ────────────────────────────────────────────────────────────────

const BOOK_GENRES = [
  'Ficção', 'Romance', 'Fantasia', 'Ficção Científica', 'Terror', 'Mistério',
  'Thriller', 'Aventura', 'Histórico', 'Biografia', 'Autoajuda', 'Negócios',
  'Ciência', 'Filosofia', 'Poesia', 'Conto', 'Clássico', 'Infantil', 'Mangá', 'HQ',
];

const MONTHS_PT    = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function getTimelineRange(scale: TlScale, tlYear: number, tlMonth: number, allBooks: Book[]): { start: Date; end: Date } {
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
  const starts = allBooks.map(b => parseDate(b.startDate));
  const earliest = starts.length ? new Date(Math.min(...starts.map(d => d.getTime()))) : now;
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

const inputCls = 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-sky-500/50 focus:bg-white/8 transition';

// ─── AuthorSelect ─────────────────────────────────────────────────────────────

function AuthorSelect({ value, onChange, authors }: {
  value: string;
  onChange: (v: string) => void;
  authors: string[];
}) {
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => authors.filter(a => a.toLowerCase().includes(value.toLowerCase())),
    [authors, value]
  );

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Ex: J.R.R. Tolkien"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-white/10 bg-[#0d1b2a] py-1 shadow-xl">
          {filtered.map(a => (
            <button key={a} type="button"
              className="w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-white/5 transition"
              onMouseDown={() => { onChange(a); setOpen(false); }}>
              {a}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── BookGenreMultiSelect ─────────────────────────────────────────────────────

function BookGenreMultiSelect({ selected, onChange }: {
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
      {BOOK_GENRES.map(genre => (
        <button key={genre} type="button"
          onClick={() => toggle(genre)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition border ${
            selected.includes(genre)
              ? 'border-sky-500/50 bg-sky-500/20 text-sky-300'
              : 'border-white/10 bg-white/5 text-slate-500 hover:border-white/20 hover:text-slate-300'
          }`}>
          {genre}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LeituraPage() {
  const { user } = useAuth();

  const [books,    setBooks]    = useState<Book[]>([]);
  const [sessions, setSessions] = useState<ReadingSession[]>([]);
  const [loading,  setLoading]  = useState(true);

  // modal
  const [modal,          setModal]          = useState<ModalType>(null);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  // timeline
  const [tlScale,  setTlScale]  = useState<TlScale>('month');
  const [tlYear,   setTlYear]   = useState(new Date().getFullYear());
  const [tlMonth,  setTlMonth]  = useState(new Date().getMonth());

  // stats
  const [statView,         setStatView]         = useState<StatView>('month');
  const [showFinishedYear, setShowFinishedYear] = useState(new Date().getFullYear());
  const [showBookList,     setShowBookList]     = useState(false);

  // sessions panel
  const [showSessions,   setShowSessions]   = useState(false);
  const [ssFilter,       setSsFilter]       = useState('all');
  const [ssLimit,        setSsLimit]        = useState(20);
  const [ssConfirmDel,   setSsConfirmDel]   = useState<string | null>(null);
  const [ssDeleting,     setSsDeleting]     = useState<string | null>(null);

  // ── add book form ──
  const [bkName,   setBkName]   = useState('');
  const [bkAuthor, setBkAuthor] = useState('');
  const [bkGenres, setBkGenres] = useState<string[]>([]);
  const [bkCover,  setBkCover]  = useState('');
  const [bkPages,  setBkPages]  = useState('');
  const [bkStart,  setBkStart]  = useState(todayStr());
  const [bkSaving, setBkSaving] = useState(false);

  // ── add session form ──
  const [ssBook,    setSsBook]    = useState('');
  const [ssPages,   setSsPages]   = useState('');
  const [ssMode,    setSsMode]    = useState<SessionInput>('pages');
  const [ssCurrent, setSsCurrent] = useState('');
  const [ssDate,    setSsDate]    = useState(todayStr());
  const [ssSaving,  setSsSaving]  = useState(false);

  // ── finish book form ──
  const [fnRating,  setFnRating]  = useState('');
  const [fnDate,    setFnDate]    = useState(todayStr());
  const [fnPages,   setFnPages]   = useState('');
  const [fnLogRest, setFnLogRest] = useState(true);
  const [fnSaving,  setFnSaving]  = useState(false);

  // ── edit book form ──
  const [editName,   setEditName]   = useState('');
  const [editAuthor, setEditAuthor] = useState('');
  const [editGenres, setEditGenres] = useState<string[]>([]);
  const [editCover,  setEditCover]  = useState('');
  const [editPages,  setEditPages]  = useState('');
  const [editStart,  setEditStart]  = useState('');
  const [editStatus, setEditStatus] = useState<'reading' | 'finished'>('reading');
  const [editFinish, setEditFinish] = useState('');
  const [editRating, setEditRating] = useState('');
  const [editLogRest, setEditLogRest] = useState(true);
  const [editSaving, setEditSaving] = useState(false);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [bSnap, sSnap] = await Promise.all([
        getDocs(collection(db, 'users', user.uid, 'books')),
        getDocs(collection(db, 'users', user.uid, 'reading_sessions')),
      ]);
      setBooks(bSnap.docs.map(d => {
        const data = d.data();
        return { id: d.id, ...data, genres: data.genres ?? [] } as Book;
      }));
      setSessions(sSnap.docs.map(d => ({ id: d.id, ...d.data() } as ReadingSession)));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── derived ───────────────────────────────────────────────────────────────
  const pagesByDate = useMemo(() => {
    const map: Record<string, number> = {};
    sessions.forEach(s => { map[s.date] = (map[s.date] ?? 0) + s.pagesRead; });
    return map;
  }, [sessions]);

  const pagesByBook = useMemo(() => {
    const map: Record<string, number> = {};
    sessions.forEach(s => { map[s.bookId] = (map[s.bookId] ?? 0) + s.pagesRead; });
    return map;
  }, [sessions]);

  const selectedBook = useMemo(
    () => books.find(b => b.id === selectedBookId) ?? null,
    [books, selectedBookId]
  );

  // páginas já registradas do livro escolhido no modal de sessão
  const ssBookRead = pagesByBook[ssBook] ?? 0;
  const ssBookTotal = books.find(b => b.id === ssBook)?.totalPages ?? 0;

  // quantas páginas a sessão vai registrar, conforme o modo de entrada
  const ssComputedPages = useMemo(() => {
    if (ssMode === 'pages') return ssPages === '' ? null : Number(ssPages);
    if (ssCurrent === '') return null;
    return Number(ssCurrent) - ssBookRead;
  }, [ssMode, ssPages, ssCurrent, ssBookRead]);

  const ssValid = ssComputedPages != null && Number.isFinite(ssComputedPages) && ssComputedPages > 0;

  // páginas que faltariam ao finalizar pelo modal de edição (usa o total digitado no form)
  const editRemaining = useMemo(() => {
    if (!selectedBook) return 0;
    return Math.max(0, Number(editPages || 0) - (pagesByBook[selectedBook.id] ?? 0));
  }, [selectedBook, editPages, pagesByBook]);

  // só oferece registrar quando o livro está saindo de "lendo" para "finalizado"
  const editFinishing = selectedBook?.status === 'reading' && editStatus === 'finished';

  // páginas que faltam para terminar o livro selecionado
  const fnRemaining = useMemo(() => {
    if (!selectedBook) return 0;
    return Math.max(0, selectedBook.totalPages - (pagesByBook[selectedBook.id] ?? 0));
  }, [selectedBook, pagesByBook]);

  const bookById = useMemo(() => {
    const map: Record<string, Book> = {};
    books.forEach(b => { map[b.id] = b; });
    return map;
  }, [books]);

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.date.localeCompare(a.date)),
    [sessions]
  );

  const filteredSessions = useMemo(
    () => ssFilter === 'all' ? sortedSessions : sortedSessions.filter(s => s.bookId === ssFilter),
    [sortedSessions, ssFilter]
  );

  const filteredSessionPages = useMemo(
    () => filteredSessions.reduce((s, x) => s + x.pagesRead, 0),
    [filteredSessions]
  );

  const authorList = useMemo(
    () => [...new Set(books.map(b => b.author).filter(Boolean))].sort(),
    [books]
  );

  // timeline
  const tlRange = useMemo(
    () => getTimelineRange(tlScale, tlYear, tlMonth, books),
    [tlScale, tlYear, tlMonth, books]
  );
  const tlDays  = useMemo(() => Math.max(daysBetween(tlRange.start, tlRange.end), 1), [tlRange]);
  const tlTicks = useMemo(() => getXTicks(tlRange.start, tlRange.end, tlScale), [tlRange, tlScale]);

  const booksInTimeline = useMemo(() => {
    const today = parseDate(todayStr());
    return books
      .map(book => {
        const bStart   = parseDate(book.startDate);
        const bEnd     = book.finishDate ? parseDate(book.finishDate) : today;
        const visStart = bStart < tlRange.start ? tlRange.start : bStart;
        const visEnd   = bEnd   > tlRange.end   ? tlRange.end   : bEnd;
        if (visEnd < visStart) return null;
        const leftPct  = daysBetween(tlRange.start, visStart) / tlDays * 100;
        const widthPct = Math.max(daysBetween(visStart, visEnd) / tlDays * 100, 0.5);
        return { book, leftPct, widthPct };
      })
      .filter(Boolean) as { book: Book; leftPct: number; widthPct: number }[];
  }, [books, tlRange, tlDays]);

  // stats
  const statPeriod = useMemo(() => periodDates(statView), [statView]);

  const statPages = useMemo(() => {
    const entries = Object.entries(pagesByDate).filter(
      ([d]) => d >= statPeriod.start && d <= statPeriod.end
    );
    const total    = entries.reduce((s, [, p]) => s + p, 0);
    const days     = entries.length;
    const best     = entries.reduce((m, [, p]) => Math.max(m, p), 0);
    const bestDate = entries.find(([, p]) => p === best)?.[0] ?? '';
    return { total, days, avg: days > 0 ? Math.round(total / days) : 0, best, bestDate };
  }, [pagesByDate, statPeriod]);

  const monthlyPages = useMemo(() => {
    return Array.from({ length: 12 }, (_, m) => {
      const prefix = `${new Date().getFullYear()}-${String(m+1).padStart(2,'0')}`;
      const total  = Object.entries(pagesByDate)
        .filter(([d]) => d.startsWith(prefix))
        .reduce((s, [, p]) => s + p, 0);
      return { month: m, total };
    });
  }, [pagesByDate]);

  const monthlyMax = Math.max(...monthlyPages.map(m => m.total), 1);

  const finishedThisYear = useMemo(
    () => books.filter(b => b.status === 'finished' && b.finishDate?.startsWith(String(showFinishedYear))),
    [books, showFinishedYear]
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
  async function handleAddBook() {
    if (!user || !bkName || !bkPages) return;
    setBkSaving(true);
    try {
      const ref = await addDoc(collection(db, 'users', user.uid, 'books'), {
        name: bkName, author: bkAuthor, genres: bkGenres, coverUrl: bkCover || null,
        totalPages: Number(bkPages), startDate: bkStart,
        status: 'reading', createdAt: Timestamp.now(),
      });
      setBooks(prev => [...prev, {
        id: ref.id, name: bkName, author: bkAuthor, genres: bkGenres,
        coverUrl: bkCover || undefined, totalPages: Number(bkPages),
        startDate: bkStart, status: 'reading',
      }]);
      setModal(null);
      setBkName(''); setBkAuthor(''); setBkGenres([]); setBkCover(''); setBkPages(''); setBkStart(todayStr());
    } finally { setBkSaving(false); }
  }

  async function handleEditBook() {
    if (!user || !selectedBookId || !editName || !editPages) return;
    setEditSaving(true);
    try {
      const updates = {
        name: editName,
        author: editAuthor,
        genres: editGenres,
        coverUrl: editCover || null,
        totalPages: Number(editPages),
        startDate: editStart,
        status: editStatus,
        finishDate: editStatus === 'finished' ? editFinish : null,
        rating: editStatus === 'finished' && editRating ? Number(editRating) : null,
      };
      // finalizar pela edição também registra as páginas que faltavam
      if (editFinishing && editLogRest && editRemaining > 0) {
        await saveSession(selectedBookId, editRemaining, editFinish);
      }
      await updateDoc(doc(db, 'users', user.uid, 'books', selectedBookId), updates);
      setBooks(prev => prev.map(b =>
        b.id === selectedBookId
          ? {
              ...b,
              name: editName,
              author: editAuthor,
              genres: editGenres,
              coverUrl: editCover || undefined,
              totalPages: Number(editPages),
              startDate: editStart,
              status: editStatus,
              finishDate: editStatus === 'finished' ? editFinish : undefined,
              rating: editStatus === 'finished' && editRating ? Number(editRating) : undefined,
            }
          : b
      ));
      setModal(null);
    } finally { setEditSaving(false); }
  }

  // grava a sessão no Firestore, soma no log diário e atualiza o estado local
  async function saveSession(bookId: string, pages: number, date: string) {
    if (!user) return;
    const ref = await addDoc(collection(db, 'users', user.uid, 'reading_sessions'), {
      bookId, pagesRead: pages, date, createdAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'users', user.uid, 'daily_logs', date), {
      reading_pages: increment(pages), updatedAt: new Date(),
    }, { merge: true });
    setSessions(prev => [...prev, { id: ref.id, bookId, pagesRead: pages, date }]);
  }

  async function handleAddSession() {
    if (!user || !ssBook || !ssValid || ssComputedPages == null) return;
    setSsSaving(true);
    try {
      await saveSession(ssBook, ssComputedPages, ssDate);
      setModal(null);
      setSsBook(''); setSsPages(''); setSsCurrent(''); setSsMode('pages'); setSsDate(todayStr());
    } finally { setSsSaving(false); }
  }

  async function handleDeleteSession(session: ReadingSession) {
    if (!user) return;
    setSsDeleting(session.id);
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'reading_sessions', session.id));

      // devolve as páginas ao log diário sem deixar o total negativo
      const logRef  = doc(db, 'users', user.uid, 'daily_logs', session.date);
      const logSnap = await getDoc(logRef);
      const current = Number(logSnap.data()?.reading_pages ?? 0);
      await setDoc(logRef, {
        reading_pages: Math.max(0, current - session.pagesRead), updatedAt: new Date(),
      }, { merge: true });

      setSessions(prev => prev.filter(s => s.id !== session.id));
    } catch (e) { console.error(e); }
    finally { setSsDeleting(null); setSsConfirmDel(null); }
  }

  async function handleFinishBook() {
    if (!user || !selectedBookId) return;
    setFnSaving(true);
    try {
      // registra as páginas que faltavam como uma última sessão de leitura
      const rest = Number(fnPages);
      if (fnLogRest && Number.isFinite(rest) && rest > 0) {
        await saveSession(selectedBookId, rest, fnDate);
      }
      await updateDoc(doc(db, 'users', user.uid, 'books', selectedBookId), {
        status: 'finished', finishDate: fnDate,
        rating: fnRating ? Number(fnRating) : null,
      });
      setBooks(prev => prev.map(b =>
        b.id === selectedBookId
          ? { ...b, status: 'finished', finishDate: fnDate, rating: fnRating ? Number(fnRating) : undefined }
          : b
      ));
      setModal(null);
      setFnRating(''); setFnDate(todayStr()); setFnPages(''); setFnLogRest(true);
    } finally { setFnSaving(false); }
  }

  async function handleDeleteBook(bookId: string) {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'books', bookId));
    setBooks(prev => prev.filter(b => b.id !== bookId));
    setModal(null);
  }

  function openEdit(book: Book) {
    setSelectedBookId(book.id);
    setEditName(book.name);
    setEditAuthor(book.author);
    setEditGenres(book.genres ?? []);
    setEditCover(book.coverUrl ?? '');
    setEditPages(String(book.totalPages));
    setEditStart(book.startDate);
    setEditStatus(book.status);
    setEditFinish(book.finishDate ?? todayStr());
    setEditRating(book.rating != null ? String(book.rating) : '');
    setEditLogRest(true);
    setModal('editBook');
  }

  function openSession(bookId: string) {
    setSsBook(bookId);
    setSsPages(''); setSsCurrent(''); setSsMode('pages'); setSsDate(todayStr());
    setModal('addSession');
  }

  function openFinish(bookId: string) {
    const book = books.find(b => b.id === bookId);
    const rest = book ? Math.max(0, book.totalPages - (pagesByBook[bookId] ?? 0)) : 0;
    setSelectedBookId(bookId);
    setFnDate(todayStr());
    setFnPages(String(rest));
    setFnLogRest(rest > 0);
    setModal('finishBook');
  }

  // ── loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return <div className="flex h-48 items-center justify-center text-slate-500">Carregando...</div>;
  }

  const readingBooks  = books.filter(b => b.status === 'reading');
  // livros finalizados tambem podem receber sessoes, para corrigir paginas esquecidas
  const finishedBooks = books
    .filter(b => b.status === 'finished')
    .sort((a, b) => (b.finishDate ?? '').localeCompare(a.finishDate ?? ''));
  const bookBarH = 40;

  function renderSessionRow(s: ReadingSession, opts: { showBook: boolean }) {
    const book      = bookById[s.bookId];
    const confirming = ssConfirmDel === s.id;
    const busy       = ssDeleting === s.id;
    return (
      <div key={s.id} className="flex items-center gap-2 rounded-xl bg-slate-900/60 px-2.5 py-2 sm:gap-3 sm:px-3">
        <span className="shrink-0 text-xs text-slate-400 tabular-nums">
          <span className="sm:hidden">{new Date(s.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
          <span className="hidden sm:inline">{new Date(s.date + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
        </span>
        {opts.showBook && (
          <span className={`flex-1 min-w-0 truncate text-xs ${book ? 'text-slate-300' : 'italic text-red-400/70'}`}>
            {book ? book.name : 'Livro removido'}
          </span>
        )}
        <span className={`shrink-0 text-xs font-medium text-white ${opts.showBook ? '' : 'ml-auto'}`}>
          {s.pagesRead} pág.
        </span>
        {confirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => handleDeleteSession(s)} disabled={busy}
              className="rounded-lg border border-red-500/30 bg-red-500/15 px-2 py-1 text-[10px] font-medium text-red-300 transition hover:bg-red-500/25 disabled:opacity-50">
              {busy ? '...' : 'Apagar'}
            </button>
            <button onClick={() => setSsConfirmDel(null)} disabled={busy}
              className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-400 transition hover:text-white disabled:opacity-50">
              Cancelar
            </button>
          </div>
        ) : (
          <button onClick={() => setSsConfirmDel(s.id)} title="Apagar sessão"
            className="shrink-0 rounded-lg p-1 text-slate-600 transition hover:bg-red-500/10 hover:text-red-400">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Actions row */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <button onClick={() => setModal('addBook')}
          className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-2xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-[13px] font-medium text-sky-300 transition hover:bg-sky-500/20 sm:flex-none sm:px-4 sm:text-sm">
          <Plus size={15} className="shrink-0" />
          <span className="sm:hidden">Novo livro</span>
          <span className="hidden sm:inline">Adicionar Livro</span>
        </button>
        <button onClick={() => openSession(readingBooks[0]?.id ?? '')}
          disabled={books.length === 0}
          className="flex flex-1 min-w-0 items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[13px] font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:pointer-events-none disabled:opacity-40 sm:flex-none sm:px-4 sm:text-sm">
          <BookOpen size={15} className="shrink-0" />
          <span className="sm:hidden">Registrar</span>
          <span className="hidden sm:inline">Registrar Leitura</span>
        </button>
        <button onClick={loadData}
          title="Atualizar"
          className="ml-auto flex shrink-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-medium text-slate-400 transition hover:border-emerald-500/30 hover:text-emerald-300 sm:px-4 sm:py-2">
          <RefreshCw size={12} /> <span className="hidden sm:inline">Atualizar</span>
        </button>
      </div>

      {/* Currently reading */}
      {readingBooks.length > 0 && (
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur-xl sm:p-5">
          <p className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-500">Lendo agora</p>
          <div className="space-y-3">
            {readingBooks.map(book => {
              const read = pagesByBook[book.id] ?? 0;
              const pct  = Math.min(read / book.totalPages * 100, 100);
              return (
                <div key={book.id} className="flex items-center gap-3 sm:gap-4">
                  {book.coverUrl
                    ? <img src={book.coverUrl} alt="" className="h-12 w-9 rounded-md object-cover shrink-0" />
                    : <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded-md bg-sky-500/20 text-base font-bold text-sky-300">{book.name[0]}</div>
                  }
                  <div className="flex-1 min-w-0">
                    <button onClick={() => openEdit(book)}
                      className="block w-full truncate text-left text-sm font-medium text-white transition hover:text-sky-300">
                      {book.name}
                    </button>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs text-slate-500 truncate">{book.author}</p>
                      {(book.genres ?? []).slice(0, 2).map(g => (
                        <span key={g} className="rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-400">{g}</span>
                      ))}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                        <div className="h-full bg-sky-500 transition-all duration-700" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0">{read}/{book.totalPages} pág.</span>
                    </div>
                  </div>
                  <button onClick={() => openFinish(book.id)}
                    className="shrink-0 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-medium text-emerald-300 transition hover:bg-emerald-500/20 sm:px-3">
                    Finalizar
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reading sessions */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur-xl sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2">
            <History size={14} className="text-slate-500" />
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">Sessões de leitura</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{sessions.length} registro{sessions.length === 1 ? '' : 's'}</span>
            {sessions.length > 0 && (
              <button onClick={() => { setShowSessions(v => !v); setSsConfirmDel(null); }}
                className="text-[11px] text-sky-400 transition hover:text-sky-300">
                {showSessions ? 'Ocultar' : 'Ver e apagar'}
              </button>
            )}
          </div>
        </div>

        {sessions.length === 0 && (
          <p className="py-2 pt-4 text-center text-sm text-slate-600">Nenhuma sessão registrada ainda.</p>
        )}

        {showSessions && sessions.length > 0 && (
          <div className="mt-4 border-t border-white/5 pt-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <select className={`${inputCls} w-full sm:max-w-[240px]`} value={ssFilter}
                onChange={e => { setSsFilter(e.target.value); setSsLimit(20); setSsConfirmDel(null); }}>
                <option value="all">Todos os livros</option>
                {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <span className="text-xs text-slate-500">
                {filteredSessions.length} sessõe{filteredSessions.length === 1 ? '' : 's'} · {filteredSessionPages.toLocaleString('pt-BR')} pág.
              </span>
            </div>

            {filteredSessions.length === 0 ? (
              <p className="py-4 text-center text-sm text-slate-600">Nenhuma sessão para este livro.</p>
            ) : (
              <>
                <div className="space-y-1.5">
                  {filteredSessions.slice(0, ssLimit).map(s => renderSessionRow(s, { showBook: true }))}
                </div>
                {filteredSessions.length > ssLimit && (
                  <button onClick={() => setSsLimit(n => n + 20)}
                    className="mt-3 w-full rounded-xl border border-white/10 py-2 text-[11px] text-slate-400 transition hover:border-sky-500/30 hover:text-sky-300">
                    Mostrar mais ({filteredSessions.length - ssLimit} restantes)
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur-xl sm:p-6">
        {/* Scale tabs + navigation */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-2xl border border-white/5 bg-slate-900/40 p-1">
            {(['month','quarter','year','all'] as TlScale[]).map(s => (
              <button key={s} onClick={() => setTlScale(s)}
                className={`rounded-xl px-2.5 py-1.5 text-xs font-medium transition sm:px-3 ${
                  tlScale === s ? 'bg-sky-500/20 text-sky-300' : 'text-slate-500 hover:text-slate-300'
                }`}>
                {s === 'month' ? 'Mês' : s === 'quarter' ? 'Trimestre' : s === 'year' ? 'Ano' : 'Tudo'}
              </button>
            ))}
          </div>

          {tlScale !== 'all' && (
            <div className="ml-auto flex items-center gap-2">
              <button onClick={tlPrev}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-sky-500/30 hover:text-white">
                <ChevronLeft size={15} />
              </button>
              <span className="min-w-[92px] text-center text-sm font-medium text-slate-200 sm:min-w-[120px]">{tlLabel}</span>
              <button onClick={tlNext} disabled={tlAtPresent}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-sky-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-30">
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          {tlScale === 'all' && (
            <span className="ml-auto text-sm font-medium text-slate-400">{tlLabel}</span>
          )}
        </div>

        {books.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-600">Nenhum livro cadastrado ainda.</p>
        ) : booksInTimeline.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-600">Nenhum livro neste período.</p>
        ) : (
          <div>
            {/* X-axis ticks */}
            <div className="relative mb-2 ml-20 h-5 border-b border-white/5 sm:ml-28">
              {tlTicks.map((tick, i) => (
                <span key={i}
                  className="absolute -translate-x-1/2 text-[9px] text-slate-600"
                  style={{ left: `${tick.pct}%`, bottom: 4 }}>
                  {tick.label}
                </span>
              ))}
            </div>

            {/* Book rows */}
            <div className="space-y-1.5">
              {booksInTimeline.map(({ book, leftPct, widthPct }) => {
                const color = book.status === 'finished'
                  ? 'bg-emerald-500/40 border-emerald-500/50 text-emerald-200'
                  : 'bg-sky-500/30 border-sky-500/40 text-sky-200';
                return (
                  <div key={book.id} className="flex items-center gap-2" style={{ height: bookBarH }}>
                    <button onClick={() => openEdit(book)}
                      className="w-20 shrink-0 truncate pr-2 text-right text-[11px] text-slate-400 transition hover:text-sky-300 sm:w-28">
                      {book.name}
                    </button>
                    <div className="relative flex-1 h-7">
                      <div
                        className={`absolute top-0 h-full rounded-full border cursor-pointer transition hover:brightness-125 ${color}`}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: 6 }}
                        onClick={() => openEdit(book)}
                        title={`${book.name}${book.finishDate ? ` · Finalizado ${book.finishDate}` : ' · Lendo'}`}
                      >
                        {widthPct > 8 && (
                          <span className="absolute inset-0 flex items-center justify-center px-2">
                            <span className="truncate text-[10px] font-medium">{book.name}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="mt-4 flex gap-4 border-t border-white/5 pt-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-sky-500/40 border border-sky-500/50" /> Lendo</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500/40 border border-emerald-500/50" /> Finalizado</span>
            </div>
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur-xl sm:p-6">
        <p className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-500">Estatísticas</p>

        <div className="mb-5 flex gap-1 rounded-2xl border border-white/5 bg-slate-900/40 p-1">
          {(['week','month','year'] as StatView[]).map(v => (
            <button key={v} onClick={() => setStatView(v)}
              className={`flex-1 rounded-xl py-1.5 text-xs font-medium transition ${
                statView === v ? 'bg-sky-500/20 text-sky-300' : 'text-slate-500 hover:text-slate-300'
              }`}>
              {v === 'week' ? 'Semana' : v === 'month' ? 'Mês' : 'Ano'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total de páginas', value: statPages.total.toLocaleString('pt-BR') },
            { label: 'Média/dia',        value: `${statPages.avg}` },
            { label: 'Melhor dia',       value: `${statPages.best}`, sub: statPages.bestDate ? new Date(statPages.bestDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }) : '' },
            { label: 'Dias com leitura', value: `${statPages.days}` },
          ].map(({ label, value, sub }) => (
            <div key={label} className="rounded-2xl border border-white/5 bg-slate-900/40 p-4">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-slate-600">{label}</p>
              <p className="text-xl font-bold text-white">{value}</p>
              {sub && <p className="mt-0.5 text-[10px] text-slate-500">{sub}</p>}
            </div>
          ))}
        </div>

        <div className="mt-5 border-t border-white/5 pt-5">
          <p className="mb-3 text-xs text-slate-500">Páginas por mês ({new Date().getFullYear()})</p>
          <div className="flex items-end gap-px" style={{ height: 80 }}>
            {monthlyPages.map(({ month, total }) => {
              const h = monthlyMax > 0 ? Math.max(total / monthlyMax * 80, total > 0 ? 2 : 0) : 0;
              const isCur = month === new Date().getMonth();
              return (
                <div key={month} style={{ flex: 1, height: 80, display: 'flex', alignItems: 'flex-end', position: 'relative' }}
                  className="group/mb">
                  {total > 0 && (
                    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 opacity-0 transition-opacity group-hover/mb:opacity-100">
                      <div className="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-[9px] text-white whitespace-nowrap shadow-xl">
                        {total} pág.
                      </div>
                    </div>
                  )}
                  <div style={{ width: '100%', height: Math.max(h, 2) }}
                    className={`rounded-t-sm transition-all duration-500 ${
                      total > 0 ? (isCur ? 'bg-sky-400' : 'bg-sky-600/60') : 'bg-slate-800/30'
                    }`} />
                </div>
              );
            })}
          </div>
          <div className="flex gap-px mt-1">
            {monthlyPages.map(({ month }) => (
              <div key={month} style={{ flex: 1 }}
                className={`text-center text-[9px] ${month === new Date().getMonth() ? 'font-bold text-sky-400' : 'text-slate-600'}`}>
                {MONTHS_SHORT[month]}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Finished books per year */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-4 shadow-glow backdrop-blur-xl sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setShowFinishedYear(y => y - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white transition">
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-medium text-slate-200">{showFinishedYear}</span>
            <button onClick={() => setShowFinishedYear(y => y + 1)}
              disabled={showFinishedYear >= new Date().getFullYear()}
              className="flex h-7 w-7 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white transition disabled:opacity-30 disabled:pointer-events-none">
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-white">{finishedThisYear.length}</span>
            <span className="text-xs text-slate-500">livros lidos</span>
            {finishedThisYear.length > 0 && (
              <button onClick={() => setShowBookList(v => !v)}
                className="text-[11px] text-sky-400 hover:text-sky-300 transition">
                {showBookList ? 'Ocultar' : 'Ver lista'}
              </button>
            )}
          </div>
        </div>

        {showBookList && finishedThisYear.length > 0 && (
          <div className="space-y-2 border-t border-white/5 pt-4">
            {finishedThisYear.map(book => (
              <button key={book.id} onClick={() => openEdit(book)}
                className="flex w-full items-center gap-3 rounded-2xl p-1.5 transition hover:bg-white/5 text-left">
                {book.coverUrl
                  ? <img src={book.coverUrl} alt="" className="h-10 w-7 rounded object-cover shrink-0" />
                  : <div className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-sky-500/20 text-sm font-bold text-sky-300">{book.name[0]}</div>
                }
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{book.name}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs text-slate-500 truncate">{book.author}</p>
                    {(book.genres ?? []).slice(0, 2).map(g => (
                      <span key={g} className="rounded-full border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-400">{g}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {book.rating != null && (
                    <div className="flex items-center gap-1">
                      <Star size={11} className="text-yellow-400 fill-yellow-400" />
                      <span className="text-xs font-medium text-yellow-300">{book.rating}/10</span>
                    </div>
                  )}
                  {book.finishDate && (
                    <span className="text-[10px] text-slate-600">
                      {new Date(book.finishDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {finishedThisYear.length === 0 && (
          <p className="text-center text-sm text-slate-600 py-2">Nenhum livro finalizado em {showFinishedYear}.</p>
        )}
      </div>

      {/* ── Modals ── */}

      {modal === 'addBook' && (
        <Modal title="Adicionar Livro" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nome do livro *">
              <input className={inputCls} value={bkName} onChange={e => setBkName(e.target.value)} placeholder="Ex: O Hobbit" />
            </Field>
            <Field label="Autor">
              <AuthorSelect value={bkAuthor} onChange={setBkAuthor} authors={authorList} />
            </Field>
            <Field label="Gêneros">
              <BookGenreMultiSelect selected={bkGenres} onChange={setBkGenres} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Número de páginas *">
                <input className={inputCls} type="number" min={1} value={bkPages} onChange={e => setBkPages(e.target.value)} placeholder="320" />
              </Field>
              <Field label="Data de início">
                <input className={inputCls} type="date" value={bkStart} onChange={e => setBkStart(e.target.value)} />
              </Field>
            </div>
            <Field label="URL da capa (opcional)">
              <input className={inputCls} value={bkCover} onChange={e => setBkCover(e.target.value)} placeholder="https://..." />
            </Field>
            <button onClick={handleAddBook} disabled={!bkName || !bkPages || bkSaving}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl border border-sky-500/30 bg-sky-500/15 py-2.5 text-sm font-medium text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-50">
              {bkSaving ? 'Salvando...' : <><Check size={14} /> Salvar livro</>}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'addSession' && (
        <Modal title="Registrar Leitura" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Livro *">
              <select className={inputCls} value={ssBook} onChange={e => setSsBook(e.target.value)}>
                <option value="">Selecione...</option>
                {readingBooks.length > 0 && (
                  <optgroup label="Lendo">
                    {readingBooks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </optgroup>
                )}
                {finishedBooks.length > 0 && (
                  <optgroup label="Finalizados">
                    {finishedBooks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </optgroup>
                )}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-white/5 p-1">
              {([['pages', 'Páginas lidas'], ['current', 'Página atual']] as [SessionInput, string][]).map(([mode, label]) => (
                <button key={mode} type="button" onClick={() => setSsMode(mode)}
                  className={`rounded-xl py-1.5 text-xs font-medium transition ${
                    ssMode === mode ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {ssMode === 'pages' ? (
                <Field label="Páginas lidas *">
                  <input className={inputCls} type="number" min={1} value={ssPages}
                    onChange={e => setSsPages(e.target.value)} placeholder="30" />
                </Field>
              ) : (
                <Field label="Estou na página *">
                  <input className={inputCls} type="number" min={1} max={ssBookTotal || undefined} value={ssCurrent}
                    onChange={e => setSsCurrent(e.target.value)} placeholder={String(ssBookRead + 30)} />
                </Field>
              )}
              <Field label="Data">
                <input className={inputCls} type="date" value={ssDate} onChange={e => setSsDate(e.target.value)} />
              </Field>
            </div>
            {ssBook && ssMode === 'current' && (
              <p className={`text-xs ${ssComputedPages != null && !ssValid ? 'text-rose-400' : 'text-slate-400'}`}>
                {ssComputedPages == null
                  ? `Você já registrou até a página ${ssBookRead}${ssBookTotal ? ` de ${ssBookTotal}` : ''}.`
                  : ssValid
                    ? `${ssComputedPages} página${ssComputedPages === 1 ? '' : 's'} lida${ssComputedPages === 1 ? '' : 's'} (da ${ssBookRead + 1} até a ${ssBookRead + ssComputedPages}).`
                    : `Você já registrou até a página ${ssBookRead}. Informe uma página maior que ${ssBookRead}.`}
              </p>
            )}
            <button onClick={handleAddSession} disabled={!ssBook || !ssValid || ssSaving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50">
              {ssSaving ? 'Salvando...' : <><Check size={14} /> Registrar</>}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'finishBook' && selectedBook && (
        <Modal title={`Finalizar: ${selectedBook.name}`} onClose={() => setModal(null)}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nota (0–10)">
                <input className={inputCls} type="number" min={0} max={10} step={0.5}
                  value={fnRating} onChange={e => setFnRating(e.target.value)} placeholder="8.5" />
              </Field>
              <Field label="Data de finalização">
                <input className={inputCls} type="date" value={fnDate} onChange={e => setFnDate(e.target.value)} />
              </Field>
            </div>

            {fnRemaining > 0 ? (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                <label className="flex items-start gap-2.5 text-xs text-slate-300">
                  <input type="checkbox" className="mt-0.5 accent-emerald-500"
                    checked={fnLogRest} onChange={e => setFnLogRest(e.target.checked)} />
                  <span>
                    Registrar as páginas que faltavam como uma sessão de leitura
                    <span className="mt-0.5 block text-slate-500">
                      Faltam {fnRemaining} de {selectedBook.totalPages} páginas.
                    </span>
                  </span>
                </label>
                {fnLogRest && (
                  <Field label="Páginas a registrar">
                    <input className={inputCls} type="number" min={1} value={fnPages}
                      onChange={e => setFnPages(e.target.value)} />
                  </Field>
                )}
              </div>
            ) : (
              <p className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
                Todas as {selectedBook.totalPages} páginas já estão registradas.
              </p>
            )}

            <button onClick={handleFinishBook} disabled={fnSaving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 py-2.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50">
              {fnSaving ? 'Salvando...' : <><Check size={14} /> Marcar como lido</>}
            </button>
          </div>
        </Modal>
      )}

      {modal === 'editBook' && selectedBook && (
        <Modal title="Editar Livro" onClose={() => setModal(null)}>
          <div className="space-y-4">
            <Field label="Nome do livro *">
              <input className={inputCls} value={editName} onChange={e => setEditName(e.target.value)} placeholder="Ex: O Hobbit" />
            </Field>
            <Field label="Autor">
              <AuthorSelect value={editAuthor} onChange={setEditAuthor} authors={authorList} />
            </Field>
            <Field label="Gêneros">
              <BookGenreMultiSelect selected={editGenres} onChange={setEditGenres} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Número de páginas *">
                <input className={inputCls} type="number" min={1} value={editPages} onChange={e => setEditPages(e.target.value)} placeholder="320" />
              </Field>
              <Field label="Data de início">
                <input className={inputCls} type="date" value={editStart} onChange={e => setEditStart(e.target.value)} />
              </Field>
            </div>
            <Field label="Status">
              <select className={inputCls} value={editStatus} onChange={e => setEditStatus(e.target.value as 'reading' | 'finished')}>
                <option value="reading">Lendo</option>
                <option value="finished">Finalizado</option>
              </select>
            </Field>
            {editStatus === 'finished' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Data de finalização">
                  <input className={inputCls} type="date" value={editFinish} onChange={e => setEditFinish(e.target.value)} />
                </Field>
                <Field label="Nota (0–10)">
                  <input className={inputCls} type="number" min={0} max={10} step={0.5}
                    value={editRating} onChange={e => setEditRating(e.target.value)} placeholder="8.5" />
                </Field>
              </div>
            )}
            {editFinishing && editRemaining > 0 && (
              <label className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
                <input type="checkbox" className="mt-0.5 accent-emerald-500"
                  checked={editLogRest} onChange={e => setEditLogRest(e.target.checked)} />
                <span>
                  Registrar as {editRemaining} páginas que faltavam como uma sessão de leitura
                  <span className="mt-0.5 block text-slate-500">Na data de finalização.</span>
                </span>
              </label>
            )}
            <Field label="URL da capa (opcional)">
              <input className={inputCls} value={editCover} onChange={e => setEditCover(e.target.value)} placeholder="https://..." />
            </Field>

            {/* Sessions list */}
            {sessions.filter(s => s.bookId === selectedBook.id).length > 0 && (
              <div className="border-t border-white/5 pt-4">
                <p className="mb-2 text-xs font-medium text-slate-500">Sessões de leitura</p>
                <div className="max-h-40 overflow-y-auto space-y-1.5">
                  {sessions.filter(s => s.bookId === selectedBook.id)
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map(s => renderSessionRow(s, { showBook: false }))}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              {editStatus === 'reading' && (
                <button onClick={() => openSession(selectedBook.id)}
                  className="rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-300 hover:bg-sky-500/20 transition">
                  + Sessão
                </button>
              )}
              <button onClick={handleEditBook} disabled={!editName || !editPages || editSaving}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-sky-500/30 bg-sky-500/15 py-2.5 text-sm font-medium text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-50">
                {editSaving ? 'Salvando...' : <><Check size={14} /> Salvar alterações</>}
              </button>
              <button onClick={() => handleDeleteBook(selectedBook.id)}
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
