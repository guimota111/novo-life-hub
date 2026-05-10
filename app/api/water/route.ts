import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';

// Senha secreta para impedir que outras pessoas mandem requisições para o seu site
const SECRET_TOKEN = "NFC_TAMAGOCHI_2026_SECRET";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { token, uid, ml } = body;

    // Verifica a segurança
    if (!token || token !== SECRET_TOKEN) {
      return NextResponse.json({ error: 'Acesso negado: Token de automação inválido' }, { status: 401 });
    }

    // Verifica se os dados mínimos foram enviados
    if (!uid || typeof ml !== 'number') {
      return NextResponse.json({ error: 'Dados inválidos. Envie o uid e a quantidade em ml (número)' }, { status: 400 });
    }

    // Calcula a data de hoje garantindo o fuso horário do Brasil (America/Sao_Paulo)
    // O servidor do Google Cloud roda em UTC, o que fazia a água ser salva no "dia de amanhã" durante a noite.
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    // Acessa o banco de dados como administrador (pula as regras normais do Firestore)
    const logRef = adminDb.collection('users').doc(uid).collection('daily_logs').doc(todayStr);

    // Incrementa a água
    await logRef.set({
      water_ml: admin.firestore.FieldValue.increment(ml),
      updatedAt: new Date()
    }, { merge: true });

    return NextResponse.json({ 
      success: true, 
      message: `${ml}ml adicionados com sucesso via NFC para o dia ${todayStr}!` 
    }, { status: 200 });

  } catch (error: any) {
    console.error('Erro na API de hidratação NFC:', error);
    return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 });
  }
}
