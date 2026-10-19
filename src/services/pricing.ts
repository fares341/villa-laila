import type { Q } from '@/lib/db';
import { eachNight } from '@/lib/dates';
import { BookingError } from './errors';

export type NightLine = { date: string; unitPriceCents: number; rate: string };
export type Quote = { nights: number; units: number; lines: NightLine[]; perUnitCents: number; totalCents: number; demo: boolean };

/** Price every night with the highest-priority matching rate. Never guesses: a missing rate is an error. */
export async function quote(c: Q, roomTypeId: string, checkIn: string, checkOut: string, units: number): Promise<Quote> {
  const nights = eachNight(checkIn, checkOut);
  const lines: NightLine[] = [];
  let demo = false;
  for (const d of nights) {
    const r = await c.query(
      `SELECT price_cents, name, is_demo FROM rates WHERE room_type_id=$1 AND valid_during @> $2::date ORDER BY priority DESC, price_cents ASC LIMIT 1`,
      [roomTypeId, d]);
    if (!r.rows[0]) throw new BookingError('NO_RATE', `No rate configured for ${d}`);
    if (r.rows[0].is_demo) demo = true;
    lines.push({ date: d, unitPriceCents: r.rows[0].price_cents, rate: r.rows[0].name });
  }
  const perUnit = lines.reduce((s, l) => s + l.unitPriceCents, 0);
  return { nights: nights.length, units, lines, perUnitCents: perUnit, totalCents: perUnit * units, demo };
}
