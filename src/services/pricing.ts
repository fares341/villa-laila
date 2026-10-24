import type { Q } from '@/lib/db';
import { eachNight } from '@/lib/dates';
import { BookingError } from './errors';

export type NightLine = { date: string; unitPriceCents: number; rate: string };
export type Quote = { nights: number; units: number; lines: NightLine[]; perUnitCents: number; totalCents: number; demo: boolean };

/**
 * Rate for one room type on one calendar date. The owner's rates (Rooms, beds & prices) decide: a dated (seasonal)
 * rate wins over the base rate. Old daily rates imported from Little Hotelier are only used for a date that has no
 * rate of our own. Never multiplies one night's price across other dates.
 */
export async function dayRate(c: Q, roomTypeId: string, date: string): Promise<{ cents: number; name: string; source: 'little_hotelier' | 'local_rate'; demo: boolean } | null> {
  const r = await c.query(
    `SELECT price_cents, name, is_demo FROM rates WHERE room_type_id=$1 AND valid_during @> $2::date ORDER BY priority DESC, price_cents ASC LIMIT 1`,
    [roomTypeId, date]);
  if (r.rows[0]) return { cents: Number(r.rows[0].price_cents), name: r.rows[0].name, source: 'local_rate', demo: !!r.rows[0].is_demo };
  const ch = await c.query(`SELECT rate_cents, source FROM channel_daily_rates WHERE room_type_id=$1 AND rate_date=$2::date`, [roomTypeId, date]);
  if (ch.rows[0]) return { cents: Number(ch.rows[0].rate_cents), name: 'Imported daily rate', source: 'little_hotelier', demo: false };
  return null;
}

/** Price every night with the highest-priority matching rate. Never guesses: a missing rate is an error. */
export async function quote(c: Q, roomTypeId: string, checkIn: string, checkOut: string, units: number): Promise<Quote> {
  const nights = eachNight(checkIn, checkOut);
  const lines: NightLine[] = [];
  let demo = false;
  for (const d of nights) {
    const r = await dayRate(c, roomTypeId, d);
    if (!r) throw new BookingError('NO_RATE', `No rate configured for ${d}`);
    if (r.demo) demo = true;
    lines.push({ date: d, unitPriceCents: r.cents, rate: r.name });
  }
  const perUnit = lines.reduce((s, l) => s + l.unitPriceCents, 0);
  return { nights: nights.length, units, lines, perUnitCents: perUnit, totalCents: perUnit * units, demo };
}
