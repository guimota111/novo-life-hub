import dotenv from 'dotenv';
import admin from 'firebase-admin';
import nodemailer from 'nodemailer';
import cron from 'node-cron';

dotenv.config({ path: '.env.local' });

function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PROJECT_ID = 'tamagochi-db43c';

const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) : null;
const useApplicationDefault = !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!admin.apps.length) {
  const adminConfig = { projectId: PROJECT_ID };

  if (serviceAccountJson) {
    adminConfig.credential = admin.credential.cert(serviceAccountJson);
  } else if (useApplicationDefault) {
    adminConfig.credential = admin.credential.applicationDefault();
  }

  admin.initializeApp(adminConfig);
}

const db = admin.firestore();

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'guimota1@gmail.com';
const TARGET_EMAIL = process.env.REPORT_TO ?? ADMIN_EMAIL;
const TARGET_USER_EMAIL = process.env.REPORT_USER_EMAIL ?? ADMIN_EMAIL;
const REPORT_USER_ID = process.env.REPORT_USER_ID || null;

let transporter = null;
if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
} else {
  console.warn('[sendReport] SMTP not configured. Set SMTP_* env vars or use Mailtrap.');
}

async function findUserIdByEmail(email) {
  if (!email) return null;

  try {
    const userRecord = await admin.auth().getUserByEmail(email);
    return userRecord.uid;
  } catch (error) {
    if (error.code && error.code !== 'auth/user-not-found') {
      console.warn('[sendReport] erro ao buscar usuário no Auth:', error);
    }
  }

  const q = db.collection('users').where('email', '==', email).limit(1);
  const snap = await q.get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

function fmtW(ml) { return ml >= 1000 ? `${Math.round(ml/100)/10} L` : `${Math.round(ml)} ml`; }
function fmtT(min) {
  if (!min) return '0 min';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}min` : `${h}h`) : `${m}min`;
}
function fmtN(n) { return Math.round(n).toLocaleString('pt-BR'); }
function avg(arr) { return arr.length ? arr.reduce((sum, x) => sum + x, 0) / arr.length : 0; }
function pct(value, target) { return target ? Math.round((value / target) * 100) : 0; }
function diffPct(current, baseline) { return baseline ? Math.round(((current - baseline) / baseline) * 100) : 0; }
function trendText(current, baseline, formatter = (v) => String(v)) {
  if (!baseline) return 'Sem histórico de comparação.';
  const d = diffPct(current, baseline);
  const sign = d > 0 ? '+' : '';
  return `${formatter(current)} vs ${formatter(Math.round(baseline))} (${sign}${d}%)`;
}
function normalizeLog(raw) {
  return {
    water_ml: raw?.water_ml ?? 0,
    steps: raw?.steps ?? 0,
    walking_distance_km: raw?.walking_distance_km ?? 0,
    reading_pages: raw?.reading_pages ?? 0,
    gym_done: raw?.gym_done ?? false,
    creatine_done: raw?.creatine_done ?? false,
    study_minutes: raw?.study_minutes ?? 0,
    meditation_minutes: raw?.meditation_minutes ?? 0,
  };
}
function normalizeMovie(raw) {
  return {
    id: raw?.id ?? '',
    watchDate: raw?.watchDate ?? '',
    status: raw?.status ?? '',
    title: raw?.title ?? '',
  };
}
function normalizeAerobic(raw) {
  return {
    id: raw?.id ?? '',
    date: raw?.date ?? '',
    distance_km: raw?.distance_km ?? 0,
    avg_speed_kmh: raw?.avg_speed_kmh ?? 0,
  };
}
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function badgeHtml(label, color) {
  return `<span style="display:inline-block;padding:0.25rem 0.65rem;border-radius:999px;background:${color};color:#fff;font-size:0.82rem;font-weight:700;margin-left:0.3rem;">${escapeHtml(label)}</span>`;
}

function badgeForPct(value, target) {
  const percent = target ? Math.round((value / target) * 100) : 0;
  if (percent >= 100) return badgeHtml('Excelente', '#16a34a');
  if (percent >= 70) return badgeHtml('Bom', '#0ea5e9');
  return badgeHtml('Atenção', '#f97316');
}

function progressBarHtml(value, target) {
  const percent = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return `<div style="background:#e2e8f0;border-radius:999px;height:10px;overflow:hidden;margin-top:8px;">
      <div style="width:${percent}%;background:#2563eb;height:100%;"></div>
    </div>
    <div style="font-size:0.82rem;color:#475569;margin-top:6px;">${percent}%</div>`;
}

function progressBarText(value, target) {
  const percent = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return `[${'#'.repeat(filled)}${'.'.repeat(empty)}] ${percent}%`;
}

async function buildSummaryForUser(userId) {
  const today = dateStr();
  const now = new Date();
  const userRef = db.collection('users').doc(userId);

  const defaultGoals = {
    water_ml: 4000,
    steps: 10000,
    reading_pages: 10,
    gym_days_per_week: 5,
    study_minutes: 120,
    meditation_minutes: 10,
  };

  const goalsSnap = await userRef.collection('settings').doc('goals').get();
  const goals = goalsSnap.exists ? { ...defaultGoals, ...goalsSnap.data() } : defaultGoals;

  const todaySnap = await userRef.collection('daily_logs').doc(today).get();
  const todayLog = todaySnap.exists ? normalizeLog(todaySnap.data()) : normalizeLog({});

  const logsSnap = await userRef.collection('daily_logs').get();
  const allLogs = {};
  logsSnap.forEach(d => { allLogs[d.id] = normalizeLog(d.data()); });
  const histKeys = Object.keys(allLogs).sort();
  const hist30Keys = histKeys.slice(-30);
  const hist30 = hist30Keys.map(k => allLogs[k]);

  const moviesSnap = await userRef.collection('movies').get();
  const movies = [];
  moviesSnap.forEach(d => movies.push(normalizeMovie({ id: d.id, ...d.data() })));
  const moviesToday = movies.filter(m => m.watchDate === today && m.status === 'watched');

  const aerobicSnap = await userRef.collection('aerobic_sessions').get();
  const aerobic = [];
  aerobicSnap.forEach(d => aerobic.push(normalizeAerobic({ id: d.id, ...d.data() })));
  const aerobicToday = aerobic.filter(a => a.date === today);

  const last7Date = new Date(now);
  last7Date.setDate(now.getDate() - 6);
  const last7Keys = histKeys.filter(k => new Date(k) >= last7Date);
  const last7Logs = last7Keys.map(k => allLogs[k]);

  const weekStart = new Date(now);
  const dayOfWeek = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  const weekKeys = histKeys.filter(k => new Date(k) >= weekStart && new Date(k) <= now);
  const weekLogs = weekKeys.map(k => allLogs[k]);

  const prevWeekKeys = histKeys.filter(k => {
    const d = new Date(k);
    return d >= new Date(weekStart.getTime() - 7 * 86400000) && d < weekStart;
  });
  const prevWeekLogs = prevWeekKeys.map(k => allLogs[k]);

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthKeys = histKeys.filter(k => {
    const d = new Date(k);
    return d >= monthStart && d <= now;
  });
  const monthLogs = monthKeys.map(k => allLogs[k]);

  const prevMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
  const prevMonthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth(), 0);
  const prevMonthKeys = histKeys.filter(k => {
    const d = new Date(k);
    return d >= prevMonthStart && d <= prevMonthEnd;
  });
  const prevMonthLogs = prevMonthKeys.map(k => allLogs[k]);

  const sumMetrics = (rows, fn) => rows.reduce((sum, item) => sum + fn(item), 0);
  const last30Avg = {
    water_ml: avg(hist30.map(d => d.water_ml)),
    steps: avg(hist30.map(d => d.steps)),
    reading_pages: avg(hist30.map(d => d.reading_pages)),
    study_minutes: avg(hist30.map(d => d.study_minutes)),
    meditation_minutes: avg(hist30.map(d => d.meditation_minutes)),
  };

  const weekTotals = {
    water_ml: sumMetrics(weekLogs, d => d.water_ml),
    steps: sumMetrics(weekLogs, d => d.steps),
    reading_pages: sumMetrics(weekLogs, d => d.reading_pages),
    study_minutes: sumMetrics(weekLogs, d => d.study_minutes),
    meditation_minutes: sumMetrics(weekLogs, d => d.meditation_minutes),
    gym_days: weekLogs.filter(d => d.gym_done).length,
    creatine_days: weekLogs.filter(d => d.creatine_done).length,
  };

  const prevWeekTotals = {
    water_ml: sumMetrics(prevWeekLogs, d => d.water_ml),
    steps: sumMetrics(prevWeekLogs, d => d.steps),
    reading_pages: sumMetrics(prevWeekLogs, d => d.reading_pages),
    study_minutes: sumMetrics(prevWeekLogs, d => d.study_minutes),
    meditation_minutes: sumMetrics(prevWeekLogs, d => d.meditation_minutes),
    gym_days: prevWeekLogs.filter(d => d.gym_done).length,
    creatine_days: prevWeekLogs.filter(d => d.creatine_done).length,
  };

  const monthTotals = {
    water_ml: sumMetrics(monthLogs, d => d.water_ml),
    steps: sumMetrics(monthLogs, d => d.steps),
    reading_pages: sumMetrics(monthLogs, d => d.reading_pages),
    study_minutes: sumMetrics(monthLogs, d => d.study_minutes),
    meditation_minutes: sumMetrics(monthLogs, d => d.meditation_minutes),
    gym_days: monthLogs.filter(d => d.gym_done).length,
    creatine_days: monthLogs.filter(d => d.creatine_done).length,
  };

  const movieWeek = movies.filter(m => m.watchDate >= dateStr(weekStart) && m.watchDate <= today && m.status === 'watched').length;
  const moviePrevWeek = movies.filter(m => m.watchDate >= dateStr(new Date(weekStart.getTime() - 7 * 86400000)) && m.watchDate < dateStr(weekStart) && m.status === 'watched').length;
  const movieMonth = movies.filter(m => {
    const d = m.watchDate;
    return d >= dateStr(monthStart) && d <= today && m.status === 'watched';
  }).length;
  const moviePrevMonth = movies.filter(m => {
    const d = m.watchDate;
    return d >= dateStr(prevMonthStart) && d <= dateStr(prevMonthEnd) && m.status === 'watched';
  }).length;

  const aerobWeek = aerobic.filter(a => a.date >= dateStr(weekStart) && a.date <= today);
  const aerobPrevWeek = aerobic.filter(a => a.date >= dateStr(new Date(weekStart.getTime() - 7 * 86400000)) && a.date < dateStr(weekStart));
  const aerobMonth = aerobic.filter(a => a.date >= dateStr(monthStart) && a.date <= today);
  const aerobPrevMonth = aerobic.filter(a => a.date >= dateStr(prevMonthStart) && a.date <= dateStr(prevMonthEnd));

  const lastMovie = movies.filter(m => m.status === 'watched').sort((a, b) => b.watchDate.localeCompare(a.watchDate))[0];
  const lastAerobic = aerobic.sort((a, b) => b.date.localeCompare(a.date))[0];

  const parts = [];
  parts.push(`Relatório diário — ${today}`);
  parts.push('');
  parts.push('1. Resumo do dia');
  parts.push(`- Água: ${fmtW(todayLog.water_ml)} (${pct(todayLog.water_ml, goals.water_ml)}% da meta)`);
  parts.push(`- Passos: ${todayLog.steps ? fmtN(todayLog.steps) : '0'} (${pct(todayLog.steps, goals.steps)}% da meta)`);
  parts.push(`- Leitura: ${todayLog.reading_pages ?? 0} páginas (${pct(todayLog.reading_pages, goals.reading_pages)}% da meta)`);
  parts.push(`- Estudo: ${fmtT(todayLog.study_minutes)} (${pct(todayLog.study_minutes, goals.study_minutes)}% da meta)`);
  parts.push(`- Meditação: ${fmtT(todayLog.meditation_minutes)} (${pct(todayLog.meditation_minutes, goals.meditation_minutes)}% da meta)`);
  parts.push(`- Academia: ${todayLog.gym_done ? 'Sim' : 'Não'}`);
  parts.push(`- Creatina: ${todayLog.creatine_done ? 'Sim' : 'Não'}`);
  parts.push(`- Aeróbico: ${aerobicToday.length} ${aerobicToday.length === 1 ? 'sessão' : 'sessões'}`);
  parts.push('');
  parts.push('2. Comparação com a média dos últimos 30 dias');
  parts.push(`- Água: ${trendText(todayLog.water_ml, last30Avg.water_ml, (v) => fmtW(v))}`);
  parts.push(`- Passos: ${trendText(todayLog.steps, last30Avg.steps, fmtN)}`);
  parts.push(`- Leitura: ${trendText(todayLog.reading_pages, last30Avg.reading_pages, fmtN)}`);
  parts.push(`- Estudo: ${trendText(todayLog.study_minutes, last30Avg.study_minutes, fmtT)}`);
  parts.push(`- Meditação: ${trendText(todayLog.meditation_minutes, last30Avg.meditation_minutes, fmtT)}`);

  parts.push('');
  parts.push('3. Progresso das metas');
  parts.push(`- Água: ${progressBarText(todayLog.water_ml, goals.water_ml)}`);
  parts.push(`- Passos: ${progressBarText(todayLog.steps, goals.steps)}`);
  parts.push(`- Leitura: ${progressBarText(todayLog.reading_pages, goals.reading_pages)}`);
  parts.push(`- Estudo: ${progressBarText(todayLog.study_minutes, goals.study_minutes)}`);
  parts.push(`- Meditação: ${progressBarText(todayLog.meditation_minutes, goals.meditation_minutes)}`);

  parts.push('');
  parts.push('4. Semana atual');
  parts.push(`- Água: ${fmtW(weekTotals.water_ml)} / ${fmtW(goals.water_ml * weekLogs.length)} (${pct(weekTotals.water_ml, goals.water_ml * weekLogs.length)}% da meta parcial)`);
  parts.push(`- Passos: ${fmtN(weekTotals.steps)} / ${fmtN(goals.steps * weekLogs.length)} (${pct(weekTotals.steps, goals.steps * weekLogs.length)}%)`);
  parts.push(`- Leitura: ${fmtN(weekTotals.reading_pages)} páginas`);
  parts.push(`- Estudo: ${fmtT(weekTotals.study_minutes)}`);
  parts.push(`- Meditação: ${fmtT(weekTotals.meditation_minutes)}`);
  parts.push(`- Academia: ${weekTotals.gym_days} dia(s) (semana passada: ${prevWeekTotals.gym_days})`);
  parts.push(`- Creatina: ${weekTotals.creatine_days}/${weekLogs.length} dia(s) (semana passada: ${prevWeekTotals.creatine_days})`);
  parts.push(`- Aeróbico: ${aerobWeek.length} sessão(ões) (semana passada: ${aerobPrevWeek.length})`);

  parts.push('');
  parts.push('4. Mês atual');
  parts.push(`- Água: ${fmtW(monthTotals.water_ml)} / ${fmtW(goals.water_ml * monthLogs.length)} (${pct(monthTotals.water_ml, goals.water_ml * monthLogs.length)}%)`);
  parts.push(`- Passos: ${fmtN(monthTotals.steps)} / ${fmtN(goals.steps * monthLogs.length)} (${pct(monthTotals.steps, goals.steps * monthLogs.length)}%)`);
  parts.push(`- Leitura: ${fmtN(monthTotals.reading_pages)} páginas`);
  parts.push(`- Estudo: ${fmtT(monthTotals.study_minutes)}`);
  parts.push(`- Meditação: ${fmtT(monthTotals.meditation_minutes)}`);
  parts.push(`- Academia: ${monthTotals.gym_days} dia(s) neste mês`);
  parts.push(`- Creatina: ${monthTotals.creatine_days}/${monthLogs.length} dia(s) neste mês`);
  parts.push(`- Aeróbico: ${aerobMonth.length} sessão(ões) (mês anterior: ${aerobPrevMonth.length})`);

  if (lastAerobic) {
    parts.push('');
    parts.push(`5. Destaques`);
    parts.push(`- Última sessão aeróbica: ${lastAerobic.distance_km.toFixed(1)} km @ ${lastAerobic.avg_speed_kmh.toFixed(1)} km/h (${lastAerobic.date})`);
  }

  parts.push('');
  parts.push('6. Metas cadastradas');
  parts.push(`- Água/dia: ${fmtW(goals.water_ml)}`);
  parts.push(`- Passos/dia: ${fmtN(goals.steps)}`);
  parts.push(`- Leitura/dia: ${fmtN(goals.reading_pages)} páginas`);
  parts.push(`- Estudo/dia: ${fmtT(goals.study_minutes)}`);
  parts.push(`- Meditação/dia: ${fmtT(goals.meditation_minutes)}`);
  parts.push(`- Academia por semana: ${goals.gym_days_per_week} dia(s)`);

  const text = parts.join('\n');
  const waterBadge = badgeForPct(todayLog.water_ml, goals.water_ml);
  const stepsBadge = badgeForPct(todayLog.steps, goals.steps);
  const readBadge = badgeForPct(todayLog.reading_pages, goals.reading_pages);
  const studyBadge = badgeForPct(todayLog.study_minutes, goals.study_minutes);
  const meditateBadge = badgeForPct(todayLog.meditation_minutes, goals.meditation_minutes);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Relatório diário</title></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:20px;">
    <div style="width:100%;max-width:900px;margin:0 auto;background:#ffffff;padding:26px 28px;border-radius:24px;box-shadow:0 24px 70px rgba(15,23,42,0.12);border:1px solid #e2e8f0;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px;">
        <div>
          <p style="margin:0;font-size:0.92rem;color:#64748b;">Relatório diário</p>
          <h1 style="margin:6px 0 0;font-size:2rem;line-height:1.05;color:#0f172a;">${escapeHtml(today)}</h1>
        </div>
      </div>

      <p style="margin:0 0 24px;color:#475569;line-height:1.75;">Resumo do seu dia com comparações diretas ao histórico recente, metas e destaques.</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:22px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:18px;">
          <h2 style="margin:0 0 12px;font-size:1rem;color:#0f172a;">Resumo do dia</h2>
          <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.75;">
            <li>Água: <strong>${escapeHtml(fmtW(todayLog.water_ml))}</strong> ${waterBadge}</li>
            <li>Passos: <strong>${escapeHtml(fmtN(todayLog.steps))}</strong> ${stepsBadge}</li>
            <li>Leitura: <strong>${escapeHtml(fmtN(todayLog.reading_pages))} páginas</strong> ${readBadge}</li>
            <li>Estudo: <strong>${escapeHtml(fmtT(todayLog.study_minutes))}</strong> ${studyBadge}</li>
            <li>Meditação: <strong>${escapeHtml(fmtT(todayLog.meditation_minutes))}</strong> ${meditateBadge}</li>
          </ul>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:18px;">
          <h2 style="margin:0 0 12px;font-size:1rem;color:#0f172a;">Hábitos</h2>
          <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.75;">
            <li>Academia: <strong>${todayLog.gym_done ? 'Sim' : 'Não'}</strong></li>
            <li>Creatina: <strong>${todayLog.creatine_done ? 'Sim' : 'Não'}</strong></li>
            <li>Aeróbico: <strong>${escapeHtml(String(aerobicToday.length))}</strong></li>
          </ul>
        </div>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:18px 20px;margin-bottom:22px;">
        <h2 style="margin:0 0 12px;font-size:1rem;color:#0f172a;">Progresso de metas</h2>
        <table style="width:100%;border-collapse:collapse;color:#334155;font-size:0.95rem;">
          <thead>
            <tr>
              <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #dbeafe;">Métrica</th>
              <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #dbeafe;">Hoje</th>
              <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #dbeafe;">Meta</th>
              <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #dbeafe;">Progresso</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">Água</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtW(todayLog.water_ml))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtW(goals.water_ml))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${progressBarHtml(todayLog.water_ml, goals.water_ml)}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">Passos</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtN(todayLog.steps))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtN(goals.steps))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${progressBarHtml(todayLog.steps, goals.steps)}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">Leitura</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtN(todayLog.reading_pages))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtN(goals.reading_pages))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${progressBarHtml(todayLog.reading_pages, goals.reading_pages)}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">Estudo</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtT(todayLog.study_minutes))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtT(goals.study_minutes))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${progressBarHtml(todayLog.study_minutes, goals.study_minutes)}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">Meditação</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtT(todayLog.meditation_minutes))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;">${escapeHtml(fmtT(goals.meditation_minutes))}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">${progressBarHtml(todayLog.meditation_minutes, goals.meditation_minutes)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:18px 20px;margin-bottom:22px;">
        <h2 style="margin:0 0 12px;font-size:1rem;color:#0f172a;">Comparação com 30 dias</h2>
        <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.75;">
          <li>Água: ${escapeHtml(trendText(todayLog.water_ml, last30Avg.water_ml, (v) => fmtW(v)))}</li>
          <li>Passos: ${escapeHtml(trendText(todayLog.steps, last30Avg.steps, fmtN))}</li>
          <li>Leitura: ${escapeHtml(trendText(todayLog.reading_pages, last30Avg.reading_pages, fmtN))}</li>
          <li>Estudo: ${escapeHtml(trendText(todayLog.study_minutes, last30Avg.study_minutes, fmtT))}</li>
          <li>Meditação: ${escapeHtml(trendText(todayLog.meditation_minutes, last30Avg.meditation_minutes, fmtT))}</li>
        </ul>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:22px;">
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;">
          <h2 style="margin:0 0 12px;font-size:1rem;color:#0f172a;">Semana atual</h2>
          <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.75;">
            <li>Água: <strong>${escapeHtml(fmtW(weekTotals.water_ml))}</strong></li>
            <li>Passos: <strong>${escapeHtml(fmtN(weekTotals.steps))}</strong></li>
            <li>Leitura: <strong>${escapeHtml(fmtN(weekTotals.reading_pages))} páginas</strong></li>
            <li>Estudo: <strong>${escapeHtml(fmtT(weekTotals.study_minutes))}</strong></li>
            <li>Meditação: <strong>${escapeHtml(fmtT(weekTotals.meditation_minutes))}</strong></li>
            <li>Academia: <strong>${escapeHtml(String(weekTotals.gym_days))}</strong> (semana passada: <strong>${escapeHtml(String(prevWeekTotals.gym_days))}</strong>)</li>
          </ul>
        </div>
        <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;padding:18px;">
          <h2 style="margin:0 0 12px;font-size:1rem;color:#0f172a;">Mês atual</h2>
          <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.75;">
            <li>Água: <strong>${escapeHtml(fmtW(monthTotals.water_ml))}</strong></li>
            <li>Passos: <strong>${escapeHtml(fmtN(monthTotals.steps))}</strong></li>
            <li>Leitura: <strong>${escapeHtml(fmtN(monthTotals.reading_pages))} páginas</strong></li>
            <li>Estudo: <strong>${escapeHtml(fmtT(monthTotals.study_minutes))}</strong></li>
            <li>Meditação: <strong>${escapeHtml(fmtT(monthTotals.meditation_minutes))}</strong></li>
          </ul>
        </div>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:18px;padding:18px;margin-bottom:22px;">
        <h2 style="margin:0 0 12px;font-size:1rem;color:#0f172a;">Destaques</h2>
        <ul style="margin:0;padding-left:18px;color:#334155;line-height:1.75;">
          ${lastAerobic ? `<li>Última sessão aeróbica: <strong>${escapeHtml(lastAerobic.distance_km.toFixed(1))} km</strong> @ ${escapeHtml(lastAerobic.avg_speed_kmh.toFixed(1))} km/h</li>` : ''}
          <li>Aeróbico esta semana: <strong>${escapeHtml(String(aerobWeek.length))}</strong> sessões</li>
        </ul>
      </div>

      <div style="background:#eef2ff;border:1px solid #dbeafe;border-radius:18px;padding:18px;color:#0f172a;">
        <h2 style="margin:0 0 10px;font-size:1rem;">Metas</h2>
        <p style="margin:0;line-height:1.75;">
          Água/dia: <strong>${escapeHtml(fmtW(goals.water_ml))}</strong><br>
          Passos/dia: <strong>${escapeHtml(fmtN(goals.steps))}</strong><br>
          Leitura/dia: <strong>${escapeHtml(fmtN(goals.reading_pages))} páginas</strong><br>
          Estudo/dia: <strong>${escapeHtml(fmtT(goals.study_minutes))}</strong><br>
          Meditação/dia: <strong>${escapeHtml(fmtT(goals.meditation_minutes))}</strong><br>
          Academia/semana: <strong>${escapeHtml(String(goals.gym_days_per_week))}</strong> dias
        </p>
      </div>
    </div>
  </body></html>`;

  return {
    subject: `Relatório diário — ${today}`,
    text,
    html,
  };
}

