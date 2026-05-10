'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { collection, doc, setDoc, onSnapshot, query, where, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { ChevronLeft, ChevronRight, Copy, Check, Pill, Flame, Wifi } from 'lucide-react';

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getFirstDayOffset(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday = 0
}

function calcStreak(allTaken: Set<string>, todayStr: string): number {
  let count = 0;
  const d = new Date(todayStr);
  while (true) {
    const str = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
    if (!allTaken.has(str)) break;
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}

export default function CreatinaCalendar() {
  const { user } = useAuth();
  const today = new Date();
  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [allTakenDays, setAllTakenDays] = useState<Set<string>>(new Set());
  const [loadingDay, setLoadingDay] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [nfcToken, setNfcToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const loadToken = useCallback(async () => {
    if (!user) return;
    try {
      const ref = doc(db, 'nfc_tokens', user.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setNfcToken(snap.data().token);
      } else {
        const token = crypto.randomUUID();
        await setDoc(ref, { token, userId: user.uid });
        setNfcToken(token);
      }
    } catch (e) {
      console.error('Erro ao carregar token NFC:', e);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setLoadingData(true);
    const q = query(
      collection(db, 'users', user.uid, 'daily_logs'),
      where('creatine_done', '==', true)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setAllTakenDays(new Set(snapshot.docs.map(d => d.id)));
      setLoadingData(false);
    }, (e) => {
      console.error('Erro ao carregar creatina:', e);
      setLoadingData(false);
    });
    loadToken();
    return () => unsub();
  }, [user, loadToken]);

  // Days visible in current month view
  const takenInView = useMemo(() => {
    const prefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-`;
    return new Set([...allTakenDays].filter(d => d.startsWith(prefix)));
  }, [allTakenDays, currentYear, currentMonth]);

  const streak = useMemo(() => calcStreak(allTakenDays, todayStr), [allTakenDays, todayStr]);

  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const firstDayOffset = getFirstDayOffset(currentYear, currentMonth);
  const totalCells = Math.ceil((firstDayOffset + daysInMonth) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const day = i - firstDayOffset + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });

  const toggleDay = async (dateStr: string) => {
    if (!user || loadingDay || dateStr > todayStr) return;
    setLoadingDay(dateStr);
    try {
      const docRef = doc(db, 'users', user.uid, 'daily_logs', dateStr);
      await setDoc(docRef, { creatine_done: !allTakenDays.has(dateStr) }, { merge: true });
    } catch (e) {
      console.error('Erro ao salvar creatina:', e);
    } finally {
      setLoadingDay(null);
    }
  };

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  const copyUrl = () => {
    if (!nfcToken || !origin) return;
    navigator.clipboard.writeText(`${origin}/api/creatina/toggle?token=${nfcToken}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isTodayTaken = allTakenDays.has(todayStr);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">

      {/* Calendar */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
        {/* Month nav */}
        <div className="mb-5 flex items-center justify-between">
          <button onClick={prevMonth} className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-cyan-500/30 hover:text-white">
            <ChevronLeft size={16} />
          </button>
          <h2 className="text-base font-semibold text-white">{MONTHS_PT[currentMonth]} {currentYear}</h2>
          <button
            onClick={nextMonth}
            disabled={currentYear === today.getFullYear() && currentMonth === today.getMonth()}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 text-slate-400 transition hover:border-cyan-500/30 hover:text-white disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Weekday headers */}
        <div className="mb-2 grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-[10px] font-medium uppercase tracking-widest text-slate-600">{d}</div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((day, i) => {
            if (!day) return <div key={i} className="h-10" />;
            const dateStr = toDateStr(currentYear, currentMonth, day);
            const isTaken = takenInView.has(dateStr);
            const isToday = dateStr === todayStr;
            const isFuture = dateStr > todayStr;
            const isLoading = loadingDay === dateStr || (loadingData && !allTakenDays.size);

            return (
              <button
                key={dateStr}
                onClick={() => toggleDay(dateStr)}
                disabled={isFuture || !!loadingDay}
                className={[
                  'relative flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium transition',
                  isFuture
                    ? 'cursor-default border border-white/5 text-slate-700'
                    : isTaken
                    ? 'border border-cyan-500/40 bg-cyan-500/20 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.18)] hover:bg-cyan-500/30'
                    : 'border border-white/5 bg-slate-900/40 text-slate-400 hover:border-white/15 hover:bg-white/5 hover:text-white',
                  isToday ? 'ring-2 ring-cyan-400/60 ring-offset-1 ring-offset-[#08101a]' : '',
                ].join(' ')}
              >
                {isLoading && loadingDay === dateStr ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                ) : (
                  <>
                    <span className="leading-none">{day}</span>
                    {isTaken && (
                      <span className="absolute bottom-1 h-1 w-1 rounded-full bg-cyan-400" />
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-5 flex items-center gap-5 border-t border-white/5 pt-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-md border border-cyan-500/40 bg-cyan-500/20" /> Tomada</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-md border border-white/5 bg-slate-900/40" /> Não tomada</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-md border border-white/5 ring-2 ring-cyan-400/60" /> Hoje</span>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-col gap-4">

        {/* Streak */}
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2">
            <Flame size={15} className="text-orange-400" />
            <span className="text-sm font-medium text-slate-200">Sequência</span>
          </div>
          <p className="text-4xl font-bold text-white">
            {streak} <span className="text-base font-normal text-slate-400">dias</span>
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            {streak === 0 ? 'Tome hoje para começar.' : streak < 7 ? 'Bom começo! Não pare.' : 'Incrível consistência!'}
          </p>
        </div>

        {/* Today toggle */}
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2">
            <Pill size={15} className="text-cyan-400" />
            <span className="text-sm font-medium text-slate-200">Hoje</span>
          </div>
          <div className={`mb-3 rounded-2xl border px-4 py-2.5 text-sm font-medium ${isTodayTaken ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300' : 'border-white/5 bg-slate-900/50 text-slate-400'}`}>
            {isTodayTaken ? '✓ Creatina tomada' : '○ Não registrado'}
          </div>
          <button
            onClick={() => toggleDay(todayStr)}
            disabled={!!loadingDay}
            className={`w-full rounded-2xl py-2.5 text-sm font-medium transition ${isTodayTaken ? 'border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/15' : 'border border-cyan-500/30 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/20'}`}
          >
            {isTodayTaken ? 'Desmarcar hoje' : 'Marcar como tomada'}
          </button>
        </div>

        {/* NFC shortcut */}
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2">
            <Wifi size={15} className="text-tamagochi-300" />
            <span className="text-sm font-medium text-slate-200">Atalho NFC</span>
          </div>

          <p className="mb-3 text-xs text-slate-500">
            Cole a URL no Shortcuts do iPhone. Ao encostar no adesivo da creatina, o dia é marcado automaticamente.
          </p>

          {nfcToken ? (
            <>
              <div className="rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2.5 font-mono text-[10px] leading-relaxed text-slate-500 break-all">
                {origin}/api/creatina/toggle?token=<span className="text-slate-300">{nfcToken.slice(0, 12)}…</span>
              </div>
              <button
                onClick={copyUrl}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-tamagochi-500/30 bg-tamagochi-500/10 py-2.5 text-sm font-medium text-tamagochi-300 transition hover:bg-tamagochi-500/15"
              >
                {copied ? <><Check size={13} /> Copiado!</> : <><Copy size={13} /> Copiar URL</>}
              </button>
            </>
          ) : (
            <div className="h-10 animate-pulse rounded-xl bg-slate-900/60" />
          )}

          {/* Setup steps */}
          <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-slate-600">Como configurar</p>
            {[
              'Abra o app Atalhos no iPhone',
              'Automação → Nova Automação → NFC',
              'Escaneie o adesivo na creatina',
              'Adicione ação: Obter conteúdo da URL',
              'Cole a URL copiada acima (método GET)',
              'Ative "Executar sem perguntar"',
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-tamagochi-500/15 text-[9px] font-bold text-tamagochi-400">{i + 1}</span>
                <span className="text-[11px] leading-snug text-slate-400">{step}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
