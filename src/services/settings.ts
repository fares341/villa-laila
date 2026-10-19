import { q } from '@/lib/db';
import type { Q } from '@/lib/db';

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
  staff_notify_telegram: true,
};

export async function getSetting<T = any>(key: string, c?: Q): Promise<T> {
  const rows = c ? (await c.query('SELECT value FROM settings WHERE key=$1', [key])).rows : await q('SELECT value FROM settings WHERE key=$1', [key]);
  return (rows[0] ? rows[0].value : DEFAULTS[key]) as T;
}
export async function setSetting(key: string, value: unknown) {
  await q('INSERT INTO settings(key,value,updated_at) VALUES($1,$2,now()) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [key, JSON.stringify(value)]);
}
export const localized = (v: any, lang: string): string | null => (v && (v[lang] ?? null)) || null;

/** Hostel facts with defaults filled in for any field the owner has not saved yet. */
export async function hostelInfo(): Promise<Record<string, string | null>> {
  return { ...(DEFAULTS.hostel as any), ...((await getSetting<any>('hostel')) ?? {}) };
}
