'use client';

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/firebase';
import {
  collection, doc, getDoc, getDocs, query, where, documentId, orderBy,
} from 'firebase/firestore';
import {
  Droplet, Footprints, Dumbbell, Pill, BookOpen, GraduationCap, Wind,
  Film, Activity, Loader2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DLog {
  water_ml: number; steps: number; walking_distance_km: number;
  reading_pages: number; gym_done: boolean; creatine_done: boolean;
  study_minutes: number; meditation_minutes: number;
}

interface Goals {
  water_ml: number; steps: number; reading_pages: number;
  gym_days_per_week: number; study_minutes: number; meditation_minutes: number;
}

interface Movie { id: string; watchDate?: string; status: string; }

interface AerobicSession {
  id: string; date: string; distance_km: number; avg_speed_kmh: number;
}

type Period    = 'dia' | 'semana' | 'mes' | 'ano';
type Sentiment = 'great' | 'ok' | 'warn' | 'na';

interface Insight {
  emoji: string;
  icon: React.ElementType;
  color: string;
  label: string;
  value: string;
  pct?: number;
  line: ReactNode;
  sentiment: Sentiment;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_GOALS: Goals = {
  water_ml: 4000, steps: 10000, reading_pages: 10,
  gym_days_per_week: 5, study_minutes: 120, meditation_minutes: 10,
};

const mkEmpty = (): DLog => ({
  water_ml: 0, steps: 0, walking_distance_km: 0,
  reading_pages: 0, gym_done: false, creatine_done: false,
  study_minutes: 0, meditation_minutes: 0,
});

const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const todayStr = () => dateStr(new Date());

const pct  = (v: number, g: number) => g > 0 ? Math.min((v / g) * 100, 100) : 0;
const avg  = (arr: number[]) => arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
const r1   = (n: number) => Math.round(n * 10) / 10;
const fmtN = (n: number) => Math.round(n).toLocaleString('pt-BR');

function fmtW(ml: number) { return ml >= 1000 ? `${r1(ml / 1000)} L` : `${Math.round(ml)} ml`; }
function fmtT(min: number) {
  if (!min) return '0 min';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
}

function diffPct(cur: number, ref: number) {
  if (ref === 0) return 0;
  return Math.round(((cur - ref) / ref) * 100);
}

function cmpNode(cur: number, ref: number, refFmt: string): ReactNode {
  if (ref === 0) return null;
  const d = diffPct(cur, ref);
  if (Math.abs(d) <= 5) return <span>na sua média habitual ({refFmt}).</span>;
  if (d > 0) return <><span className="font-semibold text-emerald-400">↑ {d}% acima</span> da sua média ({refFmt}).</>;
  return <><span className="font-semibold text-rose-400">↓ {Math.abs(d)}% abaixo</span> da sua média ({refFmt}).</>;
}

function wkStart(d: Date): Date {
  const dow = d.getDay();
  const s = new Date(d);
  s.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  s.setHours(0, 0, 0, 0);
  return s;
}

function sumLogs(rows: DLog[], fn: (d: DLog) => number) {
  return rows.reduce((s, d) => s + fn(d), 0);
}

function normalizeLog(raw: Record<string, unknown>): DLog {
  return {
    water_ml:            (raw.water_ml            as number)  ?? 0,
    steps:               (raw.steps               as number)  ?? 0,
    walking_distance_km: (raw.walking_distance_km as number)  ?? 0,
    reading_pages:       (raw.reading_pages        as number)  ?? 0,
    gym_done:            (raw.gym_done             as boolean) ?? false,
    creatine_done:       (raw.creatine_done        as boolean) ?? false,
    study_minutes:       (raw.study_minutes        as number)  ?? 0,
    meditation_minutes:  (raw.meditation_minutes   as number)  ?? 0,
  };
}

// ── Insight builders ──────────────────────────────────────────────────────────

function buildDay(
  todayLog: DLog, hist30: DLog[], goals: Goals,
  movies: Movie[], aerobic: AerobicSession[],
): Insight[] {
  const n   = hist30.length || 1;
  const td  = todayStr();
  const avgW  = avg(hist30.map(d => d.water_ml));
  const avgSt = avg(hist30.map(d => d.steps));
  const avgPg = avg(hist30.map(d => d.reading_pages));
  const avgSy = avg(hist30.map(d => d.study_minutes));
  const avgMd = avg(hist30.map(d => d.meditation_minutes));
  const gymN  = hist30.filter(d => d.gym_done).length;
  const crN   = hist30.filter(d => d.creatine_done).length;

  const tdMov  = movies.filter(m => m.watchDate === td && m.status === 'watched').length;
  const tdAer  = aerobic.filter(s => s.date === td).length;
  const lastS  = aerobic.find(s => s.date < td);
  const daysAgo = lastS
    ? Math.round((Date.now() - new Date(lastS.date + 'T12:00:00').getTime()) / 86400000)
    : null;

  const s = (done: boolean, mid: Sentiment = 'ok'): Sentiment => done ? 'great' : mid;

  return [
    {
      emoji: '💧', icon: Droplet, color: 'text-blue-400', label: 'Água',
      value: todayLog.water_ml > 0
        ? todayLog.water_ml >= goals.water_ml
          ? `${fmtW(todayLog.water_ml)} · meta atingida! 🎯`
          : `${fmtW(todayLog.water_ml)} · faltam ${fmtW(goals.water_ml - todayLog.water_ml)}`
        : 'Nenhum registro ainda',
      pct: pct(todayLog.water_ml, goals.water_ml),
      line: avgW > 0
        ? <>Média 30 dias: {fmtW(Math.round(avgW))}/dia — {cmpNode(todayLog.water_ml, avgW, fmtW(Math.round(avgW)))}</>
        : 'Ainda sem histórico para comparar.',
      sentiment: s(todayLog.water_ml >= goals.water_ml, todayLog.water_ml >= goals.water_ml * 0.6 ? 'ok' : 'warn'),
    },
    {
      emoji: '👟', icon: Footprints, color: 'text-emerald-400', label: 'Passos',
      value: todayLog.steps > 0
        ? todayLog.steps >= goals.steps
          ? `${fmtN(todayLog.steps)} passos · meta! 🎯`
          : `${fmtN(todayLog.steps)} passos · faltam ${fmtN(goals.steps - todayLog.steps)}`
        : 'Nenhum passo registrado',
      pct: pct(todayLog.steps, goals.steps),
      line: avgSt > 0
        ? <>Média 30 dias: {fmtN(avgSt)} passos — {cmpNode(todayLog.steps, avgSt, fmtN(avgSt))}</>
        : 'Ainda sem histórico.',
      sentiment: s(todayLog.steps >= goals.steps, todayLog.steps > 0 ? 'ok' : 'warn'),
    },
    {
      emoji: '🏋️', icon: Dumbbell, color: 'text-rose-400', label: 'Academia',
      value: todayLog.gym_done ? 'Fui hoje! 💪' : 'Ainda não fui',
      line: <>
        Últimos 30 dias: <span className="text-slate-200">{gymN} treinos</span> ({Math.round(gymN / n * 100)}% dos dias).{' '}
        {todayLog.gym_done
          ? <span className="text-emerald-400 font-medium">Sequência mantida! 🔥</span>
          : gymN / n >= 0.6 ? 'Você costuma ir — ainda dá tempo hoje.' : ''}
      </>,
      sentiment: s(todayLog.gym_done, gymN / n >= 0.5 ? 'ok' : 'na'),
    },
    {
      emoji: '💊', icon: Pill, color: 'text-purple-400', label: 'Creatina',
      value: todayLog.creatine_done ? 'Tomei hoje ✓' : 'Ainda não tomei',
      line: <>
        Consistência 30 dias: <span className="text-slate-200">{crN}/{n} dias</span> ({Math.round(crN / n * 100)}%).{' '}
        {!todayLog.creatine_done && crN / n >= 0.9
          ? <span className="text-amber-400">Sua consistência é ótima — não deixa passar!</span>
          : null}
      </>,
      sentiment: s(todayLog.creatine_done, crN / n >= 0.8 ? 'ok' : 'warn'),
    },
    {
      emoji: '📚', icon: BookOpen, color: 'text-amber-400', label: 'Leitura',
      value: todayLog.reading_pages > 0
        ? todayLog.reading_pages >= goals.reading_pages
          ? `${todayLog.reading_pages} págs · meta! 🎯`
          : `${todayLog.reading_pages} págs · faltam ${goals.reading_pages - todayLog.reading_pages}`
        : 'Nenhuma página hoje',
      pct: pct(todayLog.reading_pages, goals.reading_pages),
      line: avgPg > 0
        ? <>Média 30 dias: {r1(avgPg)} págs/dia — {cmpNode(todayLog.reading_pages, avgPg, `${r1(avgPg)} págs`)}</>
        : 'Ainda sem histórico.',
      sentiment: s(todayLog.reading_pages >= goals.reading_pages, todayLog.reading_pages > 0 ? 'ok' : 'warn'),
    },
    {
      emoji: '🎓', icon: GraduationCap, color: 'text-violet-400', label: 'Estudo',
      value: todayLog.study_minutes > 0
        ? todayLog.study_minutes >= goals.study_minutes
          ? `${fmtT(todayLog.study_minutes)} · meta! 🎯`
          : `${fmtT(todayLog.study_minutes)} · faltam ${fmtT(goals.study_minutes - todayLog.study_minutes)}`
        : 'Nenhum estudo hoje',
      pct: pct(todayLog.study_minutes, goals.study_minutes),
      line: avgSy > 0
        ? <>Média 30 dias: {fmtT(Math.round(avgSy))}/dia — {cmpNode(todayLog.study_minutes, avgSy, fmtT(Math.round(avgSy)))}</>
        : 'Ainda sem histórico.',
      sentiment: s(todayLog.study_minutes >= goals.study_minutes, todayLog.study_minutes > 0 ? 'ok' : 'warn'),
    },
    {
      emoji: '🧘', icon: Wind, color: 'text-teal-400', label: 'Meditação',
      value: todayLog.meditation_minutes > 0
        ? todayLog.meditation_minutes >= goals.meditation_minutes
          ? `${fmtT(todayLog.meditation_minutes)} · meta! 🎯`
          : `${fmtT(todayLog.meditation_minutes)} · faltam ${fmtT(goals.meditation_minutes - todayLog.meditation_minutes)}`
        : 'Nenhuma meditação hoje',
      pct: pct(todayLog.meditation_minutes, goals.meditation_minutes),
      line: avgMd > 0
        ? <>Média 30 dias: {fmtT(Math.round(avgMd))}/dia — {cmpNode(todayLog.meditation_minutes, avgMd, fmtT(Math.round(avgMd)))}</>
        : 'Ainda sem histórico.',
      sentiment: s(todayLog.meditation_minutes >= goals.meditation_minutes, todayLog.meditation_minutes > 0 ? 'ok' : 'warn'),
    },
    {
      emoji: '🎬', icon: Film, color: 'text-violet-300', label: 'Filmes',
      value: tdMov > 0 ? `${tdMov} filme${tdMov > 1 ? 's' : ''} hoje 🍿` : 'Nenhum filme hoje',
      line: (() => {
        const c7  = new Date(); c7.setDate(c7.getDate() - 7);
        const c30 = new Date(); c30.setDate(c30.getDate() - 30);
        const n7  = movies.filter(m => m.watchDate && m.watchDate >= dateStr(c7)  && m.status === 'watched').length;
        const n30 = movies.filter(m => m.watchDate && m.watchDate >= dateStr(c30) && m.status === 'watched').length;
        return <>Últimos 7 dias: <span className="text-slate-200">{n7} filme{n7 !== 1 ? 's' : ''}</span>. Últimos 30 dias: <span className="text-slate-200">{n30} filmes</span>.</>;
      })(),
      sentiment: 'na',
    },
    {
      emoji: '🏃', icon: Activity, color: 'text-cyan-400', label: 'Aeróbico',
      value: tdAer > 0 ? `${tdAer} sessão${tdAer > 1 ? 'ões' : ''} hoje` : 'Nenhuma sessão hoje',
      line: (() => {
        const c4w = new Date(); c4w.setDate(c4w.getDate() - 28);
        const n4w = aerobic.filter(s => s.date >= dateStr(c4w)).length;
        const lastPart = daysAgo !== null && daysAgo > 0
          ? `Última sessão: há ${daysAgo} dia${daysAgo > 1 ? 's' : ''} (${lastS!.distance_km.toFixed(1)} km a ${lastS!.avg_speed_kmh.toFixed(1)} km/h). `
          : '';
        return `${lastPart}${n4w > 0 ? `${n4w} sessões em 4 semanas (${r1(n4w / 4)}/sem).` : 'Nenhuma sessão recente.'}`;
      })(),
      sentiment: tdAer > 0 ? 'great' : 'na',
    },
  ];
}

function buildWeek(
  logs: Record<string, DLog>, goals: Goals,
  movies: Movie[], aerobic: AerobicSession[],
): Insight[] {
  const now = new Date(), td = todayStr();
  const ws = wkStart(now);
  const dow = (now.getDay() + 6) % 7;
  const elapsed = dow + 1;

  const curWk = Array.from({ length: elapsed }, (_, i) => {
    const d = new Date(ws); d.setDate(ws.getDate() + i);
    return logs[dateStr(d)] ?? mkEmpty();
  });
  const past4 = Array.from({ length: 4 }, (_, wi) =>
    Array.from({ length: elapsed }, (_, i) => {
      const d = new Date(ws); d.setDate(ws.getDate() - (wi + 1) * 7 + i);
      return logs[dateStr(d)] ?? mkEmpty();
    })
  );

  const sc = (fn: (d: DLog) => number) => sumLogs(curWk, fn);
  const ap = (fn: (d: DLog) => number) => avg(past4.map(w => sumLogs(w, fn)));

  const wW = sc(d => d.water_ml),          aW = ap(d => d.water_ml);
  const wS = sc(d => d.steps),             aS = ap(d => d.steps);
  const wP = sc(d => d.reading_pages),     aP = ap(d => d.reading_pages);
  const wY = sc(d => d.study_minutes),     aY = ap(d => d.study_minutes);
  const wM = sc(d => d.meditation_minutes),aM = ap(d => d.meditation_minutes);
  const wG = curWk.filter(d => d.gym_done).length;
  const aG = avg(past4.map(w => w.filter(d => d.gym_done).length));
  const wC = curWk.filter(d => d.creatine_done).length;
  const aC = avg(past4.map(w => w.filter(d => d.creatine_done).length));
  const wsStr = dateStr(ws);

  const wMov = movies.filter(m => m.watchDate && m.watchDate >= wsStr && m.watchDate <= td && m.status === 'watched').length;
  const aMov = avg(Array.from({ length: 4 }, (_, wi) => {
    const s = new Date(ws); s.setDate(ws.getDate() - (wi + 1) * 7);
    const e = new Date(s); e.setDate(s.getDate() + elapsed - 1);
    return movies.filter(m => m.watchDate && m.watchDate >= dateStr(s) && m.watchDate <= dateStr(e) && m.status === 'watched').length;
  }));

  const wAer = aerobic.filter(x => x.date >= wsStr && x.date <= td);
  const aAer = avg(Array.from({ length: 4 }, (_, wi) => {
    const s = new Date(ws); s.setDate(ws.getDate() - (wi + 1) * 7);
    const e = new Date(s); e.setDate(s.getDate() + elapsed - 1);
    return aerobic.filter(x => x.date >= dateStr(s) && x.date <= dateStr(e)).length;
  }));

  const pl = `(${elapsed} dia${elapsed > 1 ? 's' : ''} desta semana)`;
  const noHist = 'Sem histórico suficiente.';

  return [
    {
      emoji: '💧', icon: Droplet, color: 'text-blue-400', label: 'Água',
      value: `${fmtW(wW)} ${pl}`,
      pct: pct(wW, goals.water_ml * elapsed),
      line: aW > 0 ? <>Média semanas anteriores: {fmtW(Math.round(aW))} — {cmpNode(wW, aW, fmtW(Math.round(aW)))}</> : noHist,
      sentiment: wW >= goals.water_ml * elapsed ? 'great' : wW >= goals.water_ml * elapsed * 0.7 ? 'ok' : 'warn',
    },
    {
      emoji: '👟', icon: Footprints, color: 'text-emerald-400', label: 'Passos',
      value: `${fmtN(wS)} passos ${pl}`,
      pct: pct(wS, goals.steps * elapsed),
      line: aS > 0 ? <>Média: {fmtN(aS)} passos — {cmpNode(wS, aS, fmtN(aS))}</> : noHist,
      sentiment: wS >= goals.steps * elapsed ? 'great' : wS >= goals.steps * elapsed * 0.7 ? 'ok' : 'warn',
    },
    {
      emoji: '🏋️', icon: Dumbbell, color: 'text-rose-400', label: 'Academia',
      value: `${wG} treino${wG !== 1 ? 's' : ''} ${pl}`,
      pct: pct(wG, goals.gym_days_per_week),
      line: aG > 0 ? <>Média 4 semanas: {r1(aG)} treinos — {cmpNode(wG, aG, `${r1(aG)} treinos`)}</> : `Meta semanal: ${goals.gym_days_per_week} dias.`,
      sentiment: wG >= goals.gym_days_per_week ? 'great' : wG > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '💊', icon: Pill, color: 'text-purple-400', label: 'Creatina',
      value: `${wC}/${elapsed} dias ${pl}`,
      line: aC > 0 ? <>Média: {r1(aC)} dias — {cmpNode(wC, aC, `${r1(aC)} dias`)}</> : noHist,
      sentiment: wC === elapsed ? 'great' : wC >= elapsed * 0.8 ? 'ok' : 'warn',
    },
    {
      emoji: '📚', icon: BookOpen, color: 'text-amber-400', label: 'Leitura',
      value: `${wP} páginas ${pl}`,
      pct: pct(wP, goals.reading_pages * elapsed),
      line: aP > 0 ? <>Média: {Math.round(aP)} págs — {cmpNode(wP, aP, `${Math.round(aP)} págs`)}</> : noHist,
      sentiment: wP >= goals.reading_pages * elapsed ? 'great' : wP > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '🎓', icon: GraduationCap, color: 'text-violet-400', label: 'Estudo',
      value: `${fmtT(wY)} ${pl}`,
      pct: pct(wY, goals.study_minutes * elapsed),
      line: aY > 0 ? <>Média: {fmtT(Math.round(aY))} — {cmpNode(wY, aY, fmtT(Math.round(aY)))}</> : noHist,
      sentiment: wY >= goals.study_minutes * elapsed ? 'great' : wY > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '🧘', icon: Wind, color: 'text-teal-400', label: 'Meditação',
      value: `${fmtT(wM)} ${pl}`,
      pct: pct(wM, goals.meditation_minutes * elapsed),
      line: aM > 0 ? <>Média: {fmtT(Math.round(aM))} — {cmpNode(wM, aM, fmtT(Math.round(aM)))}</> : noHist,
      sentiment: wM >= goals.meditation_minutes * elapsed ? 'great' : wM > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '🎬', icon: Film, color: 'text-violet-300', label: 'Filmes',
      value: `${wMov} filme${wMov !== 1 ? 's' : ''} ${pl}`,
      line: aMov > 0 ? <>Média: {r1(aMov)} filmes/semana — {cmpNode(wMov, aMov, `${r1(aMov)} filmes`)}</> : `${wMov} filme${wMov !== 1 ? 's' : ''} esta semana.`,
      sentiment: 'na',
    },
    {
      emoji: '🏃', icon: Activity, color: 'text-cyan-400', label: 'Aeróbico',
      value: `${wAer.length} sessão${wAer.length !== 1 ? 'ões' : ''} ${pl}`,
      line: (() => {
        const parts: string[] = [];
        if (aAer > 0) {
          const d = diffPct(wAer.length, aAer);
          parts.push(`Média: ${r1(aAer)} sessões/sem (${Math.abs(d) <= 5 ? 'na média' : d > 0 ? `+${d}%` : `${Math.abs(d)}% abaixo`})`);
        }
        if (wAer.length > 0) {
          const km  = wAer.reduce((s, x) => s + x.distance_km, 0);
          const spd = avg(wAer.map(x => x.avg_speed_kmh));
          parts.push(`${km.toFixed(1)} km, ${spd.toFixed(1)} km/h`);
        }
        return parts.join(' · ') || 'Nenhuma sessão esta semana.';
      })(),
      sentiment: wAer.length >= 2 ? 'great' : wAer.length > 0 ? 'ok' : 'na',
    },
  ];
}

function buildMonth(
  logs: Record<string, DLog>, goals: Goals,
  movies: Movie[], aerobic: AerobicSession[],
): Insight[] {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth(), dom = now.getDate();
  const td = todayStr();
  const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  const curMo = Array.from({ length: dom }, (_, i) =>
    logs[dateStr(new Date(y, m, i + 1))] ?? mkEmpty()
  );
  const past3 = Array.from({ length: 3 }, (_, mi) => {
    const pm = new Date(y, m - (mi + 1), 1);
    const dpm = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.min(dom, dpm) }, (_, i) =>
      logs[dateStr(new Date(pm.getFullYear(), pm.getMonth(), i + 1))] ?? mkEmpty()
    );
  });

  const sc = (fn: (d: DLog) => number) => sumLogs(curMo, fn);
  const ap = (fn: (d: DLog) => number) => avg(past3.map(w => sumLogs(w, fn)));

  const mW = sc(d => d.water_ml),          aW = ap(d => d.water_ml);
  const mS = sc(d => d.steps),             aS = ap(d => d.steps);
  const mP = sc(d => d.reading_pages),     aP = ap(d => d.reading_pages);
  const mY = sc(d => d.study_minutes),     aY = ap(d => d.study_minutes);
  const mM = sc(d => d.meditation_minutes),aM = ap(d => d.meditation_minutes);
  const mG = curMo.filter(d => d.gym_done).length;
  const aG = avg(past3.map(w => w.filter(d => d.gym_done).length));
  const mC = curMo.filter(d => d.creatine_done).length;
  const aC = avg(past3.map(w => w.filter(d => d.creatine_done).length));

  const mStart = dateStr(new Date(y, m, 1));
  const mMov = movies.filter(mv => mv.watchDate && mv.watchDate >= mStart && mv.watchDate <= td && mv.status === 'watched').length;
  const aMov = avg(Array.from({ length: 3 }, (_, mi) => {
    const pm = new Date(y, m - (mi + 1), 1);
    const dpm = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate();
    const ps = dateStr(pm);
    const pe = dateStr(new Date(pm.getFullYear(), pm.getMonth(), Math.min(dom, dpm)));
    return movies.filter(mv => mv.watchDate && mv.watchDate >= ps && mv.watchDate <= pe && mv.status === 'watched').length;
  }));

  const mAer = aerobic.filter(s => s.date >= mStart && s.date <= td);
  const aAer = avg(Array.from({ length: 3 }, (_, mi) => {
    const pm = new Date(y, m - (mi + 1), 1);
    const dpm = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate();
    const ps = dateStr(pm);
    const pe = dateStr(new Date(pm.getFullYear(), pm.getMonth(), Math.min(dom, dpm)));
    return aerobic.filter(s => s.date >= ps && s.date <= pe).length;
  }));

  const pl = `em ${MONTHS[m]} (${dom} dias)`;
  const noHist = 'Sem histórico suficiente.';
  const cr = 'Média mesmo período dos últimos 3 meses';
  const gymTarget = Math.round(goals.gym_days_per_week * (dom / 7));

  return [
    {
      emoji: '💧', icon: Droplet, color: 'text-blue-400', label: 'Água',
      value: `${fmtW(mW)} ${pl}`,
      pct: pct(mW, goals.water_ml * dom),
      line: aW > 0 ? <>{cr}: {fmtW(Math.round(aW))} — {cmpNode(mW, aW, fmtW(Math.round(aW)))}</> : noHist,
      sentiment: mW >= goals.water_ml * dom * 0.9 ? 'great' : mW >= goals.water_ml * dom * 0.7 ? 'ok' : 'warn',
    },
    {
      emoji: '👟', icon: Footprints, color: 'text-emerald-400', label: 'Passos',
      value: `${fmtN(mS)} passos ${pl}`,
      pct: pct(mS, goals.steps * dom),
      line: aS > 0 ? <>{cr}: {fmtN(aS)} — {cmpNode(mS, aS, fmtN(aS))}</> : noHist,
      sentiment: mS >= goals.steps * dom * 0.9 ? 'great' : mS >= goals.steps * dom * 0.7 ? 'ok' : 'warn',
    },
    {
      emoji: '🏋️', icon: Dumbbell, color: 'text-rose-400', label: 'Academia',
      value: `${mG} treinos ${pl}`,
      pct: pct(mG, gymTarget),
      line: aG > 0 ? <>{cr}: {r1(aG)} treinos — {cmpNode(mG, aG, `${r1(aG)} treinos`)}</> : `Meta de ${gymTarget} treinos este mês.`,
      sentiment: mG >= gymTarget ? 'great' : mG >= gymTarget * 0.7 ? 'ok' : 'warn',
    },
    {
      emoji: '💊', icon: Pill, color: 'text-purple-400', label: 'Creatina',
      value: `${mC}/${dom} dias ${pl}`,
      pct: pct(mC, dom),
      line: aC > 0 ? <>{cr}: {r1(aC)} dias — {cmpNode(mC, aC, `${r1(aC)} dias`)}</> : noHist,
      sentiment: mC >= dom * 0.9 ? 'great' : mC >= dom * 0.7 ? 'ok' : 'warn',
    },
    {
      emoji: '📚', icon: BookOpen, color: 'text-amber-400', label: 'Leitura',
      value: `${mP} páginas ${pl}`,
      pct: pct(mP, goals.reading_pages * dom),
      line: aP > 0 ? <>{cr}: {Math.round(aP)} págs — {cmpNode(mP, aP, `${Math.round(aP)} págs`)}</> : noHist,
      sentiment: mP >= goals.reading_pages * dom ? 'great' : mP > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '🎓', icon: GraduationCap, color: 'text-violet-400', label: 'Estudo',
      value: `${fmtT(mY)} ${pl}`,
      pct: pct(mY, goals.study_minutes * dom),
      line: aY > 0 ? <>{cr}: {fmtT(Math.round(aY))} — {cmpNode(mY, aY, fmtT(Math.round(aY)))}</> : noHist,
      sentiment: mY >= goals.study_minutes * dom ? 'great' : mY > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '🧘', icon: Wind, color: 'text-teal-400', label: 'Meditação',
      value: `${fmtT(mM)} ${pl}`,
      pct: pct(mM, goals.meditation_minutes * dom),
      line: aM > 0 ? <>{cr}: {fmtT(Math.round(aM))} — {cmpNode(mM, aM, fmtT(Math.round(aM)))}</> : noHist,
      sentiment: mM >= goals.meditation_minutes * dom ? 'great' : mM > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '🎬', icon: Film, color: 'text-violet-300', label: 'Filmes',
      value: `${mMov} filme${mMov !== 1 ? 's' : ''} ${pl}`,
      line: aMov > 0 ? <>{cr}: {r1(aMov)} filmes — {cmpNode(mMov, aMov, `${r1(aMov)} filmes`)}</> : `${mMov} filmes este mês.`,
      sentiment: 'na',
    },
    {
      emoji: '🏃', icon: Activity, color: 'text-cyan-400', label: 'Aeróbico',
      value: `${mAer.length} sessão${mAer.length !== 1 ? 'ões' : ''} ${pl}`,
      line: (() => {
        const parts: string[] = [];
        if (aAer > 0) {
          const d = diffPct(mAer.length, aAer);
          parts.push(`${cr}: ${r1(aAer)} sessões (${Math.abs(d) <= 5 ? 'na média' : d > 0 ? `+${d}%` : `${Math.abs(d)}% abaixo`})`);
        }
        if (mAer.length > 0) {
          const km  = mAer.reduce((s, x) => s + x.distance_km, 0);
          const spd = avg(mAer.map(x => x.avg_speed_kmh));
          parts.push(`${km.toFixed(1)} km no total, ${spd.toFixed(1)} km/h médios`);
        }
        return parts.join(' · ') || 'Nenhuma sessão este mês.';
      })(),
      sentiment: mAer.length >= 8 ? 'great' : mAer.length >= 4 ? 'ok' : 'na',
    },
  ];
}

