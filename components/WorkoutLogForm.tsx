'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  fmtDatePt, fmtGroups, muscleGroupMeta, saveSession, sessionCompletion, sessionId,
  setTemplateArchived, type SessionExercise, type SetGroup, type WorkoutData,
  type WorkoutSessionDoc, type WorkoutTemplateDoc,
} from '@/lib/workouts';
import {
  AlertTriangle, Archive, ArchiveRestore, ArrowLeft, Check, Loader2, Plus, X,
} from 'lucide-react';

// Registro manual: escolhe a ficha, o form vem preenchido com o último treino
// dela (ou a prescrição), ajusta o que mudou e salva.

interface Props {
  data: WorkoutData;
  onSaved: (session: WorkoutSessionDoc) => void | Promise<void>;
  onDataChanged: () => void | Promise<void>;
}

interface DraftGroup { sets: string; reps: string; weight: string; durationSec: number | null }
interface DraftExercise { key: string; name: string; prescribed: SetGroup[]; groups: DraftGroup[]; skipped: boolean }

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const toDraftGroup = (g: SetGroup): DraftGroup => ({
  sets: g.sets > 0 ? String(g.sets) : '',
  reps: g.reps != null ? String(g.reps) : '',
  weight: g.weight != null && g.weight > 0 ? String(g.weight) : '',
  durationSec: g.durationSec,
});

const fromDraftGroup = (g: DraftGroup): SetGroup => ({
  sets: Number(g.sets) || 0,
  reps: g.reps.trim() === '' ? null : Number(g.reps),
  weight: g.weight.trim() === '' ? null : Number(g.weight.replace(',', '.')),
  durationSec: g.durationSec,
  restSec: null,
});

const inputCls = 'w-full rounded-xl border border-white/10 bg-slate-950/60 px-2 py-2 text-center text-sm text-white focus:border-tamagochi-400 focus:outline-none';

