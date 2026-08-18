import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { resolveUserByToken } from '@/lib/device';
import {
  ActiveSession, newSession, elapsedMs, elapsedMinutes,
  pause, resume, topicsWithMinutes, sessionDate,
} from '@/lib/studyTimer';

// /api/study/timer?token=<nfc_token>&action=start|pause|resume|stop
//
// Feito para os Atalhos do iPhone: aceita GET (URL simples, sem corpo) e POST
// (acao tambem pode vir no JSON). Mesmo token dos demais atalhos — colecao
// nfc_tokens, com { token, userId }.
//
// - start  : comeca uma sessao. Sem area/subarea: da para completar depois na
//            pagina de estudo (a sessao fica marcada como "aguardando revisao"
//            se for encerrada assim).
// - pause  : congela o cronometro.
// - resume : volta a contar.
// - stop   : encerra, grava em study_sessions e soma em daily_logs.
//
// Sempre responde { ok, status, minutos, mensagem } — "mensagem" ja vem pronta
// para exibir em notificacao do Atalho.

export const dynamic = 'force-dynamic';

type Action = 'start' | 'pause' | 'resume' | 'stop';
const ACTIONS: Action[] = ['start', 'pause', 'resume', 'stop'];

function activeRef(uid: string) {
  return adminDb.collection('users').doc(uid).collection('study_active').doc('current');
}

async function loadActive(uid: string): Promise<ActiveSession | null> {
  const snap = await activeRef(uid).get();
  return snap.exists ? (snap.data() as ActiveSession) : null;
}

function reply(session: ActiveSession | null, mensagem: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({
    ok: true,
    status: session ? session.status : 'idle',
    minutos: session ? elapsedMinutes(session) : 0,
    mensagem,
    ...extra,
  });
}

async function handle(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const uid = await resolveUserByToken(token);
  if (!uid) {
    return NextResponse.json(
      { ok: false, error: token ? 'Token inválido' : 'Token ausente' },
      { status: token ? 401 : 400 },
    );
  }

  let body: { action?: string; areaId?: string; subArea?: string } = {};
  if (request.method === 'POST') {
    try { body = await request.json(); } catch { /* corpo vazio e valido */ }
  }

  const raw = (request.nextUrl.searchParams.get('action') ?? body.action ?? '').toLowerCase();
  if (!ACTIONS.includes(raw as Action)) {
    return NextResponse.json(
      { ok: false, error: `Ação inválida. Use: ${ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }
  const action = raw as Action;
  const active = await loadActive(uid);
  const now = Date.now();

  if (action === 'start') {
    if (active) {
      // Nao reinicia por engano: so devolve o estado atual.
      return reply(active, `Sessão já em andamento — ${elapsedMinutes(active, now)} min.`);
    }
    const session = newSession({
      startedAt: now,
      areaId: body.areaId ?? null,
      subArea: body.subArea ?? '',
    });
    await activeRef(uid).set({ ...session, updatedAt: now });
    return reply(session, 'Estudo iniciado.');
  }

  if (!active) {
    return NextResponse.json(
      { ok: false, status: 'idle', error: 'Nenhuma sessão em andamento.' },
      { status: 409 },
    );
  }

  if (action === 'pause') {
    if (active.status === 'paused') {
      return reply(active, `Sessão já estava pausada — ${elapsedMinutes(active, now)} min.`);
    }
    const updated = pause(active, now);
    await activeRef(uid).set({ ...updated, updatedAt: now });
    return reply(updated, `Estudo pausado em ${elapsedMinutes(updated, now)} min.`);
  }

  if (action === 'resume') {
    if (active.status === 'running') {
      return reply(active, `Sessão já estava rodando — ${elapsedMinutes(active, now)} min.`);
    }
    const updated = resume(active, now);
    await activeRef(uid).set({ ...updated, updatedAt: now });
    return reply(updated, `Estudo retomado — ${elapsedMinutes(updated, now)} min até agora.`);
  }

  // stop
  const totalMs = elapsedMs(active, now);
  const minutes = Math.round(totalMs / 60_000);
  const topics = topicsWithMinutes(active.topics ?? [], totalMs);
  const date = sessionDate(active.startedAt);

  if (minutes < 1) {
    // Sessao de menos de um minuto: descarta em vez de sujar o historico.
    await activeRef(uid).delete();
    return reply(null, 'Sessão descartada (menos de 1 minuto).');
  }

  // Sem area definida, a sessao fica marcada para voce completar na pagina.
  const needsReview = !active.areaId;

  await adminDb.collection('users').doc(uid).collection('study_sessions').add({
    areaId: active.areaId ?? '',
    subArea: active.subArea ?? '',
    topic: topics.map(t => t.name).join(' · '),
    topics,
    date,
    durationMinutes: minutes,
    notes: active.notes ?? null,
    startedAt: active.startedAt,
    endedAt: now,
    source: 'timer',
    needsReview,
    createdAt: new Date(),
  });

  await adminDb.collection('users').doc(uid).collection('daily_logs').doc(date).set(
    { study_minutes: FieldValue.increment(minutes), updatedAt: new Date() },
    { merge: true },
  );

  await activeRef(uid).delete();

  return reply(null, needsReview
    ? `Estudo encerrado: ${minutes} min. Falta definir a área na página de estudo.`
    : `Estudo encerrado: ${minutes} min.`,
  { minutos: minutes, precisaRevisao: needsReview });
}

export async function GET(request: NextRequest)  { return handle(request); }
export async function POST(request: NextRequest) { return handle(request); }
