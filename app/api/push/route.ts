import { NextRequest, NextResponse } from 'next/server';
import webpush from 'web-push';

export async function POST(req: NextRequest) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  try {
    const { subscription, title, body, url } = await req.json();

    if (!subscription?.endpoint) {
      return NextResponse.json({ error: 'subscription inválida' }, { status: 400 });
    }

    await webpush.sendNotification(
      subscription,
      JSON.stringify({ title, body, url: url ?? '/recordes' }),
    );

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    // 410 = subscription expired / unsubscribed
    if (err?.statusCode === 410) {
      return NextResponse.json({ error: 'subscription expirada', expired: true }, { status: 410 });
    }
    console.error('[push]', err);
    return NextResponse.json({ error: 'Erro ao enviar notificação' }, { status: 500 });
  }
}