function buildYear(
  logs: Record<string, DLog>, goals: Goals,
  movies: Movie[], aerobic: AerobicSession[],
): Insight[] {
  const now = new Date();
  const y = now.getFullYear();
  const td = todayStr();
  const ysStart = `${y}-01-01`;
  const lyEnd = `${y - 1}${td.slice(4)}`;
  const lyStart = `${y - 1}-01-01`;

  const cyKeys = Object.keys(logs).filter(k => k >= ysStart && k <= td);
  const lyKeys = Object.keys(logs).filter(k => k >= lyStart && k <= lyEnd);
  const cyData = cyKeys.map(k => logs[k]);
  const lyData = lyKeys.map(k => logs[k]);

  const hasLY  = lyData.length >= 7;
  const elapsed = cyData.length || 1;

  const cyW = sumLogs(cyData, d => d.water_ml);
  const cyS = sumLogs(cyData, d => d.steps);
  const cyP = sumLogs(cyData, d => d.reading_pages);
  const cyY = sumLogs(cyData, d => d.study_minutes);
  const cyM = sumLogs(cyData, d => d.meditation_minutes);
  const cyG = cyData.filter(d => d.gym_done).length;
  const cyCr= cyData.filter(d => d.creatine_done).length;

  const lyW = sumLogs(lyData, d => d.water_ml);
  const lyS = sumLogs(lyData, d => d.steps);
  const lyP = sumLogs(lyData, d => d.reading_pages);
  const lyY = sumLogs(lyData, d => d.study_minutes);
  const lyM = sumLogs(lyData, d => d.meditation_minutes);
  const lyG = lyData.filter(d => d.gym_done).length;
  const lyCr= lyData.filter(d => d.creatine_done).length;

  const cyMov = movies.filter(m => m.watchDate && m.watchDate >= ysStart && m.watchDate <= td && m.status === 'watched').length;
  const lyMov = movies.filter(m => m.watchDate && m.watchDate >= lyStart && m.watchDate <= lyEnd && m.status === 'watched').length;
  const cyAer = aerobic.filter(s => s.date >= ysStart && s.date <= td);
  const lyAer = aerobic.filter(s => s.date >= lyStart && s.date <= lyEnd).length;

  const pl = `em ${y} (${elapsed} dias)`;
  const gymTarget = Math.round(goals.gym_days_per_week * (elapsed / 7));

  const lyCmpNode = (cur: number, prev: number, fmtFn: (n: number) => string): ReactNode => {
    if (!hasLY) return `Sem dados de ${y - 1} para comparar.`;
    if (prev === 0) return 'Sem dados do ano anterior.';
    const d = diffPct(cur, prev);
    return (
      <>
        Mesmo período em {y - 1}: {fmtFn(prev)} —{' '}
        {Math.abs(d) <= 5
          ? 'na média habitual'
          : d > 0
            ? <span className="font-semibold text-emerald-400">+{d}% a mais</span>
            : <span className="font-semibold text-rose-400">{Math.abs(d)}% a menos</span>
        }.
      </>
    );
  };

  return [
    {
      emoji: '💧', icon: Droplet, color: 'text-blue-400', label: 'Água',
      value: `${fmtW(cyW)} ${pl}`,
      pct: pct(cyW, goals.water_ml * elapsed),
      line: lyCmpNode(cyW, lyW, fmtW),
      sentiment: cyW >= goals.water_ml * elapsed * 0.9 ? 'great' : 'ok',
    },
    {
      emoji: '👟', icon: Footprints, color: 'text-emerald-400', label: 'Passos',
      value: `${fmtN(cyS)} passos ${pl}`,
      pct: pct(cyS, goals.steps * elapsed),
      line: lyCmpNode(cyS, lyS, fmtN),
      sentiment: cyS >= goals.steps * elapsed * 0.9 ? 'great' : 'ok',
    },
    {
      emoji: '🏋️', icon: Dumbbell, color: 'text-rose-400', label: 'Academia',
      value: `${cyG} treinos ${pl}`,
      pct: pct(cyG, gymTarget),
      line: lyCmpNode(cyG, lyG, n => `${n} treinos`),
      sentiment: cyG >= gymTarget ? 'great' : cyG >= gymTarget * 0.7 ? 'ok' : 'warn',
    },
    {
      emoji: '💊', icon: Pill, color: 'text-purple-400', label: 'Creatina',
      value: `${cyCr}/${elapsed} dias ${pl}`,
      pct: pct(cyCr, elapsed),
      line: lyCmpNode(cyCr, lyCr, n => `${n} dias`),
      sentiment: cyCr >= elapsed * 0.9 ? 'great' : cyCr >= elapsed * 0.7 ? 'ok' : 'warn',
    },
    {
      emoji: '📚', icon: BookOpen, color: 'text-amber-400', label: 'Leitura',
      value: `${cyP} páginas ${pl}`,
      pct: pct(cyP, goals.reading_pages * elapsed),
      line: lyCmpNode(cyP, lyP, n => `${n} págs`),
      sentiment: cyP >= goals.reading_pages * elapsed ? 'great' : cyP > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '🎓', icon: GraduationCap, color: 'text-violet-400', label: 'Estudo',
      value: `${fmtT(cyY)} ${pl}`,
      pct: pct(cyY, goals.study_minutes * elapsed),
      line: lyCmpNode(cyY, lyY, fmtT),
      sentiment: cyY >= goals.study_minutes * elapsed ? 'great' : cyY > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '🧘', icon: Wind, color: 'text-teal-400', label: 'Meditação',
      value: `${fmtT(cyM)} ${pl}`,
      pct: pct(cyM, goals.meditation_minutes * elapsed),
      line: lyCmpNode(cyM, lyM, fmtT),
      sentiment: cyM >= goals.meditation_minutes * elapsed ? 'great' : cyM > 0 ? 'ok' : 'warn',
    },
    {
      emoji: '🎬', icon: Film, color: 'text-violet-300', label: 'Filmes',
      value: `${cyMov} filmes assistidos ${pl}`,
      line: lyCmpNode(cyMov, lyMov, n => `${n} filmes`),
      sentiment: 'na',
    },
    {
      emoji: '🏃', icon: Activity, color: 'text-cyan-400', label: 'Aeróbico',
      value: `${cyAer.length} sessões ${pl}`,
      line: (() => {
        const parts: string[] = [];
        if (hasLY && lyAer > 0) {
          const d = diffPct(cyAer.length, lyAer);
          parts.push(`Mesmo período em ${y - 1}: ${lyAer} sessões (${Math.abs(d) <= 5 ? 'na média' : d > 0 ? `+${d}%` : `${Math.abs(d)}% abaixo`})`);
        }
        if (cyAer.length > 0) {
          const km  = cyAer.reduce((s, x) => s + x.distance_km, 0);
          const spd = avg(cyAer.map(x => x.avg_speed_kmh));
          parts.push(`${km.toFixed(0)} km no total, ${spd.toFixed(1)} km/h médios`);
        }
        return parts.join(' · ') || `${cyAer.length} sessões em ${y}.`;
      })(),
      sentiment: cyAer.length >= 30 ? 'great' : cyAer.length > 0 ? 'ok' : 'na',
    },
  ];
}

