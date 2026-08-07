import nodemailer from 'nodemailer';

const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const fromAddress = process.env.EMAIL_FROM;

let transporter: nodemailer.Transporter | null = null;

if (smtpHost && smtpPort && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465, // true for 465, false for other ports
    auth: { user: smtpUser, pass: smtpPass },
  });
} else {
  console.warn('[lib/email] SMTP not fully configured; set SMTP_HOST/PORT/USER/PASS');
}

export async function sendEmail(to: string, subject: string, text?: string, html?: string) {
  if (!transporter) throw new Error('SMTP transporter not configured');
  if (!fromAddress) throw new Error('EMAIL_FROM not set in env');

  const info = await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    text,
    html,
  });

  return info;
}

export default transporter;
