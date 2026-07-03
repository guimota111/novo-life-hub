import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import {
  getMetric, getTodaySP, resolveUserByToken, loadGoals,
} from '@/lib/device';

// POST /api/device/action?token=<device_token>
// Body: { "metric": "agua", "amount": 250 }
//   - num  : incrementa o campo por `amount` (aceita negativo; não passa de 0)
//   - bool : alterna feito/não-feito (ignora `amount`)
// Retorna o novo valor: { metric, atual, meta, date }
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const uid = await resolveUserByToken(token);
  if (!uid) {
    return NextResponse.json(
      { error: token ? 'Token inválido' : 'Token ausente' },
      { status: token ? 401 : 400 },
    );
  }

  let body: { metric?: string; amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const m = getMetric(body.metric ?? '');
  if (!m) return NextResponse.json({ error: 'Métrica desconhecida' }, { status: 400 });
  if (m.readonly) {
    return NextResponse.json({ error: `'${m.key}' é somente leitura` }, { status: 403 });
  }

  const today = getTodaySP();
  const ref = adminDb.collection('users').doc(uid).collection('daily_logs').doc(today);
  const snap = await ref.get();
  const log = (snap.exists ? snap.data() : {}) as Record<string, unknown>;

  let atual: number;
  let meta = 1;

  if (m.type === 'bool') {
    const novo = !(log[m.field] === true);
    await ref.set({ [m.field]: novo, updatedAt: new Date() }, { merge: true });
    atual = novo ? 1 : 0;
  } else {
    const amount = Number(body.amount ?? 0);
    if (!Number.isFinite(amount)) {
      return NextResponse.json({ error: 'amount inválido' }, { status: 400 });
    }
    const novo = Math.max(0, (Number(log[m.field] ?? 0) || 0) + amount);
    await ref.set({ [m.field]: novo, updatedAt: new Date() }, { merge: true });
    atual = novo;
    const goals = await loadGoals(uid);
    meta = m.goalField ? Number(goals[m.goalField] ?? 1) || 1 : 1;
  }

  return NextResponse.json({ metric: m.key, atual, meta, date: today });
}
