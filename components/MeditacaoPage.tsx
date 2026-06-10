'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  collection, doc, getDocs, addDoc, deleteDoc, setDoc, increment, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { Wind, Play, Pause, RotateCcw, Plus, Minus, Check, Trash2 } from 'lucide-react';

interface MeditationSession {
  id: string;
  date: string;
  durationMinutes: number;
  notes?: string;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtMin(min: number) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export default function MeditacaoPage() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<MeditationSession[]>([]);
  const [loading, setLoading] = useState(true);

  // Timer
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Input mode
  const [useTimer, setUseTimer] = useState(true);
  const [manualMinutes, setManualMinutes] = useState(10);

  // Session save form
  const [ssDate, setSsDate] = useState(todayStr());
  const [ssNotes, setSsNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Timer effect
  useEffect(() => {
    if (timerRunning) {
      intervalRef.current = setInterval(() => setTimerSeconds(s => s + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timerRunning]);

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users', user.uid, 'meditation_sessions'));
      setSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as MeditationSession)));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const durationMinutes = useTimer
    ? Math.max(1, Math.round(timerSeconds / 60))
    : manualMinutes;

  const timerMM = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
  const timerSS = String(timerSeconds % 60).padStart(2, '0');

  async function handleSave() {
    if (!user || (useTimer && timerSeconds < 30)) return;
    setSaving(true);
    try {
      const ref = await addDoc(collection(db, 'users', user.uid, 'meditation_sessions'), {
        date: ssDate,
        durationMinutes,
        notes: ssNotes || null,
        createdAt: Timestamp.now(),
      });
      await setDoc(doc(db, 'users', user.uid, 'daily_logs', ssDate), {
        meditation_minutes: increment(durationMinutes),
        updatedAt: new Date(),
      }, { merge: true });
      setSessions(prev => [...prev, {
        id: ref.id, date: ssDate, durationMinutes, notes: ssNotes || undefined,
      }]);
      setTimerSeconds(0);
      setTimerRunning(false);
      setManualMinutes(10);
      setSsNotes('');
      setSsDate(todayStr());
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!user) return;
    await deleteDoc(doc(db, 'users', user.uid, 'meditation_sessions', id));
    setSessions(prev => prev.filter(s => s.id !== id));
  }

  const totalThisMonth = sessions
    .filter(s => s.date.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((a, s) => a + s.durationMinutes, 0);

  const canSave = useTimer ? timerSeconds >= 30 && !timerRunning : manualMinutes >= 1;

  return (
    <div className="space-y-5">

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: 'Sessões este mês', value: String(sessions.filter(s => s.date.startsWith(new Date().toISOString().slice(0, 7))).length) },
          { label: 'Minutos este mês', value: fmtMin(totalThisMonth) },
          { label: 'Total de sessões', value: String(sessions.length) },
        ].map(item => (
          <div key={item.label} className="rounded-2xl border border-white/5 bg-slate-900/40 p-4">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-slate-600">{item.label}</p>
            <p className="text-xl font-bold text-white">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Timer / Entry card */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
        {/* Mode toggle */}
        <div className="mb-6 flex gap-1 rounded-2xl border border-white/5 bg-slate-900/40 p-1">
          <button
            onClick={() => setUseTimer(true)}
            className={`flex-1 rounded-xl py-2 text-xs font-medium transition ${
              useTimer ? 'bg-teal-500/20 text-teal-300' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Timer
          </button>
          <button
            onClick={() => setUseTimer(false)}
            className={`flex-1 rounded-xl py-2 text-xs font-medium transition ${
              !useTimer ? 'bg-teal-500/20 text-teal-300' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Manual
          </button>
        </div>

        {useTimer ? (
          <div className="flex flex-col items-center gap-6">
            <div className={`text-6xl font-mono font-bold tabular-nums transition-colors ${
              timerRunning ? 'text-teal-300' : timerSeconds > 0 ? 'text-white' : 'text-slate-600'
            }`}>
              {timerMM}:{timerSS}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setTimerRunning(r => !r)}
                className={`flex items-center gap-2 rounded-2xl border px-6 py-3 text-sm font-semibold transition ${
                  timerRunning
                    ? 'border-amber-500/30 bg-amber-500/20 text-amber-300 hover:bg-amber-500/30'
                    : 'border-teal-500/30 bg-teal-500/20 text-teal-300 hover:bg-teal-500/30'
                }`}
              >
                {timerRunning
                  ? <><Pause size={16} /> Pausar</>
                  : <><Play size={16} /> {timerSeconds > 0 ? 'Retomar' : 'Iniciar'}</>
                }
              </button>
              <button
                onClick={() => { setTimerRunning(false); setTimerSeconds(0); }}
                className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-400 transition hover:border-white/20 hover:text-white"
              >
                <RotateCcw size={14} />
              </button>
            </div>
            {timerSeconds > 0 && !timerRunning && (
              <p className="text-sm text-teal-300/70">{durationMinutes} min registrados</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-5">
              <button
                onClick={() => setManualMinutes(m => Math.max(1, m - 1))}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/60 text-slate-400 transition hover:border-teal-500/30 hover:text-teal-300"
              >
                <Minus size={16} />
              </button>
              <span className="min-w-[80px] text-center text-5xl font-bold text-white tabular-nums">{manualMinutes}</span>
              <button
                onClick={() => setManualMinutes(m => m + 1)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/60 text-slate-400 transition hover:border-teal-500/30 hover:text-teal-300"
              >
                <Plus size={16} />
              </button>
            </div>
            <p className="text-sm text-slate-500">minutos</p>
            <div className="flex flex-wrap justify-center gap-2">
              {[5, 10, 15, 20, 30].map(m => (
                <button
                  key={m}
                  onClick={() => setManualMinutes(m)}
                  className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                    manualMinutes === m
                      ? 'border-teal-500/40 bg-teal-500/20 text-teal-300'
                      : 'border-white/10 bg-slate-900/40 text-slate-400 hover:border-teal-500/30 hover:text-teal-300'
                  }`}
                >
                  {m}min
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Save section */}
        <div className="mt-6 space-y-4 border-t border-white/10 pt-6">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Data</label>
              <input
                type="date"
                value={ssDate}
                onChange={e => setSsDate(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 outline-none transition focus:border-teal-500/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">Duração</label>
              <div className="flex h-[42px] items-center rounded-xl border border-white/10 bg-white/5 px-3">
                <span className="text-sm font-semibold text-teal-300">{durationMinutes} min</span>
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Observações (opcional)</label>
            <input
              value={ssNotes}
              onChange={e => setSsNotes(e.target.value)}
              placeholder="Como foi a sessão?"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition focus:border-teal-500/50"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !canSave}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-teal-500/30 bg-teal-500/15 py-3 text-sm font-semibold text-teal-300 transition hover:bg-teal-500/25 disabled:opacity-40"
          >
            {saving ? 'Salvando...' : <><Check size={16} /> Salvar sessão</>}
          </button>
          {useTimer && timerSeconds < 30 && timerSeconds > 0 && (
            <p className="text-center text-xs text-slate-600">Mínimo de 30 segundos para salvar</p>
          )}
        </div>
      </div>

      {/* History */}
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
        <p className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-500">Histórico</p>
        {loading ? (
          <p className="text-center text-sm text-slate-600">Carregando...</p>
        ) : sessions.length === 0 ? (
          <div className="py-8 text-center">
            <Wind size={32} className="mx-auto mb-3 text-slate-700" />
            <p className="text-sm text-slate-600">Nenhuma sessão registrada ainda.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {[...sessions]
              .sort((a, b) => b.date.localeCompare(a.date))
              .map(s => (
                <div key={s.id} className="flex items-center gap-3 rounded-2xl border border-white/5 bg-slate-900/30 px-4 py-3">
                  <Wind size={14} className="shrink-0 text-teal-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{fmtMin(s.durationMinutes)}</p>
                    {s.notes && <p className="truncate text-xs text-slate-500">{s.notes}</p>}
                  </div>
                  <p className="shrink-0 text-xs text-slate-400">
                    {new Date(s.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}
                  </p>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="shrink-0 text-slate-700 transition hover:text-red-400"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

    </div>
  );
}
