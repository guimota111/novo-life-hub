// Domínio de treino de academia: tipos do Firestore, chaves, grupo muscular,
// estatísticas (PR, 1RM, conclusão) e a leitura/escrita das coleções.
//
// Coleções (todas em users/{uid}/):
//   exercises/{key}               catálogo — grupo muscular editável pelo usuário
//   workout_templates/{key}       fichas (vêm da seção FICHAS do SmartGym)
//   workout_sessions/{date_key}   treinos feitos — prescrito × realizado por exercício
//
// Regra de reconciliação: o id da sessão é data + ficha. Uma importação do TXT
// sobrescreve a sessão inteira (o SmartGym é a fonte de verdade); o que o TXT
// não trouxer fica como está.

import {
  collection, doc, getDocs, setDoc, writeBatch, query, orderBy, type Firestore,
} from 'firebase/firestore';
import type { ParsedExport, ParsedWorkout, SetGroup } from './smartgym';

export type { SetGroup } from './smartgym';

// ── Tipos ────────────────────────────────────────────────────────────────────

export type MuscleGroup = 'peito' | 'costas' | 'pernas' | 'ombro' | 'biceps' | 'triceps' | 'core' | 'outro';

export const MUSCLE_GROUPS: { id: MuscleGroup; label: string; color: string; chip: string }[] = [
  { id: 'peito',   label: 'Peito',   color: 'text-rose-400',    chip: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
  { id: 'costas',  label: 'Costas',  color: 'text-sky-400',     chip: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  { id: 'pernas',  label: 'Pernas',  color: 'text-emerald-400', chip: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  { id: 'ombro',   label: 'Ombro',   color: 'text-amber-400',   chip: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  { id: 'biceps',  label: 'Bíceps',  color: 'text-violet-400',  chip: 'border-violet-500/30 bg-violet-500/10 text-violet-300' },
  { id: 'triceps', label: 'Tríceps', color: 'text-fuchsia-400', chip: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300' },
  { id: 'core',    label: 'Core',    color: 'text-teal-400',    chip: 'border-teal-500/30 bg-teal-500/10 text-teal-300' },
  { id: 'outro',   label: 'Outro',   color: 'text-slate-400',   chip: 'border-white/10 bg-white/5 text-slate-300' },
];

export const muscleGroupMeta = (id: MuscleGroup) =>
  MUSCLE_GROUPS.find(g => g.id === id) ?? MUSCLE_GROUPS[MUSCLE_GROUPS.length - 1];

export interface ExerciseDoc {
  key: string;
  name: string;
  muscleGroup: MuscleGroup;
  isBodyweight: boolean;
  updatedAt: Date | null;
}

export interface TemplateExercise {
  key: string;
  name: string;
  sets: SetGroup[];
}

export interface WorkoutTemplateDoc {
  key: string;
  name: string;
  frequency: string;
  objective: string;
  notes: string;
  exercises: TemplateExercise[];
  archived: boolean;
  updatedAt: Date | null;
}

export interface SessionExercise {
  key: string;
  name: string;
  prescribed: SetGroup[];
  performed: SetGroup[];     // vazio = pulado
}

export interface WorkoutSessionDoc {
  id: string;                // `${date}_${templateKey}`
  date: string;              // AAAA-MM-DD
  templateKey: string;
  templateName: string;
  objective: string;
  source: 'import' | 'manual';
  exercises: SessionExercise[];
  setsDone: number;
  setsPrescribed: number;
  completion: number;        // 0..1
  updatedAt: Date | null;
}

// ── Chaves ───────────────────────────────────────────────────────────────────

export const slugKey = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const sessionId = (date: string, templateKey: string) => `${date}_${templateKey}`;

// ── Grupo muscular (inferido pelo nome; o usuário corrige no catálogo) ───────

const RULES: [RegExp, MuscleGroup][] = [
  [/triceps|coice|frances/,                                            'triceps'],
  [/rosca/,                                                            'biceps'],
  [/escapula/,                                                         'costas'],
  [/desenvolvimento|elevacao|arnold|remada alta|crucifixo invertido/,  'ombro'],
  [/supino|crucifixo|voador|peck|pullover|ao redor do mundo/,           'peito'],
  [/puxada|remada|pulldown|rack pull/,                                 'costas'],
  [/agachamento|leg press|extensora|flexora|extensao de perna|flexao plantar|panturrilha|stiff|terra|afundo|passada|bom dia|ponte/, 'pernas'],
  [/abdominal|prancha|russian|pallof|windmill|bird dog|hiperextensao/,  'core'],
];

export function inferMuscleGroup(name: string): MuscleGroup {
  const n = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  for (const [re, group] of RULES) if (re.test(n)) return group;
  return 'outro';
}

// Peso corporal = nenhuma linha de série trazia "kg" (diferente de "0kg", que é
// carga não registrada).
export const looksBodyweight = (sets: SetGroup[]) => sets.length > 0 && sets.every(s => s.weight === null);

// ── Estatísticas ─────────────────────────────────────────────────────────────

export const emptyGroup = (): SetGroup => ({ sets: 1, reps: null, weight: null, durationSec: null, restSec: null });
export const totalSets = (groups: SetGroup[]) => groups.reduce((n, g) => n + (g.sets > 0 ? g.sets : 0), 0);
export const maxWeight = (groups: SetGroup[]) => groups.reduce((m, g) => (g.weight && g.weight > m ? g.weight : m), 0);
export const maxReps   = (groups: SetGroup[]) => groups.reduce((m, g) => (g.reps && g.reps > m ? g.reps : m), 0);

// Epley: 1RM ≈ w × (1 + reps/30)
export const epley = (w: number, reps: number) => (reps <= 1 ? w : w * (1 + reps / 30));

export const bestE1rm = (groups: SetGroup[]) =>
  groups.reduce((m, g) => (g.weight && g.weight > 0 && g.reps ? Math.max(m, epley(g.weight, g.reps)) : m), 0);

// reps feitas na série mais pesada (pra mostrar "85 kg × 8")
export function repsAtMaxWeight(groups: SetGroup[]): number {
  const w = maxWeight(groups);
  return groups.filter(g => g.weight === w).reduce((m, g) => Math.max(m, g.reps ?? 0), 0);
}

export function sessionCompletion(exercises: SessionExercise[]) {
  let setsDone = 0, setsPrescribed = 0;
  for (const ex of exercises) {
    const done = totalSets(ex.performed);
    const presc = totalSets(ex.prescribed) || done;
    setsDone += Math.min(done, presc);
    setsPrescribed += presc;
  }
  const completion = setsPrescribed > 0 ? setsDone / setsPrescribed : 0;
  return { setsDone, setsPrescribed, completion };
}

export const fmtKg = (w: number) => `${Number.isInteger(w) ? w : w.toFixed(1).replace('.', ',')} kg`;

export const fmtGroup = (g: SetGroup) => {
  const reps = g.reps != null ? `${g.reps}` : g.durationSec ? `${g.durationSec}s` : '?';
  return `${g.sets}×${reps}${g.weight ? ` · ${fmtKg(g.weight)}` : ''}`;
};

export const fmtGroups = (groups: SetGroup[]) => groups.map(fmtGroup).join('  ');

const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// "2026-09-09" → "9 set" (ou "9 set 2026")
export function fmtDatePt(iso: string, withYear = false): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_SHORT[(m || 1) - 1]}${withYear ? ` ${y}` : ''}`;
}

export interface ExercisePoint {
  date: string;
  sessionId: string;
  templateName: string;
  weight: number;      // maior carga da sessão (0 se sem carga)
  reps: number;        // reps na série mais pesada (ou maior reps, se sem carga)
  e1rm: number;
  performed: SetGroup[];
}

// Histórico de um exercício ao longo das sessões (só onde foi feito), em ordem cronológica
export function exerciseHistory(sessions: WorkoutSessionDoc[], key: string): ExercisePoint[] {
  const pts: ExercisePoint[] = [];
  for (const s of sessions) {
    const ex = s.exercises.find(e => e.key === key);
    if (!ex || ex.performed.length === 0) continue;
    const weight = maxWeight(ex.performed);
    pts.push({
      date: s.date, sessionId: s.id, templateName: s.templateName,
      weight, reps: weight > 0 ? repsAtMaxWeight(ex.performed) : maxReps(ex.performed),
      e1rm: bestE1rm(ex.performed), performed: ex.performed,
    });
  }
  return pts.sort((a, b) => a.date.localeCompare(b.date));
}

export interface ExercisePR {
  key: string;
  weight: number; reps: number; date: string;   // recorde de carga
  e1rm: number; e1rmDate: string;               // melhor 1RM estimado
  sessions: number; lastDate: string;
}

export function computePRs(sessions: WorkoutSessionDoc[]): Map<string, ExercisePR> {
  const out = new Map<string, ExercisePR>();
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const ex of s.exercises) {
      if (ex.performed.length === 0) continue;
      const w = maxWeight(ex.performed);
      const e1 = bestE1rm(ex.performed);
      const cur = out.get(ex.key) ?? { key: ex.key, weight: 0, reps: 0, date: '', e1rm: 0, e1rmDate: '', sessions: 0, lastDate: '' };
      cur.sessions++;
      cur.lastDate = s.date;
      if (w > cur.weight) { cur.weight = w; cur.reps = repsAtMaxWeight(ex.performed); cur.date = s.date; }
      if (e1 > cur.e1rm) { cur.e1rm = e1; cur.e1rmDate = s.date; }
      out.set(ex.key, cur);
    }
  }
  return out;
}

export interface PREvent { date: string; key: string; name: string; weight: number; prev: number }

// Sessões em que a carga máxima de um exercício superou tudo que veio antes
export function prEvents(sessions: WorkoutSessionDoc[]): PREvent[] {
  const best = new Map<string, number>();
  const events: PREvent[] = [];
  for (const s of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const ex of s.exercises) {
      const w = maxWeight(ex.performed);
      if (w <= 0) continue;
      const prev = best.get(ex.key) ?? 0;
      if (w > prev) {
        if (prev > 0) events.push({ date: s.date, key: ex.key, name: ex.name, weight: w, prev });
        best.set(ex.key, w);
      }
    }
  }
  return events.sort((a, b) => b.date.localeCompare(a.date));
}

// ── Plano de importação ──────────────────────────────────────────────────────

export interface WorkoutData {
  templates: WorkoutTemplateDoc[];
  exercises: ExerciseDoc[];
  sessions: WorkoutSessionDoc[];
}

export interface ImportPlan {
  templates: WorkoutTemplateDoc[];
  sessions: WorkoutSessionDoc[];
  newExercises: ExerciseDoc[];
  summary: {
    templates: number;
    sessionsNew: number;
    sessionsUpdated: number;
    exercisesNew: number;
    firstDate: string | null;
    lastDate: string | null;
  };
}

const templateFromParsed = (w: ParsedWorkout, existing?: WorkoutTemplateDoc): WorkoutTemplateDoc => ({
  key: slugKey(w.name),
  name: w.name,
  frequency: w.frequency,
  objective: w.objective,
  notes: w.notes,
  exercises: w.exercises.filter(e => !e.cardio).map(e => ({ key: slugKey(e.name), name: e.name, sets: e.sets })),
  archived: existing?.archived ?? false,
  updatedAt: new Date(),
});

export function buildImportPlan(parsed: ParsedExport, existing: WorkoutData): ImportPlan {
  const existingTemplates = new Map(existing.templates.map(t => [t.key, t]));
  const existingSessions = new Set(existing.sessions.map(s => s.id));
  const existingExercises = new Set(existing.exercises.map(e => e.key));

  const templates = parsed.templates.map(w => templateFromParsed(w, existingTemplates.get(slugKey(w.name))));
  const importTemplates = new Map(templates.map(t => [t.key, t]));

  // Prescrição de um exercício pulado no histórico não vem no arquivo. Ordem de
  // resolução: ficha desta importação → ficha já salva → maior nº de séries
  // que esse exercício teve nessa ficha em qualquer sessão → 3.
  const proxy = new Map<string, number>();
  for (const s of parsed.sessions) {
    const tk = slugKey(s.name);
    for (const e of s.exercises) {
      if (e.cardio) continue;
      const k = `${tk}|${slugKey(e.name)}`;
      proxy.set(k, Math.max(proxy.get(k) ?? 0, totalSets(e.sets)));
    }
  }
  const resolvePrescribed = (tk: string, ek: string, performed: SetGroup[]): SetGroup[] => {
    const fromImport = importTemplates.get(tk)?.exercises.find(e => e.key === ek)?.sets;
    if (fromImport?.length) return fromImport;
    const fromDb = existingTemplates.get(tk)?.exercises.find(e => e.key === ek)?.sets;
    if (fromDb?.length) return fromDb;
    const n = proxy.get(`${tk}|${ek}`) || totalSets(performed) || 3;
    return [{ ...emptyGroup(), sets: n }];
  };

  const sessions: WorkoutSessionDoc[] = parsed.sessions.map(s => {
    const tk = slugKey(s.name);
    const exercises: SessionExercise[] = s.exercises.filter(e => !e.cardio).map(e => {
      const ek = slugKey(e.name);
      return { key: ek, name: e.name, prescribed: resolvePrescribed(tk, ek, e.sets), performed: e.sets };
    });
    const stats = sessionCompletion(exercises);
    return {
      id: sessionId(s.date, tk), date: s.date, templateKey: tk, templateName: s.name,
      objective: s.objective, source: 'import', exercises, ...stats, updatedAt: new Date(),
    };
  });

  // Catálogo: só cria o que não existe — grupo muscular editado pelo usuário não é sobrescrito
  const seen = new Map<string, { name: string; sets: SetGroup[][] }>();
  const collect = (name: string, sets: SetGroup[]) => {
    const k = slugKey(name);
    const cur = seen.get(k) ?? { name, sets: [] };
    if (sets.length) cur.sets.push(sets);
    seen.set(k, cur);
  };
  for (const t of parsed.templates) for (const e of t.exercises) if (!e.cardio) collect(e.name, e.sets);
  for (const s of parsed.sessions) for (const e of s.exercises) if (!e.cardio) collect(e.name, e.sets);

  const newExercises: ExerciseDoc[] = [];
  for (const [key, { name, sets }] of seen) {
    if (existingExercises.has(key)) continue;
    newExercises.push({
      key, name,
      muscleGroup: inferMuscleGroup(name),
      isBodyweight: sets.length > 0 && sets.every(looksBodyweight),
      updatedAt: new Date(),
    });
  }

  const dates = sessions.map(s => s.date).sort();
  return {
    templates, sessions, newExercises,
    summary: {
      templates: templates.length,
      sessionsNew: sessions.filter(s => !existingSessions.has(s.id)).length,
      sessionsUpdated: sessions.filter(s => existingSessions.has(s.id)).length,
      exercisesNew: newExercises.length,
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
    },
  };
}

// ── Firestore ────────────────────────────────────────────────────────────────

const col = (db: Firestore, uid: string, name: string) => collection(db, 'users', uid, name);

export async function loadWorkoutData(db: Firestore, uid: string): Promise<WorkoutData> {
  const [t, e, s] = await Promise.all([
    getDocs(col(db, uid, 'workout_templates')),
    getDocs(col(db, uid, 'exercises')),
    getDocs(query(col(db, uid, 'workout_sessions'), orderBy('date', 'desc'))),
  ]);
  return {
    templates: t.docs.map(d => d.data() as WorkoutTemplateDoc),
    exercises: e.docs.map(d => d.data() as ExerciseDoc),
    sessions: s.docs.map(d => d.data() as WorkoutSessionDoc),
  };
}

type Batch = ReturnType<typeof writeBatch>;
type BatchOp = (b: Batch) => void;

// Lotes de até 400 operações (limite do Firestore é 500)
async function commitInChunks(db: Firestore, ops: BatchOp[]) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(op => op(batch));
    await batch.commit();
  }
}

const gymDoneOp = (db: Firestore, uid: string, date: string): BatchOp => b =>
  b.set(doc(db, 'users', uid, 'daily_logs', date), { gym_done: true, updatedAt: new Date() }, { merge: true });

export async function writeImportPlan(db: Firestore, uid: string, plan: ImportPlan): Promise<void> {
  const ops: BatchOp[] = [];
  for (const t of plan.templates) {
    // merge preserva `archived` e qualquer campo que o usuário tenha mexido
    const { archived: _archived, ...rest } = t;
    ops.push(b => b.set(doc(db, 'users', uid, 'workout_templates', t.key), rest, { merge: true }));
  }
  for (const e of plan.newExercises) ops.push(b => b.set(doc(db, 'users', uid, 'exercises', e.key), e));
  const dates = new Set<string>();
  for (const s of plan.sessions) {
    ops.push(b => b.set(doc(db, 'users', uid, 'workout_sessions', s.id), s)); // TXT sobrescreve
    dates.add(s.date);
  }
  for (const d of dates) ops.push(gymDoneOp(db, uid, d));
  await commitInChunks(db, ops);
}

export async function saveSession(db: Firestore, uid: string, session: WorkoutSessionDoc): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'workout_sessions', session.id), session);
  gymDoneOp(db, uid, session.date)(batch);
  await batch.commit();
}

export async function updateExerciseGroup(db: Firestore, uid: string, key: string, muscleGroup: MuscleGroup) {
  await setDoc(doc(db, 'users', uid, 'exercises', key), { muscleGroup, updatedAt: new Date() }, { merge: true });
}

export async function setTemplateArchived(db: Firestore, uid: string, key: string, archived: boolean) {
  await setDoc(doc(db, 'users', uid, 'workout_templates', key), { archived, updatedAt: new Date() }, { merge: true });
}