async function sendReportNow() {
  if (!transporter) {
    console.error('[sendReport] SMTP transporter not configured. Aborting send.');
    return;
  }

  const targetUserEmail = TARGET_USER_EMAIL;
  const targetEmail = TARGET_EMAIL;
  let userId = REPORT_USER_ID;

  if (userId) {
    console.log(`[sendReport] Usando REPORT_USER_ID=${userId}`);
  } else {
    userId = await findUserIdByEmail(targetUserEmail);
  }

  if (!userId) {
    console.error(`[sendReport] Não achei usuário para email ${targetUserEmail}. Defina REPORT_USER_ID ou crie um doc users/{uid} com o email.`);
    return;
  }

  const summary = await buildSummaryForUser(userId);

  const info = await transporter.sendMail({
    from: EMAIL_FROM || 'no-reply@example.com',
    to: targetEmail,
    subject: summary.subject,
    text: summary.text,
    html: summary.html,
  });

  console.log('[sendReport] email enviado:', info.messageId);
}

// Schedule at 12:00 every day
cron.schedule('0 12 * * *', () => {
  console.log('[sendReport] Agendador disparou — tentando enviar relatório');
  sendReportNow().catch(err => console.error('[sendReport] erro', err));
});

console.log('[sendReport] Agendador iniciado. Envia todo dia ao meio-dia.');

// Also allow manual immediate run via argument
if (process.argv.includes('--now')) {
  sendReportNow().catch(err => console.error(err));
}
