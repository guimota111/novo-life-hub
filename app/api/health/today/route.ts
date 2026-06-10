import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

async function resolveUserId(token: string | null): Promise<string | null> {
  if (!token) return null;
  const snap = await adminDb
    .collection('health_tokens')
    .where('token', '==', token)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data().userId as string;
}

function getTodayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function POST(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    const userId = await resolveUserId(token);
    if (!userId) {
      return NextResponse.json({ error: token ? 'Token inválido' : 'Token ausente' }, { status: token ? 401 : 400 });
    }

    const body = await request.json();

    const parseNum = (v: unknown): number | undefined => {
      if (v == null) return undefined;
      const n = Number(String(v).replace(/,/g, '').replace(/[^\d.-]/g, ''));
      return isNaN(n) ? undefined : n;
    };

    const steps = parseNum(body.steps) != null ? Math.round(parseNum(body.steps)!) : undefined;

    let km: number | undefined;
    if (body.km != null) km = Math.round((parseNum(body.km) ?? 0) * 100) / 100;
    else if (body.mi != null) km = Math.round((parseNum(body.mi) ?? 0) * 1.60934 * 100) / 100;

    const fields: Record<string, number> = {};
    if (steps != null && steps >= 0) fields.steps = steps;
    if (km != null && km >= 0) fields.walking_distance_km = km;

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: 'Nenhum dado válido enviado' }, { status: 400 });
    }

    const today = getTodayStr();
    await adminDb
      .collection('users').doc(userId)
      .collection('daily_logs').doc(today)
      .set(fields, { merge: true });

    return NextResponse.json({ success: true, date: today, saved: fields });
  } catch (err) {
    console.error('[health/today POST] error:', err);
    return NextResponse.json({ error: 'Erro interno', detail: String(err) }, { status: 500 });
  }
}
