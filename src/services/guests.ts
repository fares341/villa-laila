import type { Q } from '@/lib/db';

export type GuestInput = { fullName: string; email?: string | null; phone?: string | null; nationality?: string | null; language?: string; telegramChatId?: number | null };

export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  let s = p.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  // Egyptian local mobile numbers 01xxxxxxxxx -> +201xxxxxxxxx
  if (/^01\d{9}$/.test(s)) s = '+20' + s.slice(1);
  return /^\+?\d{6,15}$/.test(s) ? s : null;
}

export async function upsertGuest(c: Q, g: GuestInput): Promise<string> {
  const phone = normalizePhone(g.phone);
  const email = g.email?.trim().toLowerCase() || null;
  let id: string | undefined;
  if (g.telegramChatId) id = (await c.query('SELECT id FROM guests WHERE telegram_chat_id=$1', [g.telegramChatId])).rows[0]?.id;
  if (!id && email) id = (await c.query('SELECT id FROM guests WHERE lower(email)=$1 LIMIT 1', [email])).rows[0]?.id;
  if (!id && phone) id = (await c.query('SELECT id FROM guests WHERE phone=$1 LIMIT 1', [phone])).rows[0]?.id;
  if (id) {
    await c.query(
      `UPDATE guests SET full_name=COALESCE(NULLIF($2,''),full_name), email=COALESCE($3,email), phone=COALESCE($4,phone),
        nationality=COALESCE($5,nationality), language=COALESCE($6,language), telegram_chat_id=COALESCE($7,telegram_chat_id), updated_at=now() WHERE id=$1`,
      [id, g.fullName, email, phone, g.nationality ?? null, g.language ?? null, g.telegramChatId ?? null]);
    return id;
  }
  const r = await c.query(
    'INSERT INTO guests(full_name,email,phone,nationality,language,telegram_chat_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
    [g.fullName, email, phone, g.nationality ?? null, g.language ?? 'en', g.telegramChatId ?? null]);
  return r.rows[0].id;
}
