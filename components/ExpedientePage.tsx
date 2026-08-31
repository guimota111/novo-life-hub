'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, increment,
  onSnapshot, setDoc, Timestamp,
} from 'firebase/firestore';
import {
  Play, Timer, GraduationCap, Coffee, Briefcase, CalendarClock, Plus, X,
  Settings2, Square, Check, Volume2, VolumeX, Bell, BellOff,
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { usePush } from '@/contexts/PushContext';
import {
  ActiveSession, newSession, elapsedMs, formatElapsed, sessionDate,
} from '@/lib/studyTimer';
import {
  Block, BlockType, BLOCK_LABEL, Commitment, DEFAULT_CONFIG, Expediente,
  ExpedienteConfig, MS_MIN, blockAt, buildBlocks, clock, minutesLabel,
  nextBlockAfter, planEndAt, replanFrom, studyLengths, freeMinutes,
  timeToTimestamp,
} from '@/lib/expediente';

// ─── aparencia ────────────────────────────────────────────────────────────────

const STYLE: Record<BlockType, { bar: string; text: string; soft: string; Icon: typeof Timer }> = {
  work:       { bar: 'bg-tamagochi-500', text: 'text-tamagochi-500', soft: 'bg-tamagochi-500/10 border-tamagochi-500/30', Icon: Briefcase },
  study:      { bar: 'bg-cyan-400',      text: 'text-cyan-400',      soft: 'bg-cyan-400/10 border-cyan-400/30',           Icon: GraduationCap },
  break:      { bar: 'bg-emerald-400',   text: 'text-emerald-400',   soft: 'bg-emerald-400/10 border-emerald-400/30',     Icon: Coffee },
  commitment: { bar: 'bg-tamagochi-200', text: 'text-tamagochi-200', soft: 'bg-tamagochi-200/10 border-tamagochi-200/30', Icon: CalendarClock },
};

const inputCls = 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50 transition';
const cardCls  = 'rounded-[2rem] border border-white/10 bg-white/5 p-6 shadow-glow backdrop-blur-xl';

// Bipe curto nas trocas de bloco. WebAudio para nao carregar arquivo de som.
function beep() {
  try {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.42);
    setTimeout(() => { ctx.close().catch(() => {}); }, 600);
  } catch { /* audio bloqueado pelo navegador — silencio e aceitavel */ }
}

interface StudyArea { id: string; name: string }

// ─── timeline ─────────────────────────────────────────────────────────────────