export default function WorkoutLogForm({ data, onSaved, onDataChanged }: Props) {
  const { user } = useAuth();
  const [template, setTemplate] = useState<WorkoutTemplateDoc | null>(null);
  const [date, setDate] = useState(todayKey());
  const [draft, setDraft] = useState<DraftExercise[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const groupOf = useMemo(() => new Map(data.exercises.map(e => [e.key, e.muscleGroup])), [data.exercises]);

  // Última sessão de cada ficha — ordena a lista e alimenta o pré-preenchimento
  const lastByTemplate = useMemo(() => {
    const m = new Map<string, WorkoutSessionDoc>();
    for (const s of data.sessions) {
      const cur = m.get(s.templateKey);
      if (!cur || s.date > cur.date) m.set(s.templateKey, s);
    }
    return m;
  }, [data.sessions]);

  const templates = useMemo(() =>
    [...data.templates]
      .filter(t => showArchived || !t.archived)
      .sort((a, b) => {
        if (a.archived !== b.archived) return a.archived ? 1 : -1;
        const da = lastByTemplate.get(a.key)?.date ?? '';
        const db_ = lastByTemplate.get(b.key)?.date ?? '';
        return db_.localeCompare(da) || a.name.localeCompare(b.name);
      }),
  [data.templates, lastByTemplate, showArchived]);

  const pickTemplate = (t: WorkoutTemplateDoc) => {
    const last = lastByTemplate.get(t.key);
    setDraft(t.exercises.map(e => {
      const prev = last?.exercises.find(x => x.key === e.key);
      // feito da última vez → repete; pulado ou nunca feito → prescrição
      const src = prev && prev.performed.length > 0 ? prev.performed : e.sets;
      const groups = src.length ? src.map(toDraftGroup) : [{ sets: '', reps: '', weight: '', durationSec: null }];
      return { key: e.key, name: e.name, prescribed: e.sets, groups, skipped: false };
    }));
    setTemplate(t);
    setDate(todayKey());
    setError(null);
    setSavedMsg(null);
  };

  const updateGroup = (ei: number, gi: number, patch: Partial<DraftGroup>) =>
    setDraft(d => d.map((ex, i) => i !== ei ? ex : { ...ex, groups: ex.groups.map((g, j) => j !== gi ? g : { ...g, ...patch }) }));
  const addGroup = (ei: number) =>
    setDraft(d => d.map((ex, i) => i !== ei ? ex : { ...ex, groups: [...ex.groups, { ...ex.groups[ex.groups.length - 1] ?? { sets: '', reps: '', weight: '', durationSec: null } }] }));
  const removeGroup = (ei: number, gi: number) =>
    setDraft(d => d.map((ex, i) => i !== ei ? ex : { ...ex, groups: ex.groups.length > 1 ? ex.groups.filter((_, j) => j !== gi) : ex.groups }));
  const toggleSkip = (ei: number) =>
    setDraft(d => d.map((ex, i) => i !== ei ? ex : { ...ex, skipped: !ex.skipped }));

  const existing = template ? data.sessions.find(s => s.id === sessionId(date, template.key)) : null;

  const save = async () => {
    if (!user || !template) return;
    if (!date || date > todayKey()) { setError('A data precisa ser hoje ou um dia passado.'); return; }
    const exercises: SessionExercise[] = draft.map(d => ({
      key: d.key, name: d.name, prescribed: d.prescribed,
      performed: d.skipped ? [] : d.groups.map(fromDraftGroup).filter(g => g.sets > 0),
    }));
    if (!exercises.some(e => e.performed.length > 0)) { setError('Marque pelo menos um exercício com séries feitas.'); return; }

    const session: WorkoutSessionDoc = {
      id: sessionId(date, template.key), date,
      templateKey: template.key, templateName: template.name, objective: template.objective,
      source: 'manual', exercises, ...sessionCompletion(exercises), updatedAt: new Date(),
    };
    setSaving(true);
    setError(null);
    try {
      await saveSession(db, user.uid, session);
      await onSaved(session);
      setSavedMsg(`${template.name} em ${fmtDatePt(date, true)} salvo — ${Math.round(session.completion * 100)}% das séries.`);
      setTemplate(null);
      setDraft([]);
    } catch (err) {
      setError(`Falha ao salvar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async (t: WorkoutTemplateDoc) => {
    if (!user) return;
    setArchiving(t.key);
    try {
      await setTemplateArchived(db, user.uid, t.key, !t.archived);
      await onDataChanged();
    } finally {
      setArchiving(null);
    }
  };

  // ── Escolha da ficha ──────────────────────────────────────────────────────
  if (!template) {
    const archivedCount = data.templates.filter(t => t.archived).length;
    return (
      <div className="space-y-4">
        {savedMsg && (
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            <Check size={18} className="mt-0.5 shrink-0" /><p>{savedMsg}</p>
          </div>
        )}
        <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
          <p className="text-sm uppercase tracking-widest text-tamagochi-300">Qual treino você fez?</p>
          <p className="mt-1 text-sm text-slate-400">A ficha vem preenchida com o último treino dela. Ajuste só o que mudou.</p>

          {templates.length === 0 ? (
            <p className="mt-6 text-sm text-slate-500">Nenhuma ficha ainda — importe uma exportação do SmartGym primeiro.</p>
          ) : (
            <div className="mt-4 space-y-2">
              {templates.map(t => {
                const last = lastByTemplate.get(t.key);
                return (
                  <div key={t.key} className={`flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/50 p-2 pl-4 ${t.archived ? 'opacity-60' : ''}`}>
                    <button onClick={() => pickTemplate(t)} className="flex-1 py-1.5 text-left transition hover:text-tamagochi-200">
                      <p className="font-medium text-white">{t.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {t.exercises.length} exercícios{t.frequency ? ` · ${t.frequency}` : ''}
                        {last ? ` · último: ${fmtDatePt(last.date, last.date.slice(0, 4) !== todayKey().slice(0, 4))}` : ' · nunca registrado'}
                      </p>
                    </button>
                    <button
                      onClick={() => toggleArchive(t)}
                      disabled={archiving === t.key}
                      title={t.archived ? 'Desarquivar' : 'Arquivar (some da lista)'}
                      className="rounded-xl p-2 text-slate-500 transition hover:bg-white/10 hover:text-white"
                    >
                      {archiving === t.key ? <Loader2 size={15} className="animate-spin" /> : t.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {archivedCount > 0 && (
            <button onClick={() => setShowArchived(v => !v)} className="mt-4 text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline">
              {showArchived ? 'Esconder arquivadas' : `Mostrar ${archivedCount} ${archivedCount === 1 ? 'ficha arquivada' : 'fichas arquivadas'}`}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Form da sessão ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 backdrop-blur-xl sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setTemplate(null)} className="rounded-xl border border-white/10 bg-slate-900/60 p-2 text-slate-300 transition hover:bg-white/10">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-white">{template.name}</p>
            <p className="text-xs text-slate-500">{template.objective}</p>
          </div>
          <input
            type="date"
            value={date}
            max={todayKey()}
            onChange={e => setDate(e.target.value)}
            className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white focus:border-tamagochi-400 focus:outline-none"
          />
        </div>

        {existing && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <p>
              Já existe um treino de <strong>{template.name}</strong> em {fmtDatePt(date, true)}
              {existing.source === 'import' ? ' (importado do SmartGym)' : ' (registrado à mão)'}. Salvar vai substituir.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {draft.map((ex, ei) => {
          const meta = muscleGroupMeta(groupOf.get(ex.key) ?? 'outro');
          return (
            <div key={ex.key} className={`rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-xl transition sm:p-4 ${ex.skipped ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-white">{ex.name}</p>
                  <p className="text-[11px] text-slate-500">
                    <span className={`mr-1.5 rounded-full border px-1.5 py-px text-[10px] ${meta.chip}`}>{meta.label}</span>
                    Prescrito: {fmtGroups(ex.prescribed) || '—'}
                  </p>
                </div>
                <button
                  onClick={() => toggleSkip(ei)}
                  className={`shrink-0 rounded-xl border px-2.5 py-1 text-xs transition ${ex.skipped ? 'border-tamagochi-500/40 bg-tamagochi-500/15 text-tamagochi-200' : 'border-white/10 bg-slate-900/60 text-slate-400 hover:text-white'}`}
                >
                  {ex.skipped ? 'Fazer' : 'Pulei'}
                </button>
              </div>

              {!ex.skipped && (
                <div className="mt-3 space-y-1.5">
                  <div className="grid grid-cols-[1fr_1fr_1fr_2rem] gap-1.5 px-1 text-[10px] uppercase tracking-widest text-slate-500">
                    <span className="text-center">Séries</span>
                    <span className="text-center">{ex.groups[0]?.durationSec != null ? 'Seg' : 'Reps'}</span>
                    <span className="text-center">Kg</span>
                    <span />
                  </div>
                  {ex.groups.map((g, gi) => (
                    <div key={gi} className="grid grid-cols-[1fr_1fr_1fr_2rem] items-center gap-1.5">
                      <input inputMode="numeric" value={g.sets} onChange={e => updateGroup(ei, gi, { sets: e.target.value })} className={inputCls} placeholder="4" />
                      <input inputMode="numeric" value={g.durationSec != null ? String(g.durationSec) : g.reps}
                        onChange={e => g.durationSec != null ? updateGroup(ei, gi, { durationSec: Number(e.target.value) || null }) : updateGroup(ei, gi, { reps: e.target.value })}
                        className={inputCls} placeholder="8" />
                      <input inputMode="decimal" value={g.weight} onChange={e => updateGroup(ei, gi, { weight: e.target.value })} className={inputCls} placeholder="—" />
                      <button onClick={() => removeGroup(ei, gi)} disabled={ex.groups.length <= 1} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/10 hover:text-white disabled:opacity-20">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => addGroup(ei)} className="inline-flex items-center gap-1 px-1 pt-1 text-xs text-slate-400 transition hover:text-white">
                    <Plus size={13} /> grupo de séries (pirâmide)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" /><p>{error}</p>
        </div>
      )}

      <div className="sticky bottom-20 z-10 flex justify-end sm:bottom-4">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-2xl bg-tamagochi-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg transition hover:bg-tamagochi-400 disabled:opacity-40"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
          Salvar treino
        </button>
      </div>
    </div>
  );
}
