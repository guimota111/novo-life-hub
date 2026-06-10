import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// GET /api/gym/toggle?token=<nfc_token>
// Marks today's gym_done = true for the user who owns the token.
// Same token system as /api/creatina/toggle — add a doc to nfc_tokens with { token, userId }.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Token ausente' }, { status: 400 });
  }

  const tokenSnap = await adminDb
    .collection('nfc_tokens')
    .where('token', '==', token)
    .limit(1)
    .get();

  if (tokenSnap.empty) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  const userId = tokenSnap.docs[0].data().userId as string;

  // Today in São Paulo timezone (UTC-3)
  const now = new Date();
  const spOffset = -3 * 60;
  const localMs = now.getTime() + (now.getTimezoneOffset() + spOffset) * 60000;
  const local = new Date(localMs);
  const today = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;

  const docRef = adminDb.collection('users').doc(userId).collection('daily_logs').doc(today);
  const existing = await docRef.get();

  if (existing.exists && existing.data()?.gym_done === true) {
    return NextResponse.json({ gym_done: true, date: today, message: '✅ Treino já registrado hoje!' });
  }

  await docRef.set({ gym_done: true }, { merge: true });
  return NextResponse.json({ gym_done: true, date: today, message: '✅ Treino registrado!' });
}
