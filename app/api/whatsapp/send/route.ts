import { NextRequest, NextResponse } from 'next/server';
import { sendWhatsApp } from '../../../../lib/twilio';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const to = body?.to ?? process.env.ADMIN_WHATSAPP_NUMBER;
    const message = body?.message ?? body?.text ?? '';

    if (!to) return NextResponse.json({ error: 'destinatário ausente' }, { status: 400 });
    if (!message) return NextResponse.json({ error: 'mensagem vazia' }, { status: 400 });

    const resp = await sendWhatsApp(to, message);
    return NextResponse.json({ ok: true, sid: resp.sid });
  } catch (err: any) {
    console.error('[whatsapp/send]', err);
    return NextResponse.json({ error: 'Erro ao enviar mensagem' }, { status: 500 });
  }
}
