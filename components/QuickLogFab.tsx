'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { doc, getDoc, increment as fsIncrement, onSnapshot, setDoc } from 'firebase/firestore';
import { Check, Droplet, Dumbbell, Pill, X, Zap } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';

interface QuickData {
  water_ml: number;
  gym_done: boolean;
  creatine_done: boolean;
}

const emptyData: QuickData = { water_ml: 0, gym_done: false, creatine_done: false };
const WATER_GOAL_DEFAULT = 4000;

const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const getTodayStr = () => dateStr(new Date());

export default function QuickLogFab() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [data, setData] = useState<QuickData>(emptyData);
  const [waterGoal, setWaterGoal] = useState(WATER_GOAL_DEFAULT);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(doc(db, 'users', user.uid, 'daily_logs', getTodayStr()), (snap) => {
      setData(snap.exists() ? { ...emptyData, ...(snap.data() as Partial<QuickData>) } : emptyData);
    });
    getDoc(doc(db, 'users', user.uid, 'settings', 'goals')).then((snap) => {
      const goal = snap.exists() ? (snap.data().water_ml as number | undefined) : undefined;
      if (goal) setWaterGoal(goal);
    });
    return () => unsub();
  }, [user]);

  // Auto-abre vindo dos atalhos do manifest (?quick=water|gym)
  useEffect(() => {
    const quick = searchParams.get('quick');
    if (quick === 'water' || quick === 'gym' || quick === 'creatine') {
      setOpen(true);
      router.replace('/');
    }
  }, [searchParams, router]);

  const writeLog = useCallback(async (fields: Record<string, unknown>) => {
    if (!user) return;
    setBusy(true);
    try {
      await setDoc(doc(db, 'users', user.uid, 'daily_logs', getTodayStr()), {
        ...fields, updatedAt: new Date(),
      }, { merge: true });
    } finally {
      setBusy(false);
    }
  }, [user]);

  const addWater = (ml: number) => writeLog({ water_ml: fsIncrement(ml) });
  const toggleGym = () => writeLog({ gym_done: !data.gym_done });
  const toggleCreatine = () => writeLog({ creatine_done: !data.creatine_done });

  if (!user) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Registro rápido"
        className="fixed bottom-24 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-tamagochi-500 via-tamagochi-400 to-tamagochi-300 text-slate-950 shadow-glow transition hover:scale-105 md:bottom-6 md:right-6"
      >
        <Zap size={22} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

          <div className="absolute bottom-0 left-0 right-0 rounded-t-[2rem] border-t border-white/10 bg-[#0d1b2a] p-5 shadow-2xl md:bottom-24 md:left-auto md:right-6 md:w-96 md:rounded-[2rem] md:border">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap size={18} className="text-tamagochi-300" />
                <h2 className="text-sm font-semibold uppercase tracking-widest text-tamagochi-300">Registro rápido</h2>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-400 transition hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 pb-4 md:pb-0">
              {/* Água */}
              <div className="rounded-2xl border border-white/5 bg-slate-900/50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Droplet size={16} className="text-blue-400" />
                    <span className="text-sm font-medium text-slate-200">Água</span>
                  </div>
                  <span className="text-xs text-slate-400">
                    <span className="font-bold text-white">{data.water_ml}</span> / {waterGoal} ml
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[{ l: '250ml', v: 250 }, { l: '500ml', v: 500 }, { l: '750ml', v: 750 }, { l: '1L', v: 1000 }].map((opt) => (
                    <button
                      key={opt.v}
                      onClick={() => addWater(opt.v)}
                      disabled={busy}
                      className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-blue-500/40 hover:bg-blue-900/20 disabled:opacity-40"
                    >
                      +{opt.l}
                    </button>
                  ))}
                </div>
              </div>

              {/* Academia */}
              <button
                onClick={toggleGym}
                disabled={busy}
                className={`flex w-full items-center justify-between rounded-2xl border p-4 transition disabled:opacity-50 ${
                  data.gym_done
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                    : 'border-white/5 bg-slate-900/50 text-slate-300 hover:border-rose-500/30'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Dumbbell size={16} className={data.gym_done ? 'text-rose-400' : 'text-slate-400'} />
                  Academia
                </span>
                {data.gym_done ? <Check size={16} /> : <span className="text-xs text-slate-500">Marcar treino</span>}
              </button>

              {/* Creatina */}
              <button
                onClick={toggleCreatine}
                disabled={busy}
                className={`flex w-full items-center justify-between rounded-2xl border p-4 transition disabled:opacity-50 ${
                  data.creatine_done
                    ? 'border-purple-500/30 bg-purple-500/10 text-purple-300'
                    : 'border-white/5 bg-slate-900/50 text-slate-300 hover:border-purple-500/30'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Pill size={16} className={data.creatine_done ? 'text-purple-400' : 'text-slate-400'} />
                  Creatina
                </span>
                {data.creatine_done ? <Check size={16} /> : <span className="text-xs text-slate-500">Marcar creatina</span>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
