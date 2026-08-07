import Twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. 'whatsapp:+1415....'

if (!accountSid || !authToken || !from) {
  // Defer throwing until runtime use so other server code can still load in dev
  console.warn('[lib/twilio] missing TWILIO env vars');
}

let client: ReturnType<typeof Twilio> | null = null;
if (accountSid && authToken) {
  client = Twilio(accountSid, authToken);
}

export async function sendWhatsApp(to: string, body: string) {
  if (!client) throw new Error('Twilio client not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN');
  if (!from) throw new Error('TWILIO_WHATSAPP_FROM not set');
  const toNumber = to.startsWith('whatsapp:') ? to.replace('whatsapp:', '') : to;
  return client.messages.create({ from, to: `whatsapp:${toNumber}`, body });
}

export default client;
