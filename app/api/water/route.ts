import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { resolveUserByToken, getTodaySP } from '@/lib/device';

// POST /api/water?token=<token>   body: { ml: number }
// (o token tambem pode vir no corpo). Incrementa a agua de hoje do dono do token.
// Autenticacao pela colecao nfc_tokens — o mesmo esquema dos atalhos NFC de
// creatina/academia e do aparelho de bolso. (Antes havia um segredo hardcoded.)
export async function POST(request: NextRequest) {
  let body: { token?: string; ml?: number };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const token = request.nextUrl.searchParams.get('token') ?? body.token ?? null;
  const uid = await resolveUserByToken(token);
  if (!uid) {
    return NextResponse.json(
      { error: token ? 'Token inválido' : 'Token ausente' },
      { status: token ? 401 : 400 },
    );
  }

  if (typeof body.ml !== 'number' || !Number.isFinite(body.ml)) {
    return NextResponse.json({ error: 'Envie a quantidade em ml (número)' }, { status: 400 });
  }

  const today = getTodaySP();
  await adminDb
    .collection('users').doc(uid)
    .collection('daily_logs').doc(today)
    .set({
      water_ml: admin.firestore.FieldValue.increment(body.ml),
      updatedAt: new Date(),
    }, { merge: true });

  return NextResponse.json({
    success: true,
    date: today,
    added: body.ml,
    message: `${body.ml}ml adicionados para ${today}`,
  });
}
