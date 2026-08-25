import { NextRequest, NextResponse } from 'next/server';
import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
  METRICS, MetricDef, GOAL_DEFAULTS, getTodaySP, resolveUserByToken, loadGoals,
} from '@/lib/device';

// GET /api/device/history?token=<device_token>
// Histórico agregado para o display CYD (visões de semana, mês e ano).
// O dia atual o firmware sobrepõe com o /summary, então esta resposta só
// muda na virada do dia — o aparelho busca isso no boot e quando o dia vira.

// Sem acentos: a fonte do display é ASCII puro.
const DOW_LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTH_LABELS = [
  'JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];

function isoAddDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
const isoDow = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

type Log = Record<string, unknown> | undefined;

function metricPct(m: MetricDef, log: Log, goals: typeof GOAL_DEFAULTS): number {
  if (!log) return 0;
  if (m.type === 'bool') return log[m.field] === true ? 100 : 0;
  const atual = Number(log[m.field] ?? 0) || 0;
  const meta = m.goalField ? Number(goals[m.goalField] ?? 1) || 1 : 1;
  return Math.min(100, Math.round((atual / meta) * 100));
}

// Quantos hábitos foram 100% cumpridos no dia (0..7).
const dayScore = (log: Log, goals: typeof GOAL_DEFAULTS) =>
  METRICS.filter(m => metricPct(m, log, goals) >= 100).length;

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const uid = await resolveUserByToken(token);
  if (!uid) {
    return NextResponse.json(
      { error: token ? 'Token inválido' : 'Token ausente' },
      { status: token ? 401 : 400 },
    );
  }

  const today = getTodaySP();
  const start = isoAddDays(today, -364);

  const [logsSnap, goals] = await Promise.all([
    adminDb.collection('users').doc(uid).collection('daily_logs')
      .where(FieldPath.documentId(), '>=', start)
      .where(FieldPath.documentId(), '<=', today)
      .get(),
    loadGoals(uid),
  ]);
  const logs = new Map<string, Record<string, unknown>>();
  logsSnap.forEach(doc => logs.set(doc.id, doc.data()));

  // Ano: 365 dias terminando hoje.
  const yearScore: number[] = [];
  for (let i = 364; i >= 0; i--) {
    yearScore.push(dayScore(logs.get(isoAddDays(today, -i)), goals));
  }

  // Semana: 7 dias terminando hoje, % de cada hábito por dia.
  const weekDates = Array.from({ length: 7 }, (_, i) => isoAddDays(today, i - 6));
  const weekPct: Record<string, number[]> = {};
  for (const m of METRICS) {
    weekPct[m.key] = weekDates.map(d => metricPct(m, logs.get(d), goals));
  }

  // Mês corrente: nota por dia (-1 = dia futuro).
  const monthStart = `${today.slice(0, 7)}-01`;
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const todayDay = Number(today.slice(8, 10));
  const monthScore = Array.from({ length: daysInMonth }, (_, i) =>
    i + 1 > todayDay ? -1 : dayScore(logs.get(isoAddDays(monthStart, i)), goals),
  );

  return NextResponse.json({
    today,
    week: { labels: weekDates.map(d => DOW_LETTERS[isoDow(d)]), pct: weekPct },
    month: {
      label: MONTH_LABELS[month - 1],
      days: daysInMonth,
      firstDow: isoDow(monthStart),
      score: monthScore,
    },
    year: { start, startDow: isoDow(start), score: yearScore },
  });
}