// ── MetricRow ─────────────────────────────────────────────────────────────────

const VALUE_COLOR: Record<Sentiment, string> = {
  great: 'text-emerald-400',
  ok:    'text-amber-400',
  warn:  'text-rose-400',
  na:    'text-slate-100',
};

function MetricRow({ ins }: { ins: Insight }) {
  const { emoji, label, value, pct: p, line, sentiment } = ins;
  return (
    <div className="flex items-start gap-3 rounded-2xl px-3 py-3.5 transition hover:bg-white/5">
      <span className="mt-0.5 shrink-0 text-xl">{emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 mb-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">{label}</span>
          <span className={`text-sm font-bold leading-tight ${VALUE_COLOR[sentiment]}`}>{value}</span>
        </div>
        {p !== undefined && (
          <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-slate-800/80">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                p >= 100 ? 'bg-emerald-500' : p >= 70 ? 'bg-amber-500' : p >= 40 ? 'bg-orange-500' : 'bg-rose-500'
              }`}
              style={{ width: `${Math.min(p, 100)}%` }}
            />
          </div>
        )}
        <div className="text-xs leading-relaxed text-slate-400">{line}</div>
      </div>
    </div>
  );
}

// ── ScoreSummary ──────────────────────────────────────────────────────────────

function ScoreSummary({ insights }: { insights: Insight[] }) {
  const great = insights.filter(i => i.sentiment === 'great').length;
  const ok    = insights.filter(i => i.sentiment === 'ok').length;
  const warn  = insights.filter(i => i.sentiment === 'warn').length;
  const total = insights.length;
  const score = total > 0 ? Math.round((great * 2 + ok) / (total * 2) * 100) : 0;
  const scoreColor = score >= 70 ? 'text-emerald-400' : score >= 45 ? 'text-amber-400' : 'text-rose-400';

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-white/8 pb-5">
      <span className={`text-5xl font-black tabular-nums ${scoreColor}`}>{score}%</span>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-slate-500 uppercase tracking-widest">desempenho geral</p>
        <div className="flex flex-wrap gap-2">
          {great > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-0.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/20">
              ✅ {great} ótimo{great > 1 ? 's' : ''}
            </span>
          )}
          {ok > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-0.5 text-xs font-semibold text-amber-400 ring-1 ring-amber-500/20">
              🟡 {ok} ok
            </span>
          )}
          {warn > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-3 py-0.5 text-xs font-semibold text-rose-400 ring-1 ring-rose-500/20">
              🔴 {warn} abaixo
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RelatoriosPage() {
  const { user } = useAuth();
  const [period, setPeriod]   = useState<Period>('dia');
  const [loading, setLoading] = useState(true);
  const [logs, setLogs]       = useState<Record<string, DLog>>({});
  const [goals, setGoals]     = useState<Goals>(DEFAULT_GOALS);
  const [movies, setMovies]   = useState<Movie[]>([]);
  const [aerobic, setAerobic] = useState<AerobicSession[]>([]);

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const now = new Date();
      const rangeStart = `${now.getFullYear() - 1}-01-01`;
      const rangeEnd = todayStr();

      const [logsSnap, goalsSnap, moviesSnap, aerobicSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'users', user.uid, 'daily_logs'),
          where(documentId(), '>=', rangeStart),
          where(documentId(), '<=', rangeEnd),
        )),
        getDoc(doc(db, 'users', user.uid, 'settings', 'goals')),
        getDocs(collection(db, 'users', user.uid, 'movies')),
        getDocs(query(collection(db, 'users', user.uid, 'aerobic_sessions'), orderBy('date', 'desc'))),
      ]);

      const logsResult: Record<string, DLog> = {};
      logsSnap.docs.forEach(d => { logsResult[d.id] = normalizeLog(d.data() as Record<string, unknown>); });

      setLogs(logsResult);
      if (goalsSnap.exists()) setGoals({ ...DEFAULT_GOALS, ...(goalsSnap.data() as Partial<Goals>) });
      setMovies(moviesSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Movie, 'id'>) })));
      setAerobic(aerobicSnap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<AerobicSession, 'id'>) })));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { if (user) loadAll(); }, [user, loadAll]);

  const todayLog = useMemo(() => logs[todayStr()] ?? mkEmpty(), [logs]);

  const hist30 = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    const cutStr = dateStr(cutoff);
    const td = todayStr();
    return Object.entries(logs)
      .filter(([k]) => k >= cutStr && k < td)
      .map(([, v]) => v);
  }, [logs]);

  const insights = useMemo((): Insight[] => {
    if (!Object.keys(logs).length) return [];
    switch (period) {
      case 'dia':    return buildDay(todayLog, hist30, goals, movies, aerobic);
      case 'semana': return buildWeek(logs, goals, movies, aerobic);
      case 'mes':    return buildMonth(logs, goals, movies, aerobic);
      case 'ano':    return buildYear(logs, goals, movies, aerobic);
    }
  }, [period, logs, todayLog, hist30, goals, movies, aerobic]);

  const periodSubtitle: Record<Period, string> = {
    dia:    `Hoje, ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`,
    semana: (() => {
      const ws = wkStart(new Date());
      const s = ws.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
      const e = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
      return `Semana de ${s} a ${e}`;
    })(),
    mes:  new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    ano:  `${new Date().getFullYear()} — acumulado até hoje`,
  };

  const PERIOD_LABELS: Record<Period, string> = { dia: 'Dia', semana: 'Semana', mes: 'Mês', ano: 'Ano' };

  return (
    <main className="min-h-screen bg-[#08101a] text-slate-100">
      <div className="mx-auto flex min-h-screen w-full gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Sidebar />
        <section className="flex-1 space-y-5 pb-24 md:pb-6">

          {/* Header */}
          <header className="rounded-[2rem] border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur-xl">
            <p className="text-sm uppercase tracking-[0.3em] text-tamagochi-300">Tamagochi Me</p>
            <h1 className="text-4xl font-semibold text-white">Relatórios</h1>
            <p className="mt-1 capitalize text-slate-400">{periodSubtitle[period]}</p>
          </header>

          {/* Period selector */}
          <div className="flex gap-2 rounded-3xl border border-white/10 bg-white/5 p-2 backdrop-blur-xl">
            {(['dia', 'semana', 'mes', 'ano'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`flex-1 rounded-2xl py-2.5 text-sm font-medium transition
                  ${period === p ? 'bg-tamagochi-500 text-slate-950 shadow-lg' : 'text-slate-400 hover:text-white'}`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>

          {/* Single report card */}
          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-[2rem] border border-white/10 bg-white/5 backdrop-blur-xl">
              <Loader2 size={28} className="animate-spin text-tamagochi-400" />
            </div>
          ) : (
            <div className="rounded-[2rem] border border-white/10 bg-white/5 p-5 shadow-glow backdrop-blur-xl">
              <ScoreSummary insights={insights} />
              <div>
                {insights.map((ins, i) => (
                  <div key={i}>
                    <MetricRow ins={ins} />
                    {i < insights.length - 1 && (
                      <div className="mx-3 h-px bg-white/5" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        </section>
      </div>
    </main>
  );
}
