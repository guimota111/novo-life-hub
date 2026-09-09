// Ferramenta de desenvolvimento: roda o parser do SmartGym num arquivo e mostra
// o que seria importado, sem tocar no Firestore.
//
//   npx tsx scripts/parseSmartGym.ts caminho/para/export.txt
//
// Serve pra conferir uma exportação nova antes de colar no app, ou pra
// investigar quando algo não bateu.

import { readFileSync } from 'node:fs';
import { parseSmartGymExport, fixMojibake } from '../lib/smartgym';
import {
  buildImportPlan, computePRs, inferMuscleGroup, fmtGroups, fmtKg, MUSCLE_GROUPS,
} from '../lib/workouts';

const path = process.argv[2];
if (!path) {
  console.error('uso: npx tsx scripts/parseSmartGym.ts <arquivo.txt>');
  process.exit(1);
}

const raw = readFileSync(path, 'utf-8');
const parsed = parseSmartGymExport(raw);

// O mesmo texto com o encoding já corrigido tem que dar o mesmo resultado
const again = parseSmartGymExport(fixMojibake(raw));
const stable = JSON.stringify(parsed) === JSON.stringify(again);

console.log(`\n=== FICHAS (${parsed.templates.length}) ===`);
for (const t of parsed.templates) {
  const cardio = t.exercises.filter(e => e.cardio).length;
  console.log(`  ${t.name.padEnd(28)} ${t.frequency.padEnd(18)} ${t.exercises.length} exercícios${cardio ? ` (${cardio} cardio)` : ''}`);
}

console.log(`\n=== SESSÕES (${parsed.sessions.length}) ===`);
const first = parsed.sessions[0]?.date, last = parsed.sessions[parsed.sessions.length - 1]?.date;
console.log(`  período: ${first} → ${last}`);
const byTemplate = new Map<string, number>();
for (const s of parsed.sessions) byTemplate.set(s.name, (byTemplate.get(s.name) ?? 0) + 1);
for (const [n, c] of byTemplate) console.log(`  ${n.padEnd(28)} ${c}×`);

console.log(`\n=== AVISOS (${parsed.warnings.length}) ===`);
for (const w of parsed.warnings) console.log('  ' + w);
console.log(`\n  encoding estável (mojibake × corrigido): ${stable ? 'OK' : 'DIVERGIU'}`);

// ── Casos de borda ────────────────────────────────────────────────────────────
console.log('\n=== CASOS DE BORDA ===');
const find = (tmpl: string, ex: string) =>
  parsed.templates.find(t => t.name === tmpl)?.exercises.find(e => e.name === ex);
const show = (label: string, v: unknown) => console.log(`  ${label.padEnd(44)} ${JSON.stringify(v)}`);
show('elástico "0" sem kg → weight',        find('Ficha B1', 'Supino Em Pé com Elástico')?.sets[0]?.weight);
show('sem kg (peso corporal) → weight',      find('Ficha A1', 'Russian Twist')?.sets[0]?.weight);
show('duração 35s → durationSec',           find('Ficha C1', 'Prancha com Levantamento de Braço Lateral no TRX')?.sets[0]?.durationSec);
show('pirâmide → nº de grupos',              find('Peito, Ombro, Tríceps', 'Supino Declinado na Máquina')?.sets.length);
show('42.5kg → weight',                      find('Peito, Ombro, Tríceps', 'Supino Declinado na Máquina')?.sets[1]?.weight);
show('Esteira → cardio',                     find('Peito, Ombro, Tríceps', 'Esteira')?.cardio);
show('Bicicleta → cardio',                   find('Ficha B1', 'Bicicleta')?.cardio);
show('Push A (sem Notas) → objective',       parsed.templates.find(t => t.name === 'Push A')?.objective);
show('"Push b" minúsculo → nome',            parsed.templates.find(t => t.name === 'Push b')?.name);

const s2024 = parsed.sessions.find(s => s.date === '2024-04-14');
show('sessão 2024 → ficha',                  s2024?.name);
show('sessão 2024 → exercícios pulados',     s2024?.exercises.filter(e => e.sets.length === 0).map(e => e.name));
const sLast = parsed.sessions[parsed.sessions.length - 1];
show('última sessão → data/ficha',           `${sLast?.date} ${sLast?.name}`);
show('última sessão → 1º exercício',         sLast ? `${sLast.exercises[0].name}: ${fmtGroups(sLast.exercises[0].sets)}` : null);

// ── Plano de importação (banco vazio) ─────────────────────────────────────────
const plan = buildImportPlan(parsed, { templates: [], exercises: [], sessions: [] });
console.log('\n=== PLANO DE IMPORTAÇÃO (banco vazio) ===');
console.log(`  ${JSON.stringify(plan.summary)}`);

const groups = new Map<string, string[]>();
for (const e of plan.newExercises) groups.set(e.muscleGroup, [...(groups.get(e.muscleGroup) ?? []), e.name + (e.isBodyweight ? ' (pc)' : '')]);
console.log('\n=== GRUPOS MUSCULARES INFERIDOS ===');
for (const g of MUSCLE_GROUPS) {
  const list = groups.get(g.id) ?? [];
  console.log(`  ${g.label} (${list.length}):`);
  for (const n of list) console.log(`      ${n}`);
}

console.log('\n=== CONCLUSÃO POR SESSÃO (amostra) ===');
for (const s of plan.sessions.filter(s => s.completion < 1).slice(0, 8)) {
  const skipped = s.exercises.filter(e => e.performed.length === 0).map(e => e.name);
  console.log(`  ${s.date} ${s.templateName.padEnd(26)} ${s.setsDone}/${s.setsPrescribed} séries = ${Math.round(s.completion * 100)}%  pulados: ${skipped.join(', ') || '—'}`);
}
const avg = plan.sessions.reduce((a, s) => a + s.completion, 0) / plan.sessions.length;
console.log(`  média geral: ${Math.round(avg * 100)}%`);

console.log('\n=== PRs (top 12 por carga) ===');
const prs = [...computePRs(plan.sessions).values()].sort((a, b) => b.weight - a.weight).slice(0, 12);
const nameOf = new Map(plan.newExercises.map(e => [e.key, e.name]));
for (const p of prs) {
  console.log(`  ${(nameOf.get(p.key) ?? p.key).padEnd(44)} ${fmtKg(p.weight).padStart(8)} × ${String(p.reps).padStart(2)}  em ${p.date}   1RM≈${fmtKg(Math.round(p.e1rm))}   ${p.sessions} sessões`);
}

// ── Trecho colado (só o fim do histórico + rodapé do email) ───────────────────
console.log('\n=== TRECHO PARCIAL (últimas 2 sessões + rodapé) ===');
const fixed = fixMojibake(raw);
const cut = fixed.lastIndexOf('\n8 de setembro de 2026');
const partial = parseSmartGymExport(fixed.slice(cut));
console.log(`  fichas: ${partial.templates.length}  sessões: ${partial.sessions.length}  avisos: ${partial.warnings.length}`);
for (const s of partial.sessions) console.log(`  ${s.date} ${s.name}: ${s.exercises.map(e => e.name).join(' | ')}`);

console.log(`\n  inferMuscleGroup('Elevação das Escápulas com Barra') = ${inferMuscleGroup('Elevação das Escápulas com Barra')}`);
