import { NextResponse } from 'next/server';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export async function POST(request: Request) {
  try {
    const { userId, payload } = await request.json();
    if (!userId || !payload) {
      return NextResponse.json({ error: 'userId and payload are required' }, { status: 400 });
    }

    const healthCollection = collection(db, 'health_logs');
    const batchPromises = (payload.data || []).map(async (entry: any, index: number) => {
      const docRef = doc(healthCollection, `${userId}-${Date.now()}-${index}`);
      return setDoc(docRef, {
        userId,
        type: entry.type || 'health',
        value: entry.value ?? null,
        unit: entry.unit ?? null,
        startDate: entry.startDate ?? null,
        endDate: entry.endDate ?? null,
        createdAt: serverTimestamp(),
      });
    });

    await Promise.all(batchPromises);

    return NextResponse.json({ success: true, message: 'Dados de Health upload enviados' });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 });
  }
}
