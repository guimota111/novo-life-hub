// Gerador e modelo do Expediente.
//
// A ideia da pagina: voce marca a chegada e uma hora alvo, e o app fatia esse
// intervalo em pomodoros de trabalho com uma JANELA DE ESTUDO no meio — o
// objetivo real e garantir que o estudo aconteca dentro do expediente.
//
// Tudo aqui e funcao pura sobre timestamps (epoch ms). O estado vive num doc do
// Firestore e o tempo e sempre derivado dos timestamps dos blocos, entao fechar
// a aba, dormir o computador ou trocar de aparelho nao perde nada.

export type BlockType = 'work' | 'break' | 'study' | 'commitment';

export interface Commitment {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
}

export interface Block {
  id: string;
  type: BlockType;
  title: string | null;      // so para compromissos
  startAt: number;
  endAt: number;
  confirmedAt: number | null;
  areaId: string | null;     // so para estudo
  subArea: string;
}

export interface ExpedienteConfig {
  workMin: number;      // duracao do pomodoro de trabalho
  breakMin: number;     // pausa entre blocos
  studyMinMin: number;  // estudo menor que isso se funde com outro
  studyMaxMin: number;  // estudo maior que isso vira mais de um bloco
  continueSec: number;  // tempo de resposta do aviso "continuar estudando?"
  sound: boolean;
  push: boolean;
}

export const DEFAULT_CONFIG: ExpedienteConfig = {
  workMin: 50,
  breakMin: 5,
  studyMinMin: 15,
  studyMaxMin: 50,
  continueSec: 30,
  sound: true,
  push: true,
};

export interface Expediente {
  date: string;
  status: 'running' | 'done';
  startedAt: number;
  targetAt: number;
  studyPct: number;
  config: ExpedienteConfig;
  commitments: Commitment[];
  blocks: Block[];
  studyBlockId: string | null;  // bloco dono da sessao em study_active/current
  endedAt: number | null;
  updatedAt: number;
}

export const MS_MIN = 60_000;

export const BLOCK_LABEL: Record<BlockType, string> = {
  work: 'Trabalho',
  break: 'Pausa',
  study: 'Estudo',
  commitment: 'Compromisso',
};

// ─── compromissos ─────────────────────────────────────────────────────────────

// Recorta ao intervalo do periodo, ordena e funde sobreposicoes, para o calculo
// de tempo livre nao contar o mesmo minuto duas vezes.
function mergedBusy(commitments: Commitment[], startAt: number, targetAt: number) {
  const clipped = commitments
    .map(c => ({ startAt: Math.max(c.startAt, startAt), endAt: Math.min(c.endAt, targetAt) }))
    .filter(c => c.endAt > c.startAt)
    .sort((a, b) => a.startAt - b.startAt);

  const out: { startAt: number; endAt: number }[] = [];
  for (const c of clipped) {
    const last = out[out.length - 1];
    if (last && c.startAt <= last.endAt) last.endAt = Math.max(last.endAt, c.endAt);
    else out.push({ ...c });
  }
  return out;
}

// Ninguem esta em duas reunioes ao mesmo tempo: se voce cadastrar horarios que
// se cruzam, o segundo comeca quando o primeiro acaba (e some, se ficar vazio).
export function normalizeCommitments(commitments: Commitment[]): Commitment[] {
  const out: Commitment[] = [];
  for (const c of [...commitments].sort((a, b) => a.startAt - b.startAt)) {
    const prevEnd = out.length ? out[out.length - 1].endAt : -Infinity;
    const startAt = Math.max(c.startAt, prevEnd);
    if (c.endAt > startAt) out.push({ ...c, startAt });
  }
  return out;
}

export function freeMinutes(startAt: number, targetAt: number, commitments: Commitment[]): number {
  const busy = mergedBusy(commitments, startAt, targetAt)
    .reduce((acc, c) => acc + (c.endAt - c.startAt), 0);
  return Math.max(0, Math.floor((targetAt - startAt - busy) / MS_MIN));
}

// ─── divisao do estudo ────────────────────────────────────────────────────────

