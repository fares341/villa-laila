import { q } from '@/lib/db';
import type { Q } from '@/lib/db';
import { POLICY_TEXT, type PolicyKey } from '@/content/policies';

export const DEFAULTS: Record<string, unknown> = {
  currency: 'EGP',
  max_nights: 60,
  pending_hold_hours: 48,          // how long a website/bot request keeps beds blocked while awaiting staff
  temp_hold_minutes: 60,           // staff "temporary hold"
  confirm_requires_deposit_cents: 0, // 0 = staff may confirm without a verified payment. OWNER TO DECIDE.
  // From the hostel's own website (villalaylahostel.com, 2026-10-14); check-in/out times from its Hostelworld listing.
  hostel: { name: 'Villa Layla Hostel', city: 'Cairo, Egypt', phone: '+20 104 055 1515', email: 'hostel.layla@gmail.com', whatsapp: '+201040551515',
    address: '20 Safiya Zaghloul St, Al Inshaa Wa Al Munirah, El Sayeda Zeinab, Cairo 4262101, Egypt', map_url: 'https://maps.app.goo.gl/H7YGjCVT7nshDExj9',
    checkin_time: '15:00', checkout_time: '11:00', front_desk: '08:00–22:00', breakfast: '08:00–11:00', instagram: 'https://instagram.com/villalaylacairo' },
  // Per-language text. null = NOT YET PROVIDED BY OWNER. The bot/site will say reception will advise instead of inventing it.
  payment_instructions: { en: null, es: null, fr: null, ar: null },
  cancellation_policy: { en: null, es: null, fr: null, ar: null },
  house_rules: { en: null, es: null, fr: null, ar: null },
  booking_howto: { en: null, es: null, fr: null, ar: null },
  privacy_policy: { en: null, es: null, fr: null, ar: null },
  // The villa's WhatsApp community (shown next to «Events» on the website).
  whatsapp_community: 'https://chat.whatsapp.com/J6jCghuH4DJ5Lzyqeu3jdU',
  staff_notify_telegram: true,
};

export async function getSetting<T = any>(key: string, c?: Q): Promise<T> {
  const rows = c ? (await c.query('SELECT value FROM settings WHERE key=$1', [key])).rows : await q('SELECT value FROM settings WHERE key=$1', [key]);
  return (rows[0] ? rows[0].value : DEFAULTS[key]) as T;
}
export async function setSetting(key: string, value: unknown) {
  await q('INSERT INTO settings(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [key, JSON.stringify(value)]);
}
/** A policy text in a language: the one saved in Settings, else the owner's text (src/content/policies.ts), else English. */
export async function policyText(key: PolicyKey, lang: string): Promise<string | null> {
  const v = (await getSetting<any>(key).catch(() => null)) ?? {};
  const d = POLICY_TEXT[key] as Record<string, string>;
  return v[lang] || d[lang] || v.en || d.en || null;
}
/** A WhatsApp group / community invite link, or null when it doesn't look like one. */
export const waGroupLink = (raw: unknown): string | null => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return /^https:\/\/(chat\.whatsapp\.com|whatsapp\.com\/channel|wa\.me)\/\S+$/i.test(u) ? u.slice(0, 300) : null;
};
/** The villa's WhatsApp community link ('' in Settings = hidden). */
export async function communityLink(): Promise<string | null> {
  const v = await getSetting<string | null>('whatsapp_community').catch(() => DEFAULTS.whatsapp_community as string);
  return waGroupLink(v);
}
export const localized = (v: any, lang: string): string | null => (v && (v[lang] ?? null)) || null;

/** Hostel facts with defaults filled in for any field the owner has not saved yet. */
export async function hostelInfo(): Promise<Record<string, string | null>> {
  return { ...(DEFAULTS.hostel as any), ...((await getSetting<any>('hostel')) ?? {}) };
}
