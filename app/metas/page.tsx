'use client';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Droplet, Footprints, BookOpen, Dumbbell, Pill, GraduationCap, Save, CheckCircle2, Target } from 'lucide-react';

interface GoalsForm {
  water_ml: number;
  steps: number;
  reading_pages: number;
  gym_days_per_week: number;
  study_minutes: number;
}

const DEFAULTS: GoalsForm = {
  water_ml: 4000,
  steps: 10000,
  reading_pages: 10,
  gym_days_per_week: 5,
  study_minutes: 120,
};

const goalFields = [
  {
    key: 'water_ml' as const,
    label: 'Água',
    description: 'Meta diária de ingestão de água',
    icon: Droplet,
    unit: 'ml/dia',
    min: 500,
    max: 10000,
    step: 100,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/20',
  },
  {
    key: 'steps' as const,
    label: 'Passos',
    description: 'Meta diária de passos',
    icon: Footprints,
    unit: 'passos/dia',
    min: 1000,
    max: 50000,
    step: 500,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/20',
  },
  {
    key: 'reading_pages' as const,
    label: 'Leitura',
    description: 'Meta diária de páginas lidas',
    icon: BookOpen,
    unit: 'páginas/dia',
    min: 1,
    max: 200,
    step: 1,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/20',
  },
  {
    key: 'gym_days_per_week' as const,
    label: 'Academia',
    description: 'Meta semanal de dias de treino',
    icon: Dumbbell,
    unit: 'dias/semana',
    min: 1,
    max: 7,
    step: 1,
    color: 'text-rose-400',
    bg: 'bg-rose-500/10 border-rose-500/20',
  },
  {
    key: 'study_minutes' as const,
    label: 'Estudo',
    description: 'Meta diária de minutos de estudo',
    icon: GraduationCap,
    unit: 'min/dia',
    min: 15,
    max: 480,
    step: 15,
    color: 'text-violet-400',
    bg: 'bg-violet-500/10 border-violet-500/20',
  },
];

export default function MetasPage() {
  const { user } = useAuth();
  const [form, setForm] = useState<GoalsForm>(DEFAULTS);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'users', user.uid, 'settings', 'goals')).then(snap => {
      if (snap.exists()) {
        setForm({ ...DEFAULTS, ...(snap.data() as Partial<GoalsForm>) });
      }
      setFetching(false);
    });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setLoading(true);
    try {
      await setDoc(doc(db, 'users', user.uid, 'settings', 'goals'), {
        ...form,
        updatedAt: new Date(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setLoading(false);
    }
  };

  const set = (key: keyof GoalsForm, value: number) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const formatValue = (key: keyof GoalsForm, val: number) => {
    if (key === 'study_minutes') {
      const h = Math.floor(val / 60);
      const m = val % 60;
      return h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
    }
    if (key === 'water_ml') return `${val.toLocaleString('pt-BR')} ml`;
    if (key === 'steps') return val.toLocaleString('pt-BR');
    return String(val);
  };

  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />

        <section className="flex-1 space-y-6">
          <header className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur-xl">
            <div className="flex items-center gap-4">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-tamagochi-500/15">
                <Target className="text-tamagochi-300" size={28} />
              </div>
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-tamagochi-300">Configurações</p>
                <h1 className="text-4xl font-semibold text-white">Metas Pessoais</h1>
                <p className="text-slate-400">Personalize suas metas diárias e semanais</p>
              </div>
            </div>
          </header>

          {saved && (
            <div className="flex items-center gap-3 rounded-2xl border border-tamagochi-500/20 bg-tamagochi-500/10 p-4 font-medium text-tamagochi-300 backdrop-blur-xl">
              <CheckCircle2 size={20} />
              Metas salvas com sucesso!
            </div>
          )}

          {fetching ? (
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-8 text-center text-slate-400 backdrop-blur-xl">
              Carregando metas...
            </div>
          ) : (
            <div className="space-y-4">
              {goalFields.map(field => {
                const Icon = field.icon;
                const val = form[field.key];
                return (
                  <div
                    key={field.key}
                    className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl"
                  >
                    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-4 sm:w-64">
                        <div className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-3xl border ${field.bg}`}>
                          <Icon className={field.color} size={20} />
                        </div>
                        <div>
                          <p className="font-semibold text-white">{field.label}</p>
                          <p className="text-sm text-slate-400">{field.description}</p>
                        </div>
                      </div>

                      <div className="flex flex-1 items-center gap-4">
                        <input
                          type="range"
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          value={val}
                          onChange={e => set(field.key, Number(e.target.value))}
                          className="flex-1 accent-tamagochi-400"
                        />
                        <div className="w-36 text-right">
                          <p className="text-xl font-bold text-white">{formatValue(field.key, val)}</p>
                          <p className="text-xs text-slate-400">{field.unit}</p>
                        </div>
                      </div>

                      <div className="flex gap-2 sm:ml-4">
                        <button
                          onClick={() => set(field.key, Math.max(field.min, val - field.step))}
                          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/50 text-slate-300 transition hover:border-white/20 hover:bg-white/10"
                        >
                          −
                        </button>
                        <button
                          onClick={() => set(field.key, Math.min(field.max, val + field.step))}
                          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-slate-900/50 text-slate-300 transition hover:border-white/20 hover:bg-white/10"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Creatina info card — always 1x/dia, não configurável */}
              <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl">
                <div className="flex items-center gap-4">
                  <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-3xl border bg-purple-500/10 border-purple-500/20">
                    <Pill className="text-purple-400" size={20} />
                  </div>
                  <div>
                    <p className="font-semibold text-white">Creatina</p>
                    <p className="text-sm text-slate-400">Suplementação diária — meta fixa: 1x por dia</p>
                  </div>
                  <div className="ml-auto rounded-2xl border border-purple-500/20 bg-purple-500/10 px-4 py-2">
                    <p className="text-sm font-medium text-purple-300">1x / dia</p>
                  </div>
                </div>
              </div>

              <button
                onClick={handleSave}
                disabled={loading}
                className="flex w-full items-center justify-center gap-3 rounded-3xl bg-tamagochi-500 py-4 text-base font-semibold text-slate-950 shadow-lg transition hover:bg-tamagochi-400 disabled:opacity-50"
              >
                <Save size={20} />
                {loading ? 'Salvando...' : 'Salvar Metas'}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
