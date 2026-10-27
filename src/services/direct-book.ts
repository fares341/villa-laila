import { q } from '@/lib/db';
import { addDays, todayLocal } from '@/lib/dates';
import { setSetting } from './settings';

/**
 * Prices from the hostel's own booking engine (Little Hotelier's direct-book.com page). The lh-reader service opens
 * the public page for one night at a time, reads each room's price and whether it can be booked, and keeps them in
 * direct_prices. Read-only: it never selects a room or fills the form.
 *
 *   DIRECT_BOOK_URL        default https://direct-book.com/properties/laylahostel
 *   DIRECT_BOOK_DAYS       how many nights ahead are kept fresh (default 90)
 */
export const DIRECT_BOOK_URL = () => (process.env.DIRECT_BOOK_URL || 'https://direct-book.com/properties/laylahostel').replace(/\?.*$/, '');

/** Room names on direct-book → our room type codes. */
const ROOMS: Record<string, string> = {
  '10 bed mixed dormitory': 'mixed-dorm-10',
  'spacious 8-bed female dormitory': 'female-dorm-8',
  '8 bed male dormitory': 'male-dorm-8',
  'spacious 8-bed male dormitory': 'male-dorm-8-pool',
  '6 bed female dormitory': 'female-dorm-6',
  'golden room': 'golden-room', 'triple': 'triple', 'folklore': 'folklore', 'sheherazade': 'sheherazade',
  'violet': 'violet', 'islamic': 'islamic', 'amira': 'amira', 'ibn battuta': 'ibn-battuta', 'french lady': 'french-lady', 'mamluk': 'mamluk',
};
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export function roomCodeFor(name: string): string | null {
  const n = norm(name);
  if (ROOMS[n]) return ROOMS[n];
  const slug = n.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return Object.values(ROOMS).includes(slug) ? slug : null;
}

export function directBookUrl(checkIn: string, checkOut: string, adults = 1, currency = 'USD') {
  const u = new URL(DIRECT_BOOK_URL());
  u.searchParams.set('locale', 'en');
  u.searchParams.set('items[0][adults]', String(adults));
  u.searchParams.set('items[0][children]', '0');
  u.searchParams.set('items[0][infants]', '0');
  u.searchParams.set('currency', currency);
  u.searchParams.set('checkInDate', checkIn);
  u.searchParams.set('checkOutDate', checkOut);
  u.searchParams.set('trackPage', 'no');
  return u.toString();
}

export type DirectRoom = { name: string; code: string | null; available: boolean; priceCents: number | null; currency: string; rate: string | null; cancellation: string | null; deposit: string | null };

/**
 * Reads the room list out of the page text. Each room has a "skip past <name> carousel" line, then either its
 * rate(s) with a price ("USD 18.00") or "… are unavailable". The cheapest rate of a room is kept.
 */
export function parseDirectBook(text: string): DirectRoom[] {
  const t = text.replace(/\r/g, '');
  const end = t.search(/\nBooking summary\b/);
  const body = end > 0 ? t.slice(0, end) : t;
  const re = /skip past (.+?) carousel[^\n]*\n/g;
  const marks: { name: string; start: number; idx: number }[] = [];
  for (let m; (m = re.exec(body));) marks.push({ name: m[1].trim(), start: m.index + m[0].length, idx: m.index });
  const out: DirectRoom[] = [];
  marks.forEach((mk, i) => {
    const seg = body.slice(mk.start, i + 1 < marks.length ? marks[i + 1].idx : body.length);
    const lines = seg.split('\n').map((l) => l.trim()).filter(Boolean);
    const prices = [...seg.matchAll(/\b(USD|EUR|EGP|GBP)\s?([\d,]+(?:\.\d+)?)/g)].map((p) => ({ cur: p[1], cents: Math.round(Number(p[2].replace(/,/g, '')) * 100) })).filter((p) => p.cents > 0);
    const unavailable = /are unavailable|not available|sold out/i.test(seg) && !prices.length;
    const best = prices.sort((a, b) => a.cents - b.cents)[0];
    out.push({
      name: mk.name, code: roomCodeFor(mk.name), available: !unavailable && !!best,
      priceCents: best?.cents ?? null, currency: best?.cur ?? 'USD',
      rate: !unavailable ? lines.find((l) => !/^skip to|^more info|^select$/i.test(l) && !/cancell|deposit/i.test(l)) ?? null : null,
      cancellation: lines.find((l) => /cancell|refundable/i.test(l)) ?? null,
      deposit: lines.find((l) => /deposit/i.test(l)) ?? null,
    });
  });
  // The same room listed twice (two rates in separate blocks): keep the cheapest.
  const byName = new Map<string, DirectRoom>();
  for (const r of out) {
    const p = byName.get(r.name);
    if (!p || (r.available && (!p.available || (r.priceCents ?? Infinity) < (p.priceCents ?? Infinity)))) byName.set(r.name, r);
  }
  return [...byName.values()];
}

