import { adminDb } from '@/lib/firebase-admin';
import { getTodaySP } from '@/lib/dates';

export { getTodaySP };

// ============================================================
//  Suporte ao Habit Tracker de bolso (M5StickC Plus2)
//  Resolve usuário por token e define as métricas do aparelho.
// ============================================================

export type MetricType = 'num' | 'bool';

export interface MetricDef {
  key: string;          // chave usada pelo aparelho
  field: string;        // campo no daily_logs
  type: MetricType;
  goalField: keyof typeof GOAL_DEFAULTS | null; // meta em settings/goals (null => meta = 1)
  readonly?: boolean;   // passos vêm do relógio: só exibe
}

export const GOAL_DEFAULTS = {
  water_ml: 4000,
  steps: 10000,
  reading_pages: 10,
  gym_days_per_week: 5,
  study_minutes: 120,
  meditation_minutes: 10,
};

// Ordem = ordem de navegação no aparelho.
export const METRICS: MetricDef[] = [
  { key: 'agua',     field: 'water_ml',      type: 'num',  goalField: 'water_ml' },
  { key: 'academia', field: 'gym_done',      type: 'bool', goalField: null },
  { key: 'creatina', field: 'creatine_done', type: 'bool', goalField: null },
  { key: 'estudo',    field: 'study_minutes',      type: 'num',  goalField: 'study_minutes' },
  { key: 'meditacao', field: 'meditation_minutes', type: 'num',  goalField: 'meditation_minutes' },
  { key: 'passos',    field: 'steps',              type: 'num',  goalField: 'steps', readonly: true },
  { key: 'leitura',   field: 'reading_pages',      type: 'num',  goalField: 'reading_pages' },
];

export function getMetric(key: string): MetricDef | undefined {
  return METRICS.find(m => m.key === key);
}

// Resolve o dono do token na coleção nfc_tokens (a mesma dos atalhos NFC).
export async function resolveUserByToken(token: string | null): Promise<string | null> {
  if (!token) return null;
  const snap = await adminDb
    .collection('nfc_tokens')
    .where('token', '==', token)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data().userId as string;
}

export async function loadGoals(uid: string): Promise<typeof GOAL_DEFAULTS> {
  const snap = await adminDb.collection('users').doc(uid).collection('settings').doc('goals').get();
  return { ...GOAL_DEFAULTS, ...(snap.exists ? snap.data() : {}) } as typeof GOAL_DEFAULTS;
}

// Monta { atual, meta, readonly } de uma métrica a partir do log e das metas.
export function buildMetric(m: MetricDef, log: Record<string, unknown>, goals: typeof GOAL_DEFAULTS) {
  if (m.type === 'bool') {
    return { atual: log[m.field] === true ? 1 : 0, meta: 1, readonly: false };
  }
  const atual = Number(log[m.field] ?? 0) || 0;
  const meta = m.goalField ? Number(goals[m.goalField] ?? 1) || 1 : 1;
  return { atual, meta, readonly: !!m.readonly };
}
