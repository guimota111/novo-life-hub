// Pure computation — no Firebase imports. All functions take raw data and return results.

export interface DailyData {
  water_ml: number; steps: number; walking_distance_km?: number;
  reading_pages: number; gym_done: boolean; creatine_done: boolean;
  study_minutes: number; meditation_minutes: number;
}

export interface Goals {
  water_ml: number; steps: number; reading_pages: number;
  gym_days_per_week: number; study_minutes: number; meditation_minutes: number;
}

export interface Records {
  water_day: number; water_week: number; water_month: number;
  steps_day: number; steps_week: number; steps_month: number;
  km_day: number; km_week: number; km_month: number;
  reading_day: number; reading_week: number; reading_month: number;
  study_day: number; study_week: number; study_month: number;
  meditation_day: number; meditation_week: number; meditation_month: number;
  creatine_streak: number; gym_streak: number; general_streak: number;
  perfect_day_count: number;
}

export const emptyRecords = (): Records => ({
  water_day: 0, water_week: 0, water_month: 0,
  steps_day: 0, steps_week: 0, steps_month: 0,
  km_day: 0, km_week: 0, km_month: 0,
  reading_day: 0, reading_week: 0, reading_month: 0,
  study_day: 0, study_week: 0, study_month: 0,
  meditation_day: 0, meditation_week: 0, meditation_month: 0,
  creatine_streak: 0, gym_streak: 0, general_streak: 0,
  perfect_day_count: 0,
});

// ── Normalization ─────────────────────────────────────────────────────────────
// Firestore documents only contain fields that were written — a day logged only
// via Apple Health has `steps` but not `water_ml`. Without normalization,
// Math.max(0, undefined, ...) and sum + undefined produce NaN.

