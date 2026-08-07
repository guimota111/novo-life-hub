import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '../../../../lib/email';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const to = body?.to ?? process.env.ADMIN_EMAIL;
    const subject = body?.subject ?? 'Report';
    const text = body?.text ?? body?.message ?? '';
    const html = body?.html;

    if (!to) return NextResponse.json({ error: 'destinatário ausente' }, { status: 400 });
    if (!text && !html) return NextResponse.json({ error: 'conteúdo da mensagem ausente' }, { status: 400 });

    const info = await sendEmail(to, subject, text, html);
    return NextResponse.json({ ok: true, messageId: info.messageId });
  } catch (err: any) {
    console.error('[email/send]', err);
    return NextResponse.json({ error: 'Erro ao enviar e-mail' }, { status: 500 });
  }
}
