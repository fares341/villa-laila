import tls from 'node:tls';
import net from 'node:net';
import { randomUUID } from 'node:crypto';

/**
 * Small SMTP sender (no extra packages). Settings from .env:
 *   SMTP_HOST=smtp.hostinger.com  SMTP_PORT=465  SMTP_USER=bookings@villalaylahostel.com  SMTP_PASS=…  MAIL_FROM="Villa Layla <bookings@villalaylahostel.com>"
 * Port 465 = TLS from the start; 587 (or 25) = plain then STARTTLS.
 * Not set → nothing is sent (mailEnabled() is false) and callers just skip it.
 */
export const mailEnabled = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

type Mail = { to: string[]; subject: string; text: string; html?: string; replyTo?: string | null };

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const encHeader = (s: string) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const wrap76 = (s: string) => s.replace(/.{1,76}/g, '$&\r\n');
const addr = (s: string) => (s.match(/<([^>]+)>/)?.[1] ?? s).trim();

export async function sendMail(m: Mail): Promise<void> {
  if (!mailEnabled()) return;
  const to = m.to.filter((x) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x));
  if (!to.length) return;
  const host = process.env.SMTP_HOST!, port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER!, pass = process.env.SMTP_PASS!;
  const from = process.env.MAIL_FROM || user;
  const fromName = from.includes('<') ? from.slice(0, from.indexOf('<')).trim().replace(/^"|"$/g, '') : '';
  const domain = addr(from).split('@')[1] || 'localhost';

  const boundary = 'b' + randomUUID().replace(/-/g, '');
  const headers = [
    `From: ${fromName ? `${encHeader(fromName)} <${addr(from)}>` : addr(from)}`,
    `To: ${to.join(', ')}`,
    m.replyTo ? `Reply-To: ${m.replyTo}` : '',
    `Subject: ${encHeader(m.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
  ].filter(Boolean);
  const body = m.html
    ? [`Content-Type: multipart/alternative; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(m.text)),
      `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(m.html)),
      `--${boundary}--`, ''].join('\r\n')
    : ['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(b64(m.text))].join('\r\n');
  const data = headers.join('\r\n') + '\r\n' + body;

  let sock: net.Socket | tls.TLSSocket = port === 465
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
  sock.setTimeout(20_000);

  // Reads one SMTP reply (handles multi-line "250-" replies).
  let buf = '';
  let waiter: ((line: string) => void) | null = null;
  const onData = (d: Buffer) => {
    buf += d.toString('utf8');
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i])) { const w = waiter; waiter = null; buf = lines.slice(i + 1).join('\r\n'); w?.(lines.slice(0, i + 1).join('\n')); return; }
    }
  };
  const attach = (s: net.Socket) => { s.on('data', onData); };
  attach(sock);
  const fail = new Promise<never>((_, rej) => {
    const bad = (e: unknown) => rej(e instanceof Error ? e : new Error(String(e)));
    sock.on('error', bad); sock.on('timeout', () => bad(new Error('SMTP timeout')));
  });
  fail.catch(() => {});
  const reply = () => Promise.race([new Promise<string>((res) => { waiter = res; onData(Buffer.alloc(0)); }), fail]);
  const cmd = async (line: string | null, ok: number[]) => {
    if (line !== null) sock.write(line + '\r\n');
    const r = await reply();
    if (!ok.includes(Number(r.slice(-999).match(/(\d{3}) [^\n]*$/)?.[1]))) throw new Error(`SMTP ${line?.split(' ')[0] ?? 'greeting'}: ${r.split('\n').pop()}`);
    return r;
  };

  try {
    await cmd(null, [220]);
    let ehlo = await cmd(`EHLO ${domain}`, [250]);
    if (port !== 465 && /STARTTLS/i.test(ehlo)) {
      await cmd('STARTTLS', [220]);
      sock.removeListener('data', onData);
      sock = tls.connect({ socket: sock as net.Socket, servername: host });
      attach(sock);
      await new Promise<void>((res, rej) => { (sock as tls.TLSSocket).once('secureConnect', () => res()); sock.once('error', rej); });
      ehlo = await cmd(`EHLO ${domain}`, [250]);
    }
    await cmd('AUTH LOGIN', [334]);
    await cmd(b64(user), [334]);
    await cmd(b64(pass), [235]);
    await cmd(`MAIL FROM:<${addr(from)}>`, [250]);
    for (const r of to) await cmd(`RCPT TO:<${r}>`, [250, 251]);
    await cmd('DATA', [354]);
    await cmd(data.replace(/\r\n\./g, '\r\n..') + '\r\n.', [250]);
    sock.write('QUIT\r\n');
  } finally {
    sock.end();
  }
}