function Timeline({ blocks, now }: { blocks: Block[]; now: number }) {
  if (blocks.length === 0) {
    return <p className="text-sm text-slate-500">Nenhum bloco cabe nesse intervalo.</p>;
  }
  return (
    <div className="space-y-1">
      {blocks.map(b => {
        const s = STYLE[b.type];
        const min = Math.round((b.endAt - b.startAt) / MS_MIN);
        const past = b.endAt <= now;
        const active = b.startAt <= now && now < b.endAt;
        const progress = active ? ((now - b.startAt) / (b.endAt - b.startAt)) * 100 : 0;
        return (
          <div key={b.id} className={`flex items-stretch gap-3 ${past ? 'opacity-40' : ''}`}>
            <div className="w-11 shrink-0 pt-1 text-right text-[11px] tabular-nums text-slate-500">
              {clock(b.startAt)}
            </div>
            <div
              className="relative w-1.5 shrink-0 overflow-hidden rounded-full bg-white/10"
              style={{ minHeight: Math.max(26, Math.min(min * 1.5, 110)) }}
            >
              <div className={`absolute inset-x-0 top-0 ${s.bar} ${active ? '' : 'bottom-0'}`}
                style={active ? { height: `${progress}%` } : undefined} />
            </div>
            <div className="flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <s.Icon size={13} className={s.text} />
                <span className={`text-sm font-medium ${active ? 'text-white' : 'text-slate-300'}`}>
                  {b.title ?? BLOCK_LABEL[b.type]}
                </span>
                <span className="text-[11px] text-slate-500">{min} min</span>
                {active && (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white">agora</span>
                )}
                {b.confirmedAt && <Check size={12} className="text-emerald-400" />}
              </div>
              {b.type === 'study' && b.subArea && (
                <p className="text-[11px] text-slate-500">{b.subArea}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── formulario de compromisso ────────────────────────────────────────────────

function CommitmentForm({ onAdd }: { onAdd: (c: Commitment) => void }) {
  const [open,  setOpen]  = useState(false);
  const [title, setTitle] = useState('');
  const [from,  setFrom]  = useState('');
  const [to,    setTo]    = useState('');
  const [error, setError] = useState('');

  function submit() {
    const startAt = timeToTimestamp(from);
    const endAt   = timeToTimestamp(to);
    if (!startAt || !endAt)   return setError('Preencha os dois horários.');
    if (endAt <= startAt)     return setError('O fim tem que ser depois do início.');
    onAdd({ id: `c_${startAt}_${endAt}`, title: title.trim() || 'Compromisso', startAt, endAt });
    setTitle(''); setFrom(''); setTo(''); setError(''); setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/5">
        <Plus size={14} /> Compromisso
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3">
      <input className={inputCls} placeholder="Reunião, audiência…" value={title}
        onChange={e => setTitle(e.target.value)} />
      <div className="flex gap-2">
        <input type="time" className={inputCls} value={from} onChange={e => setFrom(e.target.value)} />
        <input type="time" className={inputCls} value={to}   onChange={e => setTo(e.target.value)} />
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button onClick={submit} className="flex-1 rounded-xl bg-tamagochi-500/20 py-2 text-xs font-semibold text-tamagochi-300 transition hover:bg-tamagochi-500/30">
          Adicionar
        </button>
        <button onClick={() => { setOpen(false); setError(''); }} className="rounded-xl px-3 py-2 text-xs text-slate-400 transition hover:text-white">
          Cancelar
        </button>
      </div>
    </div>
  );
}

// ─── pagina ───────────────────────────────────────────────────────────────────

interface Draft {
  startAt: number;
  targetAt: number;
  studyPct: number;
  commitments: Commitment[];
}

export default function ExpedientePage() {
  const { user } = useAuth();
  const { sendPush } = usePush();

  const [exp,    setExp]    = useState<Expediente | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [cfg,    setCfg]    = useState<ExpedienteConfig>(DEFAULT_CONFIG);
  const [lastPct, setLastPct] = useState(20);
  const [areas,  setAreas]  = useState<StudyArea[]>([]);
  const [now,    setNow]    = useState(() => Date.now());

  const [draft,       setDraft]       = useState<Draft | null>(null);
  const [targetInput, setTargetInput] = useState('');
  const [arriveError, setArriveError] = useState('');

  const [askArea,  setAskArea]  = useState(false);
  const [pickArea, setPickArea] = useState('');
  const [pickSub,  setPickSub]  = useState('');
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);

  const expRef      = useCallback(() => user ? doc(db, 'users', user.uid, 'expediente_active', 'current') : null, [user]);
  const settingsRef = useCallback(() => user ? doc(db, 'users', user.uid, 'settings', 'expediente')        : null, [user]);
  const activeStudyRef = useCallback(() => user ? doc(db, 'users', user.uid, 'study_active', 'current')    : null, [user]);

  // ── carregamento ────────────────────────────────────────────────────────────

  useEffect(() => {
    const ref = expRef();
    if (!ref) return;
    const unsub = onSnapshot(ref, snap => {
      setExp(snap.exists() ? (snap.data() as Expediente) : null);
      setLoaded(true);
    }, () => setLoaded(true));
    return () => unsub();
  }, [expRef]);

  useEffect(() => {
    const ref = settingsRef();
    if (!ref) return;
    getDoc(ref).then(snap => {
      if (!snap.exists()) return;
      const data = snap.data() as { config?: Partial<ExpedienteConfig>; studyPct?: number };
      if (data.config) setCfg({ ...DEFAULT_CONFIG, ...data.config });
      if (typeof data.studyPct === 'number') setLastPct(data.studyPct);
    }).catch(() => {});
  }, [settingsRef]);

  useEffect(() => {
    if (!user) return;
    getDocs(collection(db, 'users', user.uid, 'study_areas'))
      .then(s => setAreas(s.docs.map(d => ({ id: d.id, name: (d.data().name as string) ?? '—' }))))
      .catch(() => {});
  }, [user]);

  // Sugere a hora alvo: de manha, o almoco; de tarde, o fim do expediente.
  useEffect(() => {
    if (targetInput) return;
    setTargetInput(new Date().getHours() < 12 ? '12:30' : '18:00');
  }, [targetInput]);

  // ── relogio ─────────────────────────────────────────────────────────────────

  const running = exp?.status === 'running';
  useEffect(() => {
    if (!running && !draft) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running, draft]);

  const blocks  = useMemo(() => exp?.blocks ?? [], [exp]);
  const current = running ? blockAt(blocks, now) : null;
  const next    = running ? nextBlockAfter(blocks, now) : null;
  const endsAt  = exp ? planEndAt(blocks, exp.targetAt) : 0;
  const over    = Boolean(running && now >= endsAt);

  // ── avisos nas trocas de bloco ──────────────────────────────────────────────

  const lastSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!running) { lastSeen.current = null; return; }
    const id = current?.id ?? 'fim';
    if (lastSeen.current === null) { lastSeen.current = id; return; }
    if (lastSeen.current === id) return;
    lastSeen.current = id;

    if (cfg.sound) beep();
    if (cfg.push && document.hidden) {
      const title = current ? `${BLOCK_LABEL[current.type]} agora` : 'Período encerrado';
      const body  = current
        ? `Até ${clock(current.endAt)}${current.type === 'study' ? ' — confirme para o cronômetro contar' : ''}`
        : 'O plano do período chegou ao fim.';
      sendPush(title, body, '/expediente');
    }
  }, [current, running, cfg.sound, cfg.push, sendPush]);

  // Tempo restante no titulo da aba, para ver com a aba no fundo.
  useEffect(() => {
    if (!running || !current) return;
    document.title = `${formatElapsed(current.endAt - now)} · ${BLOCK_LABEL[current.type]}`;
    return () => { document.title = 'Tamagochi Me'; };
  }, [running, current, now]);

  // ── escrita ─────────────────────────────────────────────────────────────────

  const save = useCallback(async (nextExp: Expediente) => {
    const ref = expRef();
    if (!ref) return;
    await setDoc(ref, { ...nextExp, updatedAt: Date.now() });
  }, [expRef]);

  // Encerra a sessao de estudo em andamento e grava igual a pagina de Estudo:
  // uma linha em study_sessions e o total somado em daily_logs.
  const stopStudy = useCallback(async (endedAt: number) => {
    const ref = activeStudyRef();
    if (!ref || !user) return;
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const s = snap.data() as ActiveSession;
      const minutes = Math.round(elapsedMs(s, endedAt) / MS_MIN);
      if (minutes >= 1) {
        const date = sessionDate(s.startedAt);
        await addDoc(collection(db, 'users', user.uid, 'study_sessions'), {
          areaId: s.areaId ?? '', subArea: s.subArea ?? '', topic: '', topics: [],
          date, durationMinutes: minutes, notes: null,
          startedAt: s.startedAt, endedAt,
          source: 'expediente', needsReview: !s.areaId, createdAt: Timestamp.now(),
        });
        await setDoc(doc(db, 'users', user.uid, 'daily_logs', date),
          { study_minutes: increment(minutes), updatedAt: new Date() }, { merge: true });
      }
      await deleteDoc(ref);
    }
  }, [activeStudyRef, user]);

  // O bloco de estudo acabou e voce nao respondeu a tempo: encerra sozinho,
  // contando ate o fim do bloco (a hesitacao nao vira minuto de estudo).
  const studyBlock = exp?.studyBlockId
    ? blocks.find(b => b.id === exp.studyBlockId) ?? null
    : null;
  const studyOver  = Boolean(studyBlock && now >= studyBlock.endAt);
  const graceLeft  = studyBlock
    ? Math.ceil((studyBlock.endAt + cfg.continueSec * 1000 - now) / 1000)
    : 0;

  const autoStopping = useRef(false);
  useEffect(() => {
    if (!exp || !studyBlock || !studyOver || graceLeft > 0 || autoStopping.current) return;
    autoStopping.current = true;
    (async () => {
      try {
        await stopStudy(studyBlock.endAt);
        await save({ ...exp, studyBlockId: null });
      } finally { autoStopping.current = false; }
    })();
  }, [exp, studyBlock, studyOver, graceLeft, stopStudy, save]);

  // ── acoes ───────────────────────────────────────────────────────────────────

  function arrive() {
    const targetAt = timeToTimestamp(targetInput);
    if (!targetAt) return setArriveError('Informe a hora alvo.');
    if (targetAt <= Date.now()) return setArriveError('A hora alvo já passou.');
    setArriveError('');
    setDraft({ startAt: Date.now(), targetAt, studyPct: lastPct, commitments: [] });
  }

  async function start() {
    if (!draft || !user) return;
    setBusy(true);
    try {
      const startedAt = Date.now();
      const commitments = draft.commitments.filter(c => c.endAt > startedAt);
      const fresh: Expediente = {
        date: sessionDate(startedAt),
        status: 'running',
        startedAt,
        targetAt: draft.targetAt,
        studyPct: draft.studyPct,
        config: cfg,
        commitments,
        blocks: buildBlocks(startedAt, draft.targetAt, cfg, draft.studyPct, commitments),
        studyBlockId: null,
        endedAt: null,
        updatedAt: startedAt,
      };
      await save(fresh);
      const sref = settingsRef();
      if (sref) await setDoc(sref, { config: cfg, studyPct: draft.studyPct }, { merge: true });
      setLastPct(draft.studyPct);
      setDraft(null);
      lastSeen.current = null;
    } finally { setBusy(false); }
  }

  async function confirmCurrent() {
    if (!exp || !current) return;
    if (current.type === 'study') { setPickArea(areas[0]?.id ?? ''); setPickSub(''); setAskArea(true); return; }
    await save({
      ...exp,
      blocks: blocks.map(b => b.id === current.id ? { ...b, confirmedAt: Date.now() } : b),
    });
  }

  // Comeca (ou adota) a sessao de estudo do bloco atual.
  async function confirmStudy() {
    if (!exp || !current) return;
    const ref = activeStudyRef();
    if (!ref) return;
    setBusy(true);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        await setDoc(ref, {
          ...newSession({ areaId: pickArea || null, subArea: pickSub.trim() }),
          updatedAt: Date.now(),
        });
      }
      await save({
        ...exp,
        studyBlockId: current.id,
        blocks: blocks.map(b => b.id === current.id
          ? { ...b, confirmedAt: Date.now(), areaId: pickArea || null, subArea: pickSub.trim() }
          : b),
      });
      setAskArea(false);
    } finally { setBusy(false); }
  }

  // "Continuar": estica o estudo por mais um bloco do mesmo tamanho e refaz o
  // resto do periodo a partir dali.
  async function extendStudy() {
    if (!exp || !studyBlock) return;
    setBusy(true);
    try {
      const len = studyBlock.endAt - studyBlock.startAt;
      const newEnd = Math.min(exp.targetAt, Date.now() + len);
      const kept = blocks
        .filter(b => b.id === studyBlock.id || b.endAt <= studyBlock.startAt || b.startAt >= newEnd)
        .map(b => b.id === studyBlock.id ? { ...b, endAt: newEnd } : b);
      const merged = { ...exp, blocks: kept };
      await save({ ...merged, blocks: replanFrom(merged, newEnd) });
    } finally { setBusy(false); }
  }

  async function endStudyNow() {
    if (!exp || !studyBlock) return;
    setBusy(true);
    try {
      const at = Math.min(Date.now(), studyBlock.endAt);
      await stopStudy(at);
      const trimmed = {
        ...exp,
        studyBlockId: null,
        blocks: blocks.map(b => b.id === studyBlock.id ? { ...b, endAt: at } : b),
      };
      await save({ ...trimmed, blocks: replanFrom(trimmed, at) });
    } finally { setBusy(false); }
  }

  async function addCommitment(c: Commitment) {
    if (draft) { setDraft({ ...draft, commitments: [...draft.commitments, c] }); return; }
    if (!exp) return;
    // Nao corta o bloco em andamento se o compromisso e mais tarde.
    const from = current && c.startAt >= current.endAt ? current.endAt : Date.now();
    const merged = { ...exp, commitments: [...exp.commitments, c] };
    await save({ ...merged, blocks: replanFrom(merged, from) });
  }

  async function endPeriod() {
    if (!exp) return;
    setBusy(true);
    try {
      const at = Date.now();
      if (exp.studyBlockId && studyBlock) await stopStudy(Math.min(at, studyBlock.endAt));
      await save({
        ...exp,
        status: 'done',
        endedAt: at,
        studyBlockId: null,
        blocks: blocks.filter(b => b.startAt < at).map(b => b.endAt > at ? { ...b, endAt: at } : b),
      });
    } finally { setBusy(false); }
  }

  async function saveRules(patch: Partial<ExpedienteConfig>) {
    const merged = { ...cfg, ...patch };
    setCfg(merged);
    const ref = settingsRef();
    if (ref) await setDoc(ref, { config: merged }, { merge: true });
  }

  // ── derivados de exibicao ───────────────────────────────────────────────────

  const previewBlocks = useMemo(
    () => draft ? buildBlocks(draft.startAt, draft.targetAt, cfg, draft.studyPct, draft.commitments) : [],
    [draft, cfg],
  );

  const previewStudy = useMemo(() => {
    if (!draft) return { lens: [] as number[], free: 0 };
    const free = freeMinutes(draft.startAt, draft.targetAt, draft.commitments);
    return { lens: studyLengths(free, draft.studyPct, cfg), free };
  }, [draft, cfg]);

  const summary = useMemo(() => {
    if (!exp) return null;
    const done = blocks.filter(b => b.type === 'work' || b.type === 'study');
    const confirmed = done.filter(b => b.confirmedAt).length;
    const mins = (t: BlockType) => blocks
      .filter(b => b.type === t)
      .reduce((a, b) => a + Math.round((b.endAt - b.startAt) / MS_MIN), 0);
    return {
      work: mins('work'),
      study: blocks.filter(b => b.type === 'study' && b.confirmedAt)
        .reduce((a, b) => a + Math.round((b.endAt - b.startAt) / MS_MIN), 0),
      adherence: done.length ? Math.round((confirmed / done.length) * 100) : 0,
      from: exp.startedAt,
      to: exp.endedAt ?? endsAt,
    };
  }, [exp, blocks, endsAt]);

  if (!loaded) return <div className={cardCls}><p className="text-sm text-slate-400">Carregando…</p></div>;

  // ── tela: parado / resumo do periodo anterior ───────────────────────────────

  if (!exp || exp.status === 'done') {
    return (
      <div className="space-y-5">
        {exp?.status === 'done' && summary && (
          <div className={cardCls}>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Período encerrado</p>
            <p className="mt-1 text-sm text-slate-400">
              {clock(summary.from)} → {clock(summary.to)}
            </p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-tamagochi-500/30 bg-tamagochi-500/10 p-3">
                <p className="text-lg font-semibold text-white">{minutesLabel(summary.work)}</p>
                <p className="text-[11px] text-slate-400">trabalho</p>
              </div>
              <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-3">
                <p className="text-lg font-semibold text-white">{minutesLabel(summary.study)}</p>
                <p className="text-[11px] text-slate-400">estudo cumprido</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="text-lg font-semibold text-white">{summary.adherence}%</p>
                <p className="text-[11px] text-slate-400">blocos confirmados</p>
              </div>
            </div>
          </div>
        )}

        {draft ? (
          <PreviewCard
            draft={draft} setDraft={setDraft} cfg={cfg} blocks={previewBlocks}
            study={previewStudy} now={now} busy={busy}
            onStart={start} onCancel={() => setDraft(null)} onAddCommitment={addCommitment}
          />
        ) : (
          <div className={cardCls}>
            <h2 className="text-lg font-semibold text-white">
              {exp?.status === 'done' ? 'Começar outro período' : 'Começar o expediente'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Marque a chegada e diga até que horas quer dividir. Ao voltar do almoço, é só marcar de novo.
            </p>
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-400">Hora alvo</label>
                <input type="time" value={targetInput} onChange={e => setTargetInput(e.target.value)}
                  className={`${inputCls} w-36`} />
              </div>
              <button onClick={arrive}
                className="inline-flex items-center gap-2 rounded-2xl bg-tamagochi-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-glow transition hover:bg-tamagochi-400">
                <Play size={18} /> Cheguei
              </button>
            </div>
            {arriveError && <p className="mt-2 text-xs text-red-400">{arriveError}</p>}
          </div>
        )}
      </div>
    );
  }

  // ── tela: rodando ───────────────────────────────────────────────────────────

  const s = current ? STYLE[current.type] : null;

  return (
    <div className="space-y-5">
      {/* bloco atual */}
      <div className={cardCls}>
        {over ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Plano concluído</p>
              <p className="mt-1 text-2xl font-semibold text-white">Você já pode sair</p>
              <p className="text-sm text-slate-400">O período terminou às {clock(endsAt)}.</p>
            </div>
            <button onClick={endPeriod} disabled={busy}
              className="inline-flex items-center gap-2 rounded-2xl bg-tamagochi-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-tamagochi-400 disabled:opacity-50">
              <Square size={16} /> Encerrar e ver resumo
            </button>
          </div>
        ) : !current ? (
          // Vao entre blocos (a beira de um compromisso, por exemplo): o periodo
          // continua, so nao ha bloco correndo agora.
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Livre</p>
            <p className="mt-2 font-mono text-5xl font-semibold tabular-nums text-white">
              {next ? formatElapsed(Math.max(0, next.startAt - now)) : '—'}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {next
                ? <>até {next.title ?? BLOCK_LABEL[next.type]}, às {clock(next.startAt)}</>
                : 'nada planejado adiante'}
            </p>
          </div>
        ) : (
          <div className={`rounded-[1.5rem] border p-6 ${s!.soft}`}>
            <div className="flex items-center gap-2">
              {s && <s.Icon size={16} className={s.text} />}
              <span className={`text-sm font-semibold uppercase tracking-widest ${s!.text}`}>
                {current.title ?? BLOCK_LABEL[current.type]}
              </span>
              {current.confirmedAt
                ? <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-400"><Check size={12} /> confirmado</span>
                : <span className="ml-auto text-[11px] text-slate-500">não confirmado</span>}
            </div>

            <p className="mt-3 font-mono text-6xl font-semibold tabular-nums text-white sm:text-7xl">
              {formatElapsed(Math.max(0, current.endAt - now))}
            </p>
            <p className="mt-1 text-sm text-slate-400">
              {clock(current.startAt)} → {clock(current.endAt)}
              {next && <> · depois: {next.title ?? BLOCK_LABEL[next.type]} até {clock(next.endAt)}</>}
            </p>

            {!current.confirmedAt && current.type !== 'commitment' && (
              <button onClick={confirmCurrent} disabled={busy}
                className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white/10 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50">
                <Play size={16} />
                {current.type === 'study' ? 'Estou cumprindo — iniciar estudo' : 'Começar'}
              </button>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <CommitmentForm onAdd={addCommitment} />
          <button onClick={() => saveRules({ sound: !cfg.sound })}
            className="rounded-xl border border-white/10 p-2 text-slate-400 transition hover:text-white" title="Som">
            {cfg.sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button onClick={() => saveRules({ push: !cfg.push })}
            className="rounded-xl border border-white/10 p-2 text-slate-400 transition hover:text-white" title="Notificações">
            {cfg.push ? <Bell size={14} /> : <BellOff size={14} />}
          </button>
          <button onClick={() => setShowRules(v => !v)}
            className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/5">
            <Settings2 size={14} /> Regras
          </button>
          {!over && (
            <button onClick={endPeriod} disabled={busy}
              className="ml-auto flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 transition hover:bg-red-500/20 disabled:opacity-50">
              <Square size={14} /> Encerrar
            </button>
          )}
        </div>

        {showRules && <RulesPanel cfg={cfg} onChange={saveRules} />}
      </div>

      {/* timeline */}
      <div className={cardCls}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">Período</h2>
          <p className="text-xs text-slate-500">
            {clock(exp.startedAt)} → {clock(endsAt)}
            {endsAt < exp.targetAt && <> · alvo {clock(exp.targetAt)}</>}
          </p>
        </div>
        <Timeline blocks={blocks} now={now} />
      </div>

      {/* escolha da area ao iniciar o estudo */}
      {askArea && (
        <Sheet title="O que você vai estudar?" onClose={() => setAskArea(false)}>
          {areas.length === 0 ? (
            <p className="text-sm text-slate-400">
              Você ainda não tem áreas cadastradas. Crie uma na página de Estudo, ou siga sem área — a sessão fica marcada para revisar depois.
            </p>
          ) : (
            <select value={pickArea} onChange={e => setPickArea(e.target.value)} className={inputCls}>
              <option value="">Sem área (revisar depois)</option>
              {areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <input className={`${inputCls} mt-3`} placeholder="Sub-área ou tema (opcional)"
            value={pickSub} onChange={e => setPickSub(e.target.value)} />
          <button onClick={confirmStudy} disabled={busy}
            className="mt-4 w-full rounded-2xl bg-cyan-500/20 py-3 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/30 disabled:opacity-50">
            Iniciar cronômetro
          </button>
        </Sheet>
      )}

      {/* fim do bloco de estudo */}
      {studyBlock && studyOver && graceLeft > 0 && (
        <Sheet title="Continuar estudando?" onClose={() => {}}>
          <p className="text-sm text-slate-400">
            O bloco de estudo acabou. Sem resposta em <span className="font-semibold text-white">{graceLeft}s</span>,
            o cronômetro para sozinho e a sessão é salva.
          </p>
          <div className="mt-4 flex gap-2">
            <button onClick={extendStudy} disabled={busy}
              className="flex-1 rounded-2xl bg-cyan-500/20 py-3 text-sm font-semibold text-cyan-300 transition hover:bg-cyan-500/30 disabled:opacity-50">
              Continuar
            </button>
            <button onClick={endStudyNow} disabled={busy}
              className="flex-1 rounded-2xl bg-white/10 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:opacity-50">
              Voltar ao trabalho
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ─── pecas auxiliares ─────────────────────────────────────────────────────────

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0d1b2a] p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-400 transition hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RulesPanel({ cfg, onChange }: { cfg: ExpedienteConfig; onChange: (p: Partial<ExpedienteConfig>) => void }) {
  const fields: { key: keyof ExpedienteConfig; label: string; hint: string }[] = [
    { key: 'workMin',     label: 'Trabalho',        hint: 'min por bloco' },
    { key: 'breakMin',    label: 'Pausa',           hint: 'min' },
    { key: 'studyMinMin', label: 'Estudo mínimo',   hint: 'funde abaixo disso' },
    { key: 'studyMaxMin', label: 'Estudo máximo',   hint: 'divide acima disso' },
    { key: 'continueSec', label: 'Resposta',        hint: 'seg para "continuar?"' },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 sm:grid-cols-5">
      {fields.map(f => (
        <div key={f.key}>
          <label className="mb-1 block text-[11px] font-medium text-slate-400">{f.label}</label>
          <input type="number" min={1} value={cfg[f.key] as number}
            onChange={e => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) onChange({ [f.key]: v } as Partial<ExpedienteConfig>);
            }}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-200 outline-none focus:border-cyan-500/50" />
          <p className="mt-1 text-[10px] text-slate-500">{f.hint}</p>
        </div>
      ))}
      <p className="col-span-2 text-[11px] text-slate-500 sm:col-span-5">
        Mudanças valem para o próximo período — o plano em andamento não é refeito.
      </p>
    </div>
  );
}

function PreviewCard({
  draft, setDraft, cfg, blocks, study, now, busy, onStart, onCancel, onAddCommitment,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  cfg: ExpedienteConfig;
  blocks: Block[];
  study: { lens: number[]; free: number };
  now: number;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
  onAddCommitment: (c: Commitment) => void;
}) {
  const total = study.lens.reduce((a, b) => a + b, 0);
  const ends  = blocks.length ? blocks[blocks.length - 1].endAt : draft.startAt;

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Confira o plano</h2>
          <p className="text-sm text-slate-400">
            {clock(draft.startAt)} → alvo {clock(draft.targetAt)} · {minutesLabel(study.free)} úteis
          </p>
        </div>
        <button onClick={onCancel} className="text-xs text-slate-400 transition hover:text-white">Cancelar</button>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between">
          <label className="text-xs font-medium text-slate-400">Proporção de estudo</label>
          <span className="text-sm font-semibold text-cyan-400">
            {draft.studyPct}% ·{' '}
            {total === 0
              ? 'sem estudo'
              : `${minutesLabel(total)} em ${study.lens.length} bloco${study.lens.length > 1 ? 's' : ''} de ${study.lens.join(' + ')} min`}
          </span>
        </div>
        <input type="range" min={0} max={100} value={draft.studyPct}
          onChange={e => setDraft({ ...draft, studyPct: Number(e.target.value) })}
          className="w-full accent-cyan-400" />
        {draft.studyPct > 0 && total === 0 && (
          <p className="mt-1 text-[11px] text-amber-400">
            Menos de {cfg.studyMinMin} min de estudo — muito curto para virar bloco. Aumente a proporção.
          </p>
        )}
      </div>

      {draft.commitments.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {draft.commitments.map(c => (
            <span key={c.id} className="flex items-center gap-2 rounded-xl border border-tamagochi-200/30 bg-tamagochi-200/10 px-3 py-1.5 text-xs text-tamagochi-200">
              {c.title} · {clock(c.startAt)}–{clock(c.endAt)}
              <button onClick={() => setDraft({ ...draft, commitments: draft.commitments.filter(x => x.id !== c.id) })}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4"><CommitmentForm onAdd={onAddCommitment} /></div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <Timeline blocks={blocks} now={now} />
        {blocks.length > 0 && ends < draft.targetAt && (
          <p className="mt-3 text-[11px] text-slate-500">
            Termina {clock(ends)} — os {Math.round((draft.targetAt - ends) / MS_MIN)} min que sobram não fecham um ciclo, então você sai antes.
          </p>
        )}
      </div>

      <button onClick={onStart} disabled={busy || blocks.length === 0}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-tamagochi-500 px-6 py-3 text-sm font-semibold text-slate-950 shadow-glow transition hover:bg-tamagochi-400 disabled:opacity-50">
        <Play size={18} /> Começar
      </button>
    </div>
  );
}
