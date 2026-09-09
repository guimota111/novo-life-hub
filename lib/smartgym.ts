// Parser da exportação em texto do SmartGym (o email "FICHAS / HISTÓRICO / MEDIDAS").
// Puro: sem Firebase, sem React. Aceita o arquivo inteiro ou só um trecho colado
// (ex.: as últimas sessões do HISTÓRICO) — cada bloco é reconhecido pela linha
// "Objetivo:", então não depende dos cabeçalhos de seção existirem.

export interface SetGroup {
  sets: number;
  reps: number | null;
  // kg. null = a linha não tinha carga (peso corporal); 0 = "0kg" (carga não registrada)
  weight: number | null;
  durationSec: number | null;
  restSec: number | null;
}

export interface ParsedExercise {
  name: string;
  sets: SetGroup[];          // vazio no histórico = exercício pulado
  cardio: boolean;           // Esteira/Bicicleta — a importação ignora
}

export interface ParsedWorkout {
  name: string;
  frequency: string;
  objective: string;
  notes: string;
  exercises: ParsedExercise[];
}

export interface ParsedSession extends ParsedWorkout {
  date: string;              // AAAA-MM-DD
}

export interface ParsedExport {
  templates: ParsedWorkout[];
  sessions: ParsedSession[];
  warnings: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// "sÃ©ries" é UTF-8 que foi lido como Latin-1 (acontece ao copiar do email).
// Só mexe se o padrão aparecer; texto já correto passa intacto.
export function fixMojibake(text: string): string {
  if (!/Ã[\u0080-\u00BF]/.test(text)) return text;
  const enc = new TextEncoder();
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x100) bytes.push(cp);
    else bytes.push(...enc.encode(ch));
  }
  try {
    return new TextDecoder('utf-8').decode(Uint8Array.from(bytes));
  } catch {
    return text;
  }
}

const MONTHS_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

