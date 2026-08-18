// Estado compartilhado do cronometro de estudo.
// O doc vive em users/{uid}/study_active/current e e escrito tanto pela pagina
// quanto pela API de atalhos (/api/study/timer), por isso o tempo e sempre
// derivado de timestamps — nada se perde se a aba fechar ou o celular dormir.

export interface ActiveTopic {
  name: string;
  atMs: number;          // tempo decorrido (ms) da sessao quando o topico entrou
}

export interface ActiveSession {
  status: 'running' | 'paused';
  startedAt: number;     // epoch ms
  pausedAt: number | null;
  pausedMs: number;      // soma das pausas ja encerradas
  areaId: string | null;
  subArea: string;
  topics: ActiveTopic[];
  notes?: string;
  updatedAt?: number;
}

// Teto de seguranca: se a sessao passar disso, provavelmente foi esquecida
// rodando. Nao para o cronometro, so alimenta o aviso na hora de finalizar.
export const MAX_SESSION_MINUTES = 360;

export function newSession(partial: Partial<ActiveSession> = {}): ActiveSession {
  return {
    status: 'running',
    startedAt: Date.now(),
    pausedAt: null,
    pausedMs: 0,
    areaId: null,
    subArea: '',
    topics: [],
    ...partial,
  };
}

// Tempo efetivo de estudo (ms), descontando as pausas.
export function elapsedMs(s: ActiveSession, now = Date.now()): number {
  const end = s.status === 'paused' && s.pausedAt ? s.pausedAt : now;
  return Math.max(0, end - s.startedAt - (s.pausedMs || 0));
}

export function elapsedMinutes(s: ActiveSession, now = Date.now()): number {
  return Math.round(elapsedMs(s, now) / 60_000);
}

export function pause(s: ActiveSession, now = Date.now()): ActiveSession {
  if (s.status === 'paused') return s;
  return { ...s, status: 'paused', pausedAt: now };
}

export function resume(s: ActiveSession, now = Date.now()): ActiveSession {
  if (s.status === 'running') return s;
  return {
    ...s,
    status: 'running',
    pausedMs: (s.pausedMs || 0) + (s.pausedAt ? now - s.pausedAt : 0),
    pausedAt: null,
  };
}

export function addTopic(s: ActiveSession, name: string, now = Date.now()): ActiveSession {
  const clean = name.trim();
  if (!clean) return s;
  return { ...s, topics: [...s.topics, { name: clean, atMs: elapsedMs(s, now) }] };
}

// Distribui o tempo entre os topicos: cada um vale do seu atMs ate o proximo
// (ou ate o fim da sessao, no caso do ultimo).
export function topicsWithMinutes(
  topics: ActiveTopic[],
  totalMs: number,
): { name: string; minutes: number }[] {
  return topics.map((t, i) => {
    const end = i + 1 < topics.length ? topics[i + 1].atMs : totalMs;
    return { name: t.name, minutes: Math.max(0, Math.round((end - t.atMs) / 60_000)) };
  });
}

export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// Data (AAAA-MM-DD, fuso de Sao Paulo) a que a sessao pertence — sempre a do
// inicio, para uma virada de meia-noite nao partir a sessao em dois dias.
export function sessionDate(startedAt: number): string {
  return new Date(startedAt).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}