/** Reads one night from the booking engine page. */
export async function readDirectNight(page: any, date: string): Promise<DirectRoom[]> {
  await page.goto(directBookUrl(date, addDays(date, 1)), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => /Cost for|are unavailable|Booking summary/.test(document.body?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const text: string = await page.locator('main').first().innerText({ timeout: 10000 }).catch(async () => page.evaluate(() => document.body.innerText));
  return parseDirectBook(text);
}

export async function saveNight(date: string, rooms: DirectRoom[]) {
  for (const r of rooms) {
    if (!r.code) continue;
    await q(`INSERT INTO direct_prices(stay_date,room_code,room_name,available,price_cents,currency,rate_name,cancellation,deposit,checked_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
             ON CONFLICT (stay_date,room_code) DO UPDATE SET room_name=EXCLUDED.room_name, available=EXCLUDED.available,
               price_cents=COALESCE(EXCLUDED.price_cents, direct_prices.price_cents), currency=EXCLUDED.currency, rate_name=EXCLUDED.rate_name,
               cancellation=EXCLUDED.cancellation, deposit=EXCLUDED.deposit, checked_at=now()`,
      [date, r.code, r.name, r.available, r.priceCents, r.currency, r.rate, r.cancellation, r.deposit]);
  }
}

/**
 * One pass: refreshes the nights that are due — the next 14 nights every run, later nights twice a day — at most
 * `max` pages per pass so the reader stays light.
 */
export async function readDirectBook(page: any, log: (m: string) => void, max = 24) {
  const days = Math.min(365, Math.max(14, Number(process.env.DIRECT_BOOK_DAYS || 90)));
  const today = todayLocal();
  const seen = new Map((await q<{ d: string; at: string }>(`SELECT stay_date::text d, min(checked_at)::text at FROM direct_prices WHERE stay_date >= $1 GROUP BY 1`, [today])).map((r) => [r.d, Date.parse(r.at)]));
  const due: { d: string; never: boolean }[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const at = seen.get(d);
    if (at == null || Date.now() - at > (i < 14 ? 50 * 60_000 : 12 * 3600_000)) due.push({ d, never: at == null });
  }
  // Never-read nights first, then the nearest.
  due.sort((a, b) => Number(b.never) - Number(a.never) || a.d.localeCompare(b.d));
  let ok = 0; const errors: string[] = [];
  for (const { d } of due.slice(0, max)) {
    try {
      const rooms = await readDirectNight(page, d);
      if (!rooms.length) { errors.push(`${d}: no rooms on the page`); continue; }
      await saveNight(d, rooms);
      ok++;
      const unknown = rooms.filter((r) => !r.code).map((r) => r.name);
      if (unknown.length) errors.push(`${d}: unknown room ${unknown.join(', ')}`);
    } catch (e) { errors.push(`${d}: ${(e as Error).message.slice(0, 100)}`); }
  }
  if (ok || errors.length) {
    log(`direct-book: ${ok} night(s) read${errors.length ? ` · ${errors.slice(0, 3).join(' | ')}` : ''}`);
    await setSetting('direct_book_status', { at: new Date().toISOString(), read: ok, due: due.length, errors: errors.slice(0, 10) });
  }
  return { read: ok, due: due.length, errors };
}

/** Fresh direct-book prices (read in the last 2 days) for one night, by room code. */
export async function directPricesFor(date: string): Promise<Record<string, { available: boolean; priceCents: number | null; currency: string; cancellation: string | null; deposit: string | null }>> {
  const rows = await q<any>(`SELECT room_code, available, price_cents, currency, cancellation, deposit FROM direct_prices WHERE stay_date=$1 AND checked_at > now() - interval '2 days'`, [date]).catch(() => []);
  return Object.fromEntries(rows.map((r: any) => [r.room_code, { available: r.available, priceCents: r.price_cents == null ? null : Number(r.price_cents), currency: r.currency, cancellation: r.cancellation, deposit: r.deposit }]));
}

/**
 * Prices for the home page room cards (whole units, the currency they were read in), by room code: the booking
 * engine first; Hostelworld (cached) for any room the booking engine has nothing fresh for.
 */
export async function homeRoomPrices(date: string) {
  const { readCachedRates, syncHostelworldData, getDefaultRates } = await import('./hostelworld-sync');
  let hw = readCachedRates()?.rooms;
  if (!hw) hw = await syncHostelworldData({ dateStart: date, currency: 'USD' }).then((r) => r.rooms).catch(() => getDefaultRates().rooms);
  const direct = await directPricesFor(date);
  const out: Record<string, { price: number; currency: string; available: boolean; bedsAvailable: number | null; status: 'available' | 'few_left' | 'sold_out'; source: string }> = {};
  for (const [code, h] of Object.entries(hw ?? {})) out[code] = { price: h.price, currency: h.currency || 'USD', available: h.available, bedsAvailable: h.bedsAvailable, status: h.status, source: 'hostelworld' };
  for (const [code, r] of Object.entries(direct)) {
    out[code] = {
      price: r.priceCents != null ? Math.round(r.priceCents / 100) : out[code]?.price ?? 0, currency: r.priceCents != null ? r.currency : out[code]?.currency ?? 'USD',
      available: r.available, bedsAvailable: null, status: r.available ? 'available' : 'sold_out', source: 'direct_book',
    };
  }
  return out;
}
