import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

interface MetricEntry {
  date: string;
  qty: number;
}

interface Metric {
  name: string;
  units: string;
  data: MetricEntry[];
}

interface HealthPayload {
  data?: {
    metrics?: Metric[];
  };
  metrics?: Metric[];
}

function parseDateStr(raw: string): string {
  return raw.split(' ')[0].split('T')[0];
}

async function resolveUserId(token: string | null): Promise<string | null> {
  if (!token) return null;
  const snap = await adminDb
    .collection('health_tokens')
    .where('token', '==', token)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].data().userId as string;
}

function extractMetrics(body: HealthPayload): Metric[] {
  // V2: { data: { metrics: [...] } }
  if (Array.isArray(body?.data?.metrics)) return body.data!.metrics!;
  // Flat: { metrics: [...] }
  if (Array.isArray(body?.metrics)) return body.metrics!;
  // Array directly: [{ name, units, data }]
  if (Array.isArray(body)) return body as unknown as Metric[];
  return [];
}

async function processAndWrite(userId: string, metrics: Metric[]): Promise<number> {
  const byDate: Record<string, Record<string, number>> = {};

  for (const metric of metrics) {
    for (const entry of metric.data ?? []) {
      const date = parseDateStr(entry.date);
      if (!byDate[date]) byDate[date] = {};

      if (metric.name === 'step_count') {
        byDate[date].steps = Math.round(entry.qty);
      } else if (metric.name === 'walking_running_distance') {
        let km = entry.qty;
        if (metric.units === 'mi') km = km * 1.60934;
        byDate[date].walking_distance_km = Math.round(km * 100) / 100;
      }
    }
  }

  const entries = Object.entries(byDate).filter(([, fields]) => Object.keys(fields).length > 0);
  if (entries.length === 0) return 0;

  // Read existing docs to avoid overwriting larger values with incremental sync data
  const logsRef = adminDb.collection('users').doc(userId).collection('daily_logs');
  const existingSnaps = await Promise.all(entries.map(([date]) => logsRef.doc(date).get()));
  const existing: Record<string, Record<string, number>> = {};
  existingSnaps.forEach(snap => {
    if (snap.exists) existing[snap.id] = snap.data() as Record<string, number>;
  });

  let count = 0;
  for (let i = 0; i < entries.length; i += 499) {
    const batch = adminDb.batch();
    let hasWrites = false;
    for (const [date, fields] of entries.slice(i, i + 499)) {
      const prev = existing[date] ?? {};
      const toWrite: Record<string, number> = {};
      for (const [field, value] of Object.entries(fields)) {
        if ((prev[field] ?? 0) < value) toWrite[field] = value;
      }
      if (Object.keys(toWrite).length > 0) {
        batch.set(logsRef.doc(date), toWrite, { merge: true });
        hasWrites = true;
        count++;
      }
    }
    if (hasWrites) await batch.commit();
  }

  return count;
}

// Health Auto Export probes with GET before sending POST data
export async function GET(request: NextRequest) {
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  console.log('[health/import GET] params:', JSON.stringify(params));
  return NextResponse.json({ ok: true, params }, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');
    console.log('[health/import POST] token present:', !!token);
    console.log('[health/import POST] content-type:', request.headers.get('content-type'));

    const userId = await resolveUserId(token);
    if (!userId) {
      console.log('[health/import POST] token invalid or missing');
      return NextResponse.json({ error: token ? 'Token inválido' : 'Token ausente' }, { status: token ? 401 : 400 });
    }

    let body: HealthPayload;
    try {
      body = await request.json();
    } catch (e) {
      console.error('[health/import POST] JSON parse error:', e);
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    const topKeys = Object.keys(body ?? {});
    console.log('[health/import POST] top-level keys:', JSON.stringify(topKeys));

    const metrics = extractMetrics(body);
    console.log('[health/import POST] metrics count:', metrics.length);
    if (metrics.length > 0) {
      console.log('[health/import POST] metric names:', JSON.stringify(metrics.map(m => m.name)));
      console.log('[health/import POST] first metric sample:', JSON.stringify(metrics[0]).slice(0, 300));
    } else {
      console.log('[health/import POST] raw body sample:', JSON.stringify(body).slice(0, 500));
    }

    const count = await processAndWrite(userId, metrics);

    console.log('[health/import POST] done, datesProcessed:', count);

    return NextResponse.json({
      success: true,
      datesProcessed: count,
      message: `✅ ${count} dias importados`,
    });
  } catch (err) {
    console.error('[health/import POST] unhandled error:', err);
    return NextResponse.json(
      { error: 'Erro interno', detail: String(err) },
      { status: 500 }
    );
  }
}