// Quebra o total de estudo em blocos entre studyMinMin e studyMaxMin.
// A regra de fusao vive aqui: se dividir gerar pedaco menor que o minimo,
// usa-se um bloco a menos ate todos ficarem cheios o bastante.
export function splitStudy(totalMin: number, cfg: ExpedienteConfig): number[] {
  if (totalMin < cfg.studyMinMin) return [];
  let n = Math.ceil(totalMin / cfg.studyMaxMin);
  while (n > 1 && Math.floor(totalMin / n) < cfg.studyMinMin) n--;
  const base = Math.floor(totalMin / n);
  const rest = totalMin - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

// Quanto a janela ocupa no relogio: os blocos mais as pausas entre eles.
function windowMinutes(lens: number[], cfg: ExpedienteConfig): number {
  if (lens.length === 0) return 0;
  return lens.reduce((a, b) => a + b, 0) + (lens.length - 1) * cfg.breakMin;
}

// Minutos de estudo pedidos pelo slider, encolhidos ate a janela caber no
// periodo (com 100% e um periodo curto, as pausas internas estourariam).
export function studyLengths(freeMin: number, studyPct: number, cfg: ExpedienteConfig): number[] {
  let total = Math.round((freeMin * studyPct) / 100);
  while (total >= cfg.studyMinMin) {
    const lens = splitStudy(total, cfg);
    if (windowMinutes(lens, cfg) <= freeMin) return lens;
    total--;
  }
  return [];
}

// ─── sequencia de blocos ──────────────────────────────────────────────────────

interface Slot { type: BlockType; min: number }

// Monta a ordem dos blocos: w pomodoros de trabalho com a janela de estudo
// inteira encaixada no meio. A pausa entra entre blocos vizinhos, menos quando
// se sai do estudo direto para o trabalho — trocar de assunto ja e o descanso.
export function buildSequence(w: number, studyLens: number[], cfg: ExpedienteConfig): Slot[] {
  const seq: Slot[] = [];
  const push = (slot: Slot) => {
    const prev = seq[seq.length - 1];
    if (prev && !(prev.type === 'study' && slot.type === 'work')) {
      seq.push({ type: 'break', min: cfg.breakMin });
    }
    seq.push(slot);
  };
  const pushStudy = () => studyLens.forEach(min => push({ type: 'study', min }));

  const at = Math.floor(w / 2);
  for (let i = 0; i < w; i++) {
    if (i === at) pushStudy();
    push({ type: 'work', min: cfg.workMin });
  }
  if (at >= w) pushStudy();  // periodo sem trabalho nenhum (slider em 100%)
  return seq;
}

function seqMinutes(seq: Slot[]): number {
  return seq.reduce((acc, s) => acc + s.min, 0);
}

// ─── plano ────────────────────────────────────────────────────────────────────

// Distribui a sequencia no relogio, desviando dos compromissos. O que nao
// couber antes da hora alvo simplesmente nao entra: sobra que nao fecha um
// ciclo vira sair mais cedo, nao um bloco pela metade.
function layout(
  seq: Slot[], startAt: number, targetAt: number, commitments: Commitment[],
): Block[] {
  const sorted = [...commitments].sort((a, b) => a.startAt - b.startAt);
  const placed = new Set<string>();
  const out: Block[] = [];
  let cursor = startAt;

  const block = (type: BlockType, from: number, to: number, title: string | null = null): Block => ({
    id: `${type}_${from}`,
    type, title, startAt: from, endAt: to,
    confirmedAt: null, areaId: null, subArea: '',
  });

  for (const slot of seq) {
    const len = slot.min * MS_MIN;

    // Empurra o cursor para depois de qualquer compromisso que colida — pode
    // encadear, se houver dois seguidos.
    for (let guard = 0; guard < sorted.length + 1; guard++) {
      const hit = sorted.find(c => c.startAt < cursor + len && c.endAt > cursor);
      if (!hit) break;
      if (!placed.has(hit.id)) {
        // A sobra ate o compromisso vira pausa explicita: buraco na timeline
        // faria a pagina achar que o periodo acabou.
        if (cursor < hit.startAt) {
          const prev = out[out.length - 1];
          if (prev && prev.type === 'break' && prev.endAt === cursor) prev.endAt = hit.startAt;
          else out.push(block('break', cursor, hit.startAt));
          cursor = hit.startAt;
        }
        out.push(block('commitment', hit.startAt, hit.endAt, hit.title));
        placed.add(hit.id);
      }
      cursor = Math.max(cursor, hit.endAt);
    }

    if (cursor + len > targetAt) break;
    out.push(block(slot.type, cursor, cursor + len));
    cursor += len;
  }

  // Pausa no fim nao serve para nada — o periodo acabou.
  while (out.length && out[out.length - 1].type === 'break') out.pop();

  // Compromissos que ficaram depois do ultimo bloco ainda aparecem na timeline.
  for (const c of sorted) {
    if (!placed.has(c.id)) out.push(block('commitment', c.startAt, c.endAt, c.title));
  }

  return out.sort((a, b) => a.startAt - b.startAt);
}

// Gera o plano do periodo: acha o maior numero de pomodoros de trabalho que
// cabe junto com a janela de estudo, e distribui no relogio.
export function buildBlocks(
  startAt: number,
  targetAt: number,
  cfg: ExpedienteConfig,
  studyPct: number,
  commitments: Commitment[] = [],
): Block[] {
  if (targetAt <= startAt) return [];

  commitments = normalizeCommitments(commitments);
  const free = freeMinutes(startAt, targetAt, commitments);
  const studyLens = studyLengths(free, studyPct, cfg);

  let best = buildSequence(0, studyLens, cfg);
  if (seqMinutes(best) > free) best = [];

  for (let w = 1; w <= Math.floor(free / cfg.workMin) + 1; w++) {
    const seq = buildSequence(w, studyLens, cfg);
    if (seqMinutes(seq) > free) break;
    best = seq;
  }

  return layout(best, startAt, targetAt, commitments);
}

// ─── consultas sobre o plano ──────────────────────────────────────────────────

export function blockAt(blocks: Block[], now: number): Block | null {
  return blocks.find(b => b.startAt <= now && now < b.endAt) ?? null;
}

export function nextBlockAfter(blocks: Block[], now: number): Block | null {
  return blocks.find(b => b.startAt > now) ?? null;
}

export function planEndAt(blocks: Block[], fallback: number): number {
  return blocks.length ? blocks[blocks.length - 1].endAt : fallback;
}

export function studyMinutesIn(blocks: Block[]): number {
  return blocks
    .filter(b => b.type === 'study')
    .reduce((acc, b) => acc + Math.round((b.endAt - b.startAt) / MS_MIN), 0);
}

// Refaz so o futuro: os blocos ja vividos ficam como estao, e do ponto de corte
// ate a hora alvo o plano e gerado de novo. E o que acontece quando entra um
// compromisso no meio do periodo ou quando voce estica um estudo.
export function replanFrom(
  exp: Expediente, from: number, commitments = exp.commitments,
): Block[] {
  const past = exp.blocks.filter(b => b.endAt <= from);
  const cut = exp.blocks.find(b => b.startAt < from && b.endAt > from);
  const kept = cut ? [...past, { ...cut, endAt: from }] : past;
  const cursor = kept.length ? kept[kept.length - 1].endAt : from;
  const future = commitments.filter(c => c.endAt > cursor);
  return [...kept, ...buildBlocks(cursor, exp.targetAt, exp.config, exp.studyPct, future)];
}

// ─── formatacao ───────────────────────────────────────────────────────────────

// Relogio de parede local — o mesmo fuso que o <input type="time"> usa para ler
// a hora alvo. (A DATA a que a sessao de estudo pertence continua vindo de
// sessionDate(), em Sao Paulo, para bater com o resto do app.)
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// "9:30" / "09:30" vindos de um <input type="time"> viram um timestamp de hoje.
export function timeToTimestamp(value: string, reference = Date.now()): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(reference);
  d.setHours(h, min, 0, 0);
  return d.getTime();
}

export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h}h${String(rest).padStart(2, '0')}` : `${h}h`;
}
