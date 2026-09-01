'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import {
  Play, Pause, Square, Plus, X, Clock, Smartphone, Copy, Check, AlertTriangle,
} from 'lucide-react';
import {
  ActiveSession, MAX_SESSION_MINUTES,
  newSession, elapsedMs, pause as pauseSession, resume as resumeSession,
  addTopic as addTopicTo, topicsWithMinutes, formatElapsed, sessionDate,
} from '@/lib/studyTimer';

export interface FinishPayload {
  areaId: string | null;
  subArea: string;
  topics: { name: string; minutes: number }[];
  date: string;
  durationMinutes: number;
  notes: string;
  startedAt: number;
  endedAt: number;
}

interface Props {
  areas: { id: string; name: string; colorKey: string }[];
  subAreaSuggestions: (areaId: string) => string[];
  onFinish: (payload: FinishPayload) => Promise<void>;
}

const inputCls =
  'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50 transition';

export default function StudyTimer({ areas, subAreaSuggestions, onFinish }: Props) {
  const { user } = useAuth();

  const [active, setActive] = useState<ActiveSession | null>(null);
  const [loaded, setLoaded]  = useState(false);
  const [now, setNow]        = useState(() => Date.now());
  const [topicDraft, setTopicDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // finalizacao
  const [finishing, setFinishing] = useState(false);
  const [fnDuration, setFnDuration] = useState('');
  const [fnNotes,    setFnNotes]    = useState('');
  const [fnTopics,   setFnTopics]   = useState<{ name: string; minutes: number }[]>([]);
  const [fnSaving,   setFnSaving]   = useState(false);

  // atalhos do iPhone
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [token,  setToken]  = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const topicInputRef = useRef<HTMLInputElement>(null);

  const ref = useCallback(
    () => (user ? doc(db, 'users', user.uid, 'study_active', 'current') : null),
    [user],
  );

  // A sessao ativa vem por onSnapshot: o que o Atalho do iPhone fizer
  // (iniciar, pausar, encerrar) aparece aqui sem precisar recarregar.
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      doc(db, 'users', user.uid, 'study_active', 'current'),
      snap => {
        setActive(snap.exists() ? (snap.data() as ActiveSession) : null);
        setLoaded(true);
      },
      e => { console.error('Erro na sessao ativa:', e); setLoaded(true); },
    );
    return () => unsub();
  }, [user]);

  // Tique do relogio — so enquanto estiver rodando.
  useEffect(() => {
    if (!active || active.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const ms      = active ? elapsedMs(active, now) : 0;
  const minutes = Math.round(ms / 60_000);
  const overCap = minutes > MAX_SESSION_MINUTES;

  const liveTopics = useMemo(
    () => (active ? topicsWithMinutes(active.topics ?? [], ms) : []),
    [active, ms],
  );

  const save = useCallback(async (next: ActiveSession) => {
    const r = ref();
    if (!r) return;
    setActive(next);                      // otimista: o relogio nao trava esperando a rede
    await setDoc(r, { ...next, updatedAt: Date.now() });
  }, [ref]);

  async function handleStart() {
    if (!user || busy) return;
    setBusy(true);
    try {
      await save(newSession({ areaId: areas[0]?.id ?? null, subArea: '' }));
      setTimeout(() => topicInputRef.current?.focus(), 50);
    } finally { setBusy(false); }
  }

  async function handlePauseResume() {
    if (!active || busy) return;
    setBusy(true);
    try {
      await save(active.status === 'running' ? pauseSession(active) : resumeSession(active));
    } finally { setBusy(false); }
  }

  async function handleAddTopic() {
    if (!active || !topicDraft.trim()) return;
    await save(addTopicTo(active, topicDraft));
    setTopicDraft('');
    topicInputRef.current?.focus();
  }

  async function handleRemoveTopic(index: number) {
    if (!active) return;
    await save({ ...active, topics: (active.topics ?? []).filter((_, i) => i !== index) });
  }

  async function handleFieldChange(patch: Partial<ActiveSession>) {
    if (!active) return;
    await save({ ...active, ...patch });
  }

  function openFinish() {
    if (!active) return;
    const total = elapsedMs(active, Date.now());
    const mins  = Math.round(total / 60_000);
    setFnTopics(topicsWithMinutes(active.topics ?? [], total));
    // Passou do teto: ja sugere o corte, mas o valor continua editavel.
    setFnDuration(String(mins > MAX_SESSION_MINUTES ? MAX_SESSION_MINUTES : mins));
    setFnNotes(active.notes ?? '');
    setFinishing(true);
  }

  async function handleConfirmFinish() {
    if (!active || fnSaving) return;
    const dur = Number(fnDuration);
    if (!Number.isFinite(dur) || dur < 1) return;
    setFnSaving(true);
    try {
      await onFinish({
        areaId: active.areaId,
        subArea: active.subArea ?? '',
        topics: fnTopics.filter(t => t.name.trim()),
        date: sessionDate(active.startedAt),
        durationMinutes: Math.round(dur),
        notes: fnNotes,
        startedAt: active.startedAt,
        endedAt: Date.now(),
      });
      const r = ref();
      if (r) await deleteDoc(r);
      setActive(null);
      setFinishing(false);
      setTopicDraft('');
    } finally { setFnSaving(false); }
  }

  async function handleDiscard() {
    const r = ref();
    if (!r) return;
    if (!confirm('Descartar esta sessão? O tempo não será registrado.')) return;
    await deleteDoc(r);
    setActive(null);
    setFinishing(false);
  }

  // ── atalhos do iPhone ──────────────────────────────────────────────────────
  const loadToken = useCallback(async () => {
    if (!user) return;
    const r = doc(db, 'nfc_tokens', user.uid);
    const snap = await getDoc(r);
    if (snap.exists()) {
      setToken(snap.data().token);
    } else {
      const t = crypto.randomUUID();
      await setDoc(r, { token: t, userId: user.uid });
      setToken(t);
    }
  }, [user]);

  useEffect(() => { if (showShortcuts) loadToken(); }, [showShortcuts, loadToken]);

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(c => (c === key ? null : c)), 1500);
  }

  const shortcutUrls = useMemo(() => {
    const base = `${origin}/api/study/timer?token=${token ?? 'SEU_TOKEN'}`;
    return [
      { key: 'start',  label: 'Iniciar estudo', url: `${base}&action=start` },
      { key: 'pause',  label: 'Pausar',         url: `${base}&action=pause` },
      { key: 'resume', label: 'Retomar',        url: `${base}&action=resume` },
      { key: 'stop',   label: 'Terminar',       url: `${base}&action=stop` },
    ];
  }, [origin, token]);

  if (!loaded) return null;

  // ── sem sessao: so o botao de iniciar ──────────────────────────────────────
  if (!active) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={handleStart} disabled={busy}
            className="flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 px-5 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/25 disabled:opacity-50">
            <Play size={15} /> Iniciar Estudo
          </button>
          <button onClick={() => setShowShortcuts(v => !v)}
            className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-400 transition hover:border-cyan-500/30 hover:text-cyan-300">
            <Smartphone size={12} /> Atalhos do iPhone
          </button>
        </div>
        {showShortcuts && <ShortcutPanel urls={shortcutUrls} copied={copied} onCopy={copy} />}
      </div>
    );
  }

  // ── sessao em andamento ────────────────────────────────────────────────────
  const running = active.status === 'running';
  const subs    = subAreaSuggestions(active.areaId ?? '');

  return (
    <div className="space-y-3">
      <div className={`rounded-[2rem] border p-6 backdrop-blur-xl transition
        ${running ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>

        {/* cronometro */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wide
              ${running ? 'text-emerald-400' : 'text-amber-400'}`}>
              <span className={`h-2 w-2 rounded-full ${running ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'}`} />
              {running ? 'Estudando' : 'Pausado'}
            </p>
            <p className="mt-1 font-mono text-4xl font-semibold tabular-nums text-white">
              {formatElapsed(ms)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handlePauseResume} disabled={busy}
              className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-50">
              {running ? <><Pause size={15} /> Pausar</> : <><Play size={15} /> Retomar</>}
            </button>
            <button onClick={openFinish}
              className="flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/15 px-4 py-2.5 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/25">
              <Square size={15} /> Terminar
            </button>
            <button onClick={handleDiscard} title="Descartar sessão"
              className="rounded-2xl border border-white/10 bg-white/5 p-2.5 text-slate-500 transition hover:border-red-500/30 hover:text-red-400">
              <X size={15} />
            </button>
          </div>
        </div>

        {overCap && (
          <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle size={13} className="shrink-0" />
            Passou de {MAX_SESSION_MINUTES / 60}h. Se esqueceu o cronômetro rodando, ajuste a duração ao terminar.
          </p>
        )}

        {/* area e subarea — editaveis a qualquer momento, inclusive depois de
            iniciar pelo Atalho do iPhone */}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Grande área</label>
            <select className={inputCls} value={active.areaId ?? ''}
              onChange={e => handleFieldChange({ areaId: e.target.value || null, subArea: '' })}>
              <option value="">Definir depois...</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-400">Pequena área</label>
            <input className={inputCls} list="timer-subarea-list" value={active.subArea ?? ''}
              onChange={e => handleFieldChange({ subArea: e.target.value })}
              placeholder="Ex: Hematopatologia" />
            <datalist id="timer-subarea-list">
              {subs.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>

        {/* topicos ao vivo */}
        <div className="mt-5">
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            Tópicos ({liveTopics.length})
          </label>
          <div className="flex gap-2">
            <input ref={topicInputRef} className={inputCls} value={topicDraft}
              onChange={e => setTopicDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTopic(); } }}
              placeholder="O que você está estudando agora?" />
            <button onClick={handleAddTopic} disabled={!topicDraft.trim()}
              className="shrink-0 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 text-cyan-300 transition hover:bg-cyan-500/20 disabled:opacity-40">
              <Plus size={16} />
            </button>
          </div>

          {liveTopics.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {liveTopics.map((t, i) => (
                <li key={i}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2">
                  <span className="text-xs text-slate-600">{i + 1}</span>
                  <span className="flex-1 min-w-0 truncate text-sm text-slate-200">{t.name}</span>
                  <span className="flex items-center gap-1 text-xs text-slate-500">
                    <Clock size={11} /> {t.minutes} min
                  </span>
                  <button onClick={() => handleRemoveTopic(i)}
                    className="text-slate-700 transition hover:text-red-400">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setShowShortcuts(v => !v)}
          className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-400 transition hover:border-cyan-500/30 hover:text-cyan-300">
          <Smartphone size={12} /> Atalhos do iPhone
        </button>
      </div>
      {showShortcuts && <ShortcutPanel urls={shortcutUrls} copied={copied} onCopy={copy} />}

      {/* resumo antes de salvar */}
      {finishing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setFinishing(false); }}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[2rem] border border-white/10 bg-[#0d1b2a] p-5 shadow-2xl sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Terminar sessão</h2>
              <button onClick={() => setFinishing(false)} className="text-slate-400 transition hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              {Math.round(elapsedMs(active, now) / 60_000) > MAX_SESSION_MINUTES && (
                <p className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  O cronômetro marcou {Math.round(elapsedMs(active, now) / 60_000)} min.
                  Sugeri {MAX_SESSION_MINUTES} min, mas o valor abaixo é seu.
                </p>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Duração (min) *</label>
                <input className={inputCls} type="number" min={1} value={fnDuration}
                  onChange={e => setFnDuration(e.target.value)} />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Grande área</label>
                <select className={inputCls} value={active.areaId ?? ''}
                  onChange={e => handleFieldChange({ areaId: e.target.value || null, subArea: '' })}>
                  <option value="">Sem área</option>
                  {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Pequena área</label>
                <input className={inputCls} value={active.subArea ?? ''}
                  onChange={e => handleFieldChange({ subArea: e.target.value })} />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Tópicos</label>
                {fnTopics.length === 0 ? (
                  <p className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2.5 text-xs text-slate-500">
                    Nenhum tópico anotado.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {fnTopics.map((t, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <input className={inputCls} value={t.name}
                          onChange={e => setFnTopics(list =>
                            list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                        <input className="w-20 shrink-0 rounded-xl border border-white/10 bg-white/5 px-2 py-2.5 text-center text-sm text-slate-200 outline-none focus:border-cyan-500/50"
                          type="number" min={0} value={t.minutes}
                          onChange={e => setFnTopics(list =>
                            list.map((x, j) => (j === i ? { ...x, minutes: Number(e.target.value) } : x)))} />
                        <button onClick={() => setFnTopics(list => list.filter((_, j) => j !== i))}
                          className="shrink-0 text-slate-700 transition hover:text-red-400">
                          <X size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Observações</label>
                <textarea className={`${inputCls} resize-none`} rows={2} value={fnNotes}
                  onChange={e => setFnNotes(e.target.value)} placeholder="Opcional..." />
              </div>

              <button onClick={handleConfirmFinish}
                disabled={fnSaving || !Number(fnDuration) || Number(fnDuration) < 1}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/15 py-2.5 text-sm font-medium text-cyan-300 transition hover:bg-cyan-500/25 disabled:opacity-50">
                {fnSaving ? 'Salvando...' : <><Check size={14} /> Salvar sessão</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShortcutPanel({
  urls, copied, onCopy,
}: {
  urls: { key: string; label: string; url: string }[];
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  return (
    <div className="rounded-[2rem] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <Smartphone size={18} className="mt-0.5 shrink-0 text-cyan-400" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-white">Controlar o estudo pelo iPhone</p>
          <p className="mt-1.5 text-sm text-slate-400">
            No app Atalhos, crie um atalho com a ação <strong className="text-slate-300">Obter conteúdo da URL</strong> e
            cole um dos endereços abaixo. Ao iniciar por aqui, a grande e a pequena área ficam em branco — é só
            preencher nesta página depois, com a sessão já rodando.
          </p>
          <div className="mt-4 space-y-2">
            {urls.map(u => (
              <div key={u.key}
                className="flex items-center gap-3 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2">
                <span className="w-24 shrink-0 text-xs font-medium text-slate-300">{u.label}</span>
                <code className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{u.url}</code>
                <button onClick={() => onCopy(u.url, u.key)}
                  className="shrink-0 text-slate-500 transition hover:text-cyan-300">
                  {copied === u.key ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-600">
            A resposta traz o campo <code className="text-slate-500">mensagem</code>, pronto para usar em
            uma notificação do atalho. O token é o mesmo dos outros atalhos do app — não compartilhe.
          </p>
        </div>
      </div>
    </div>
  );
}
