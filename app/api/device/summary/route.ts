import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  METRICS, getTodaySP, resolveUserByToken, loadGoals, buildMetric,
} from '@/lib/device';

// GET /api/device/summary?token=<device_token>
// Retorna as métricas de hoje (atual/meta) para o Habit Tracker de bolso.
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
  const [logSnap, goals] = await Promise.all([
    adminDb.collection('users').doc(uid).collection('daily_logs').doc(today).get(),
    loadGoals(uid),
  ]);
  const log = (logSnap.exists ? logSnap.data() : {}) as Record<string, unknown>;

  const metrics: Record<string, ReturnType<typeof buildMetric>> = {};
  for (const m of METRICS) metrics[m.key] = buildMetric(m, log, goals);

  return NextResponse.json({ date: today, metrics });
}
