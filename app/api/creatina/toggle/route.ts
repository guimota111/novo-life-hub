import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

// Called by the iPhone NFC Shortcut:
// GET /api/creatina/toggle?token=<nfc_token>
// Toggles today's creatina entry for the user who owns the token.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Token ausente' }, { status: 400 });
  }

  // Find user by token
  const tokenSnap = await adminDb
    .collection('nfc_tokens')
    .where('token', '==', token)
    .limit(1)
    .get();

  if (tokenSnap.empty) {
    return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
  }

  const userId = tokenSnap.docs[0].data().userId as string;

  // Today's date in São Paulo timezone (UTC-3)
  const now = new Date();
  const spOffset = -3 * 60;
  const localMs = now.getTime() + (now.getTimezoneOffset() + spOffset) * 60000;
  const local = new Date(localMs);
  const today = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;

  const docRef = adminDb.collection('users').doc(userId).collection('daily_logs').doc(today);
  const existing = await docRef.get();

  if (existing.exists && existing.data()?.creatine_done === true) {
    return NextResponse.json({ taken: true, date: today, message: '✅ Já registrada hoje!' });
  }

  await docRef.set({ creatine_done: true }, { merge: true });
  return NextResponse.json({ taken: true, date: today, message: '✅ Creatina registrada!' });
}