function normalizeLogs(logs: Record<string, DailyData>): Record<string, DailyData> {
  const out: Record<string, DailyData> = {};
  for (const [k, v] of Object.entries(logs)) {
    out[k] = {
      water_ml:            v.water_ml            ?? 0,
      steps:               v.steps               ?? 0,
      walking_distance_km: v.walking_distance_km ?? 0,
      reading_pages:       v.reading_pages       ?? 0,
      gym_done:            v.gym_done            ?? false,
      creatine_done:       v.creatine_done       ?? false,
      study_minutes:       v.study_minutes       ?? 0,
      meditation_minutes:  v.meditation_minutes  ?? 0,
    };
  }
  return out;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const empty = (): DailyData => ({
  water_ml: 0, steps: 0, walking_distance_km: 0, reading_pages: 0,
  gym_done: false, creatine_done: false, study_minutes: 0, meditation_minutes: 0,
});

function pct(v: number, g: number) { return g > 0 ? Math.min((v / g) * 100, 100) : 0; }

function allMet(d: DailyData, g: Goals) {
  return d.water_ml >= g.water_ml && d.steps >= g.steps && d.reading_pages >= g.reading_pages &&
    d.gym_done && d.creatine_done && d.study_minutes >= g.study_minutes && d.meditation_minutes >= g.meditation_minutes;
}

function habitsMet(d: DailyData, g: Goals) {
  return [d.water_ml >= g.water_ml, d.steps >= g.steps, d.reading_pages >= g.reading_pages,
    d.gym_done, d.creatine_done, d.study_minutes >= g.study_minutes, d.meditation_minutes >= g.meditation_minutes]
    .filter(Boolean).length;
}

function habitsActive(d: DailyData) {
  return [d.water_ml > 0, d.steps > 0, d.reading_pages > 0,
    d.gym_done, d.creatine_done, d.study_minutes > 0, d.meditation_minutes > 0]
    .filter(Boolean).length;
}

function hasActivity(d: DailyData) { return habitsActive(d) > 0; }

function dayScore(d: DailyData, g: Goals) {
  return Math.round(
    (pct(d.water_ml, g.water_ml) + pct(d.steps, g.steps) + pct(d.reading_pages, g.reading_pages) +
      (d.gym_done ? 100 : 0) + (d.creatine_done ? 100 : 0) +
      pct(d.study_minutes, g.study_minutes) + pct(d.meditation_minutes, g.meditation_minutes)) / 7
  );
}

function bestConsecutive(logs: Record<string, DailyData>, check: (d: DailyData) => boolean): number {
  const keys = Object.keys(logs).sort();
  if (!keys.length) return 0;
  const start = new Date(keys[0] + 'T12:00:00');
  const end   = new Date(keys[keys.length - 1] + 'T12:00:00');
  let best = 0, run = 0;
  const cur = new Date(start);
  while (cur <= end) {
    if (check(logs[cur.toISOString().slice(0, 10)] ?? empty())) { run++; best = Math.max(best, run); }
    else run = 0;
    cur.setDate(cur.getDate() + 1);
  }
  return best;
}

function bestWeek(logs: Record<string, DailyData>, val: (d: DailyData) => number): number {
  const keys = Object.keys(logs).sort();
  if (!keys.length) return 0;
  const start = new Date(keys[0] + 'T12:00:00');
  const end   = new Date(keys[keys.length - 1] + 'T12:00:00');
  let best = 0;
  const cur = new Date(start);
  while (cur <= end) {
    let sum = 0;
    for (let d = 0; d < 7; d++) {
      const dt = new Date(cur); dt.setDate(dt.getDate() + d);
      sum += val(logs[dt.toISOString().slice(0, 10)] ?? empty());
    }
    best = Math.max(best, sum);
    cur.setDate(cur.getDate() + 1);
  }
  return best;
}

function bestMonth(logs: Record<string, DailyData>, val: (d: DailyData) => number): number {
  const totals: Record<string, number> = {};
  for (const [k, d] of Object.entries(logs)) {
    const m = k.slice(0, 7);
    totals[m] = (totals[m] ?? 0) + val(d);
  }
  const vals = Object.values(totals);
  return vals.length ? Math.max(...vals) : 0;
}

function countDays(logs: Record<string, DailyData>, check: (d: DailyData) => boolean): number {
  return Object.values(logs).filter(check).length;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeRecords(logs: Record<string, DailyData>, goals: Goals): Records {
  const norm = normalizeLogs(logs);
  const days = Object.values(norm);
  if (!days.length) return emptyRecords();
  return {
    water_day:   Math.max(0, ...days.map(d => d.water_ml)),
    water_week:  bestWeek(norm, d => d.water_ml),
    water_month: bestMonth(norm, d => d.water_ml),
    steps_day:   Math.max(0, ...days.map(d => d.steps)),
    steps_week:  bestWeek(norm, d => d.steps),
    steps_month: bestMonth(norm, d => d.steps),
    km_day:      Math.max(0, ...days.map(d => d.walking_distance_km ?? 0)),
    km_week:     bestWeek(norm, d => d.walking_distance_km ?? 0),
    km_month:    bestMonth(norm, d => d.walking_distance_km ?? 0),
    reading_day:   Math.max(0, ...days.map(d => d.reading_pages)),
    reading_week:  bestWeek(norm, d => d.reading_pages),
    reading_month: bestMonth(norm, d => d.reading_pages),
    study_day:   Math.max(0, ...days.map(d => d.study_minutes)),
    study_week:  bestWeek(norm, d => d.study_minutes),
    study_month: bestMonth(norm, d => d.study_minutes),
    meditation_day:   Math.max(0, ...days.map(d => d.meditation_minutes)),
    meditation_week:  bestWeek(norm, d => d.meditation_minutes),
    meditation_month: bestMonth(norm, d => d.meditation_minutes),
    creatine_streak:   bestConsecutive(norm, d => d.creatine_done),
    gym_streak:        bestConsecutive(norm, d => d.gym_done),
    general_streak:    bestConsecutive(norm, d => allMet(d, goals)),
    perfect_day_count: countDays(norm, d => allMet(d, goals)),
  };
}

export function checkTrophies(
  logs: Record<string, DailyData>,
  goals: Goals,
  records: Records,
): Set<string> {
  const norm = normalizeLogs(logs);
  const earned = new Set<string>();
  const days = Object.values(norm);
  if (!days.length) { earned.add('primeiro_nivel'); return earned; }

  const totalStudy      = days.reduce((s, d) => s + d.study_minutes, 0);
  const totalMeditation = days.reduce((s, d) => s + d.meditation_minutes, 0);
  const totalPages      = days.reduce((s, d) => s + d.reading_pages, 0);
  const totalSteps      = days.reduce((s, d) => s + d.steps, 0);

  const waterGoalStreak  = bestConsecutive(norm, d => d.water_ml >= goals.water_ml);
  const stepsGoalStreak  = bestConsecutive(norm, d => d.steps >= goals.steps);
  const readingStreak    = bestConsecutive(norm, d => d.reading_pages > 0);
  const studyStreak      = bestConsecutive(norm, d => d.study_minutes > 0);
  const medStreak        = bestConsecutive(norm, d => d.meditation_minutes > 0);
  const anyStreak        = bestConsecutive(norm, hasActivity);
  const allMetStreak     = records.general_streak;
  const sixMetStreak     = bestConsecutive(norm, d => habitsMet(d, goals) >= 6);
  const fourMetStreak    = bestConsecutive(norm, d => habitsMet(d, goals) >= 4);
  const studyMedStreak   = bestConsecutive(norm, d =>
    d.study_minutes >= goals.study_minutes && d.meditation_minutes >= goals.meditation_minutes);
  const waterStepsStreak = bestConsecutive(norm, d =>
    d.water_ml >= goals.water_ml && d.steps >= goals.steps);

  // Hidratação
  if (days.some(d => d.water_ml > 0))                                  earned.add('primeira_gota');
  if (days.some(d => d.water_ml >= 3000))                              earned.add('fonte_eterna');
  if (days.some(d => d.water_ml >= 5000))                              earned.add('marejado');
  if (days.some(d => d.water_ml >= 6000))                              earned.add('tsunami');
  if (waterGoalStreak >= 7)                                            earned.add('sereia_cerrado');
  if (waterGoalStreak >= 14)                                           earned.add('bem_hidratado');
  if (countDays(norm, d => d.water_ml >= goals.water_ml) >= 30)       earned.add('rio_sem_fim');
  if (countDays(norm, d => d.water_ml >= goals.water_ml) >= 50)       earned.add('oceano_vivo');
  if (countDays(norm, d => d.water_ml >= goals.water_ml) >= 100)      earned.add('cem_dias_hidratado');
  if (countDays(norm, d => d.water_ml >= goals.water_ml) >= 365)      earned.add('fonte_da_juventude');

  // Passos
  if (days.some(d => d.steps > 0))                                     earned.add('primeiro_passo');
  if (days.some(d => d.steps >= 12500))                                earned.add('nomade_digital');
  if (stepsGoalStreak >= 7)                                            earned.add('caminhante');
  if (countDays(norm, d => d.steps >= goals.steps) >= 30)             earned.add('pes_de_vento');
  if (countDays(norm, d => d.steps >= goals.steps) >= 100)            earned.add('cem_dias_andando');
  if (records.steps_month >= 125000)                                   earned.add('explorador_nato');
  if (records.steps_month >= 250000)                                   earned.add('trekker');
  if (records.steps_week >= 52500)                                     earned.add('maratonista');
  if (records.steps_week >= 87500)                                     earned.add('ultra_runner');
  if (totalSteps >= 1250000)                                           earned.add('road_warrior');

  // Academia
  if (days.some(d => d.gym_done))                                      earned.add('primeiro_treino');
  if (records.gym_streak >= 7)                                         earned.add('sete_dias_de_ferro');
  if (records.gym_streak >= 30)                                        earned.add('musculos_titanio');
  if (countDays(norm, d => d.gym_done) >= 50)                          earned.add('atleta');
  if (countDays(norm, d => d.gym_done) >= 100)                         earned.add('ironman');
  if (countDays(norm, d => d.gym_done) >= 200)                         earned.add('gladiador');
  if (countDays(norm, d => d.gym_done) >= 365)                         earned.add('ferro_velho');
  if (countDays(norm, d => d.gym_done) >= 500)                         earned.add('incansavel');

  // Leitura
  if (days.some(d => d.reading_pages > 0))                            earned.add('primeira_pagina');
  if (days.some(d => d.reading_pages >= 50))                           earned.add('madrugada_literaria');
  if (days.some(d => d.reading_pages >= 100))                          earned.add('devorando_paginas');
  if (readingStreak >= 7)                                              earned.add('leitor_assiduo');
  if (readingStreak >= 30)                                             earned.add('worm_de_papel');
  if (countDays(norm, d => d.reading_pages >= goals.reading_pages) >= 100) earned.add('biblioteca_viva');
  if (totalPages >= 1000)                                              earned.add('mil_paginas');
  if (totalPages >= 10000)                                             earned.add('dez_mil_paginas');

  // Estudo
  if (days.some(d => d.study_minutes > 0))                            earned.add('primeiro_estudo');
  if (days.some(d => d.study_minutes >= 240))                          earned.add('foco_total');
  if (days.some(d => d.study_minutes >= 480))                          earned.add('modo_neurofilo');
  if (studyStreak >= 7)                                                earned.add('semana_produtiva');
  if (studyStreak >= 14)                                               earned.add('eterno_aprendiz');
  if (studyStreak >= 30)                                               earned.add('algoritmo_humano');
  if (totalStudy >= 3000)                                              earned.add('cinquenta_horas');
  if (totalStudy >= 6000)                                              earned.add('mestre_jedi');
  if (totalStudy >= 30000)                                             earned.add('cerebro_overflow');
  if (totalStudy >= 60000)                                             earned.add('mil_horas');

  // Meditação
  if (days.some(d => d.meditation_minutes > 0))                       earned.add('primeiro_respiro');
  if (days.some(d => d.meditation_minutes >= 60))                      earned.add('meditador_hardcore');
  if (medStreak >= 7)                                                  earned.add('mente_calma');
  if (medStreak >= 30)                                                 earned.add('zen_iniciante');
  if (medStreak >= 60)                                                 earned.add('mestre_zen');
  if (countDays(norm, d => d.meditation_minutes > 0) >= 30)           earned.add('mindful_basico');
  if (countDays(norm, d => d.meditation_minutes >= goals.meditation_minutes) >= 100) earned.add('guru_da_meditacao');
  if (countDays(norm, d => d.meditation_minutes > 0) >= 200)          earned.add('transcendente');
  if (totalMeditation >= 3000)                                        earned.add('cinquenta_horas_zen');
  if (totalMeditation >= 6000)                                        earned.add('cem_horas_zen');

  // Creatina
  if (days.some(d => d.creatine_done))                                 earned.add('primeira_dose');
  if (countDays(norm, d => d.creatine_done) >= 60)                     earned.add('consistencia_creatina');
  if (records.creatine_streak >= 30)                                   earned.add('suplementado');
  if (records.creatine_streak >= 90)                                   earned.add('protocolado');
  if (records.creatine_streak >= 180)                                  earned.add('semestre_suplementado');
  if (records.creatine_streak >= 365)                                  earned.add('ano_de_creatina');

  // Geral
  earned.add('primeiro_nivel');
  if (anyStreak >= 14)                                                 earned.add('relogio_suico');
  if (anyStreak >= 21)                                                 earned.add('velocidade_cruzeiro');
  if (countDays(norm, hasActivity) >= 100)                             earned.add('cem_dias_ativo');
  if (countDays(norm, hasActivity) >= 200)                             earned.add('duzentos_dias_ativo');
  if (countDays(norm, hasActivity) >= 365)                             earned.add('um_ano_ativo');
  if (days.some(d => habitsActive(d) >= 5))                           earned.add('equilibrista');
  if (days.some(d => habitsActive(d) >= 6))                           earned.add('polifatico');
  if (days.some(d => habitsActive(d) === 7))                          earned.add('harmonioso');
  if (days.some(d => allMet(d, goals)))                               earned.add('all_in');
  if (countDays(norm, d => habitsMet(d, goals) >= 5) >= 30)           earned.add('rotineiro');
  if (countDays(norm, d => dayScore(d, goals) >= 80) >= 30)           earned.add('cinco_estrelas');
  if (records.perfect_day_count >= 50)                                 earned.add('cinquenta_dias_perfeitos');
  if (records.perfect_day_count >= 100)                                earned.add('centuriao');
  if (sixMetStreak >= 7)                                               earned.add('consistencia_total');
  if (allMetStreak >= 3)                                               earned.add('tamagochi_feliz');
  if (allMetStreak >= 7)                                               earned.add('semana_imparavel');
  if (allMetStreak >= 30)                                              earned.add('mes_perfeito');
  if (allMetStreak >= 100)                                             earned.add('modo_deus');

  // Combo
  if (countDays(norm, d => d.gym_done && d.steps >= goals.steps) >= 20)
    earned.add('atletico');
  if (countDays(norm, d => d.gym_done && d.study_minutes >= goals.study_minutes) >= 20)
    earned.add('mente_e_corpo');
  if (countDays(norm, d => d.gym_done && d.study_minutes >= goals.study_minutes && d.meditation_minutes >= goals.meditation_minutes) >= 10)
    earned.add('corpo_mente_espirito');
  if (waterStepsStreak >= 14)
    earned.add('duplo_combo');
  if (studyMedStreak >= 7)
    earned.add('acordado_e_focado');
  if (countDays(norm, d => d.gym_done && d.steps >= goals.steps && d.water_ml >= goals.water_ml && d.study_minutes >= goals.study_minutes) >= 7)
    earned.add('total_health');
  if (countDays(norm, d => d.steps >= goals.steps && d.reading_pages >= goals.reading_pages) >= 20)
    earned.add('trilha');
  if (fourMetStreak >= 7)
    earned.add('guerreiro_completo');

  // Lendário
  const evaluatable = [
    'primeira_gota','fonte_eterna','marejado','tsunami','sereia_cerrado','bem_hidratado',
    'rio_sem_fim','oceano_vivo','cem_dias_hidratado','fonte_da_juventude',
    'primeiro_passo','nomade_digital','caminhante','pes_de_vento','cem_dias_andando',
    'explorador_nato','trekker','maratonista','ultra_runner','road_warrior',
    'primeiro_treino','sete_dias_de_ferro','musculos_titanio','atleta','ironman',
    'gladiador','ferro_velho','incansavel',
    'primeira_pagina','madrugada_literaria','devorando_paginas','leitor_assiduo',
    'worm_de_papel','biblioteca_viva','mil_paginas','dez_mil_paginas',
    'primeiro_estudo','foco_total','modo_neurofilo','semana_produtiva','eterno_aprendiz',
    'algoritmo_humano','cinquenta_horas','mestre_jedi','cerebro_overflow','mil_horas',
    'primeiro_respiro','meditador_hardcore','mente_calma','zen_iniciante','mestre_zen',
    'mindful_basico','guru_da_meditacao','transcendente','cinquenta_horas_zen','cem_horas_zen',
    'primeira_dose','consistencia_creatina','suplementado','protocolado',
    'semestre_suplementado','ano_de_creatina',
    'primeiro_nivel','relogio_suico','velocidade_cruzeiro','cem_dias_ativo',
    'duzentos_dias_ativo','um_ano_ativo','equilibrista','polifatico','harmonioso',
    'all_in','rotineiro','cinco_estrelas','cinquenta_dias_perfeitos','centuriao',
    'consistencia_total','tamagochi_feliz','semana_imparavel','mes_perfeito','modo_deus',
    'atletico','mente_e_corpo','corpo_mente_espirito','duplo_combo','acordado_e_focado',
    'total_health','trilha','guerreiro_completo',
  ];
  if (evaluatable.every(k => earned.has(k))) earned.add('lendario');

  // Meta-troféus
  const countSoFar = earned.size;
  if (countSoFar >= 10) earned.add('medalhista');
  if (countSoFar >= 25) earned.add('campeao');
  if (countSoFar >= 50) earned.add('el_campeon');

  return earned;
}

export function diffTrophies(prevEarned: string[], newEarned: Set<string>): string[] {
  return [...newEarned].filter(k => !prevEarned.includes(k));
}

export function diffRecords(prev: Records, next: Records): Array<{ field: keyof Records; value: number }> {
  return (Object.keys(next) as Array<keyof Records>)
    .filter(k => next[k] > prev[k])
    .map(k => ({ field: k, value: next[k] }));
}