// "9 de setembro de 2026" → "2026-09-09"
export function parseDateLine(line: string): string | null {
  const m = /^(\d{1,2}) de ([a-z]+) de (\d{4})$/.exec(stripAccents(line.trim()).toLowerCase());
  if (!m) return null;
  const month = MONTHS_PT[m[2]];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// "4 séries, 8 reps, 68kg, 60 seg (intervalo)". O \S{1,2} tolera "sÃ©ries" caso
// o encoding não tenha sido corrigido.
const SET_RE = /^(\d+)\s+s\S{1,2}ries?,\s*(.+)$/i;
const toNum = (s: string) => Number(s.replace(',', '.'));

export function parseSetLine(line: string): SetGroup | null {
  const m = SET_RE.exec(line.trim());
  if (!m) return null;
  const g: SetGroup = { sets: Number(m[1]), reps: null, weight: null, durationSec: null, restSec: null };
  // "42,5kg" (decimal com vírgula) não pode ser partido pelo split
  const rest = m[2].replace(/(\d),(\d)/g, '$1.$2');
  for (const raw of rest.split(',')) {
    const t = stripAccents(raw.trim().toLowerCase());
    let mm: RegExpExecArray | null;
    if ((mm = /^(\d+)\s*reps?$/.exec(t))) g.reps = Number(mm[1]);
    else if ((mm = /^([\d.]+)\s*kg$/.exec(t))) g.weight = toNum(mm[1]);
    else if ((mm = /^(\d+)\s*seg\s*\(intervalo\)$/.exec(t))) g.restSec = Number(mm[1]);
    else if ((mm = /^(\d+)\s*seg\s*\(duracao\)$/.exec(t))) g.durationSec = Number(mm[1]);
    else if ((mm = /^(\d+)\s*min$/.exec(t))) g.durationSec = Number(mm[1]) * 60;
    else if ((mm = /^([\d.]+)$/.exec(t))) g.weight = toNum(mm[1]); // "0" sem unidade (elástico)
  }
  return g;
}

const CARDIO_NAME_RE = /^(esteira|bicicleta|bike|eliptico|transport|escada|corrida|remo ergometro)\b/;
const CARDIO_LINE_RE = /^([\d.,]+\s*km\s+em\s+\d+\s*min|\d+\s*min)$/;
const isCardioName = (name: string) => CARDIO_NAME_RE.test(stripAccents(name.toLowerCase()));

const isSectionHeader = (l: string) => /^(FICHAS|HIST.{0,2}RICO|MEDIDAS)$/i.test(stripAccents(l));
// Rodapé de email que sobra quando o usuário cola só o fim do arquivo
const isTrailer = (l: string) => /^(enviado do meu|sent from my)/i.test(l);

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseSmartGymExport(raw: string): ParsedExport {
  const warnings: string[] = [];
  const lines = fixMojibake(raw).replace(/\r\n?/g, '\n').split('\n').map(l => l.trim());

  const headerIdx = lines.map((l, i) => (isSectionHeader(l) || isTrailer(l) ? i : -1)).filter(i => i >= 0);
  const anchors = lines.map((l, i) => (/^Objetivo:$/i.test(l) ? i : -1)).filter(i => i >= 0);
  if (!anchors.length) {
    warnings.push('Nenhum bloco de treino encontrado (procurei pela linha "Objetivo:").');
    return { templates: [], sessions: [], warnings };
  }

  // Cabeçalho de cada bloco, lido de baixo pra cima a partir do "Objetivo:":
  //   [data]? / nome / frequência / (linhas vazias) / Objetivo:
  const heads = anchors.map(anchor => {
    let k = anchor - 1;
    while (k >= 0 && lines[k] === '') k--;
    let freqIdx = k;
    let nameIdx = k - 1;
    const nameLine = nameIdx >= 0 ? lines[nameIdx] : '';
    // bloco sem linha de frequência (nome colado no "Objetivo:")
    if (nameIdx < 0 || nameLine === '' || isSectionHeader(nameLine) || parseDateLine(nameLine)) {
      nameIdx = freqIdx;
      freqIdx = -1;
    }
    k = nameIdx - 1;
    while (k >= 0 && lines[k] === '') k--;
    const dateIdx = k >= 0 && parseDateLine(lines[k]) ? k : -1;
    return { anchor, nameIdx, freqIdx, dateIdx, start: dateIdx >= 0 ? dateIdx : nameIdx };
  });

  const templates = new Map<string, ParsedWorkout>();
  const sessions = new Map<string, ParsedSession>();

  heads.forEach((h, j) => {
    const nextStart = j + 1 < heads.length ? heads[j + 1].start : lines.length;
    const nextHeader = headerIdx.find(i => i > h.anchor) ?? lines.length;
    const end = Math.min(nextStart, nextHeader);

    const name = lines[h.nameIdx];
    const frequency = h.freqIdx >= 0 ? lines[h.freqIdx] : '';
    const date = h.dateIdx >= 0 ? parseDateLine(lines[h.dateIdx]) : null;
    const label = `"${name}"${date ? ` (${date})` : ''}`;

    const firstNonEmpty = (from: number) => {
      for (let i = from; i < end; i++) if (lines[i] !== '') return lines[i];
      return '';
    };
    const objective = firstNonEmpty(h.anchor + 1);
    let notes = '';
    let exIdx = -1;
    for (let i = h.anchor + 1; i < end; i++) {
      if (/^Notas:$/i.test(lines[i])) notes = firstNonEmpty(i + 1);
      if (/^Exerc.{1,2}cios:$/i.test(lines[i])) { exIdx = i; break; }
    }

    // Exercícios: nome, seguido das linhas de série; linha vazia fecha o exercício.
    // Nome sem série nenhuma = pulado.
    const exercises: ParsedExercise[] = [];
    if (exIdx < 0) {
      warnings.push(`${label}: bloco sem a linha "Exercícios:".`);
    } else {
      let cur: ParsedExercise | null = null;
      for (let i = exIdx + 1; i < end; i++) {
        const line = lines[i];
        if (line === '') { cur = null; continue; }
        if (!cur) {
          cur = { name: line, sets: [], cardio: isCardioName(line) };
          exercises.push(cur);
          continue;
        }
        const sg = parseSetLine(line);
        if (sg) cur.sets.push(sg);
        else if (CARDIO_LINE_RE.test(stripAccents(line.toLowerCase()))) cur.cardio = true;
        else {
          // linha que não é série logo abaixo de um nome: é outro exercício
          cur = { name: line, sets: [], cardio: isCardioName(line) };
          exercises.push(cur);
        }
      }
    }

    const workout: ParsedWorkout = { name, frequency, objective, notes, exercises };
    if (date) {
      const id = `${date}|${name}`;
      if (sessions.has(id)) warnings.push(`Sessão repetida no arquivo: ${name} em ${date} — mantive a última.`);
      sessions.set(id, { ...workout, date });
    } else {
      templates.set(name, workout);
    }
  });

  return {
    templates: [...templates.values()],
    sessions: [...sessions.values()].sort((a, b) => a.date.localeCompare(b.date)),
    warnings,
  };
}
