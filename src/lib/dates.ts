// Dates are handled as plain 'YYYY-MM-DD' strings (calendar days in the hostel's timezone).
// Stays are half-open [check_in, check_out): the checkout day itself is free for the next guest.
import { env } from './env';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function todayLocal(now: Date = new Date(), tz = env.tz): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut + 'T00:00:00Z') - Date.parse(checkIn + 'T00:00:00Z')) / 86400000);
}

export function eachNight(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) out.push(d);
  return out;
}

export function rangeStr(a: string, b: string) { return `[${a},${b})`; }

/** Parse a Postgres daterange text like "[2026-10-14,2026-10-16)" */
export function parseRange(r: string): { from: string; to: string } {
  const m = /^[\[(](\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})[\])]$/.exec(r);
  if (!m) throw new Error('bad range ' + r);
  return { from: m[1], to: m[2] };
}

export type DateCheck = { ok: true } | { ok: false; code: 'invalid' | 'order' | 'past' | 'too_long' };
export function validateStay(checkIn: unknown, checkOut: unknown, today = todayLocal(), maxNights = 60): DateCheck {
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) return { ok: false, code: 'invalid' };
  if (checkOut <= checkIn) return { ok: false, code: 'order' };
  if (checkIn < today) return { ok: false, code: 'past' };
  if (nightsBetween(checkIn, checkOut) > maxNights) return { ok: false, code: 'too_long' };
  return { ok: true };
}

/** Convert a local wall-clock time in `tz` (e.g. 2026-11-15 08:00 Africa/Cairo) to a UTC Date, DST-aware. */
export function zonedToUtc(dateIso: string, hhmm: string, tz = env.tz): Date {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess - (asLocal - guess));
}
