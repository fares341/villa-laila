import { randomInt } from 'node:crypto';
import { q, tx } from '@/lib/db';
import type { Q } from '@/lib/db';
import { upcomingDates, isBookableDate, type Schedule } from '@/lib/event-dates';
import { BookingError } from './errors';
import { audit } from './audit';
import { paymobEnabled } from './paymob';
import { instapayEnabled } from './instapay';

export type Loc = { en?: string; ar?: string; [k: string]: string | undefined };
export type EventOption = { key: string; en: string; ar: string };
export type PayMethod = 'paymob' | 'instapay' | 'cash';

export type EventRow = Schedule & {
  id: string; slug: string; title: Loc; summary: Loc; description: Loc; includes: Loc[]; image: string | null;
  price_cents: number; guest_price_cents: number | null; currency: string;
  capacity: number | null; options: EventOption[]; pay_methods: PayMethod[]; note: Loc; active: boolean; sort_order: number;
};

export type PublicEvent = EventRow & { dates: string[]; nextDate: string | null; methods: PayMethod[] };

export const tr = (v: Loc | null | undefined, lang: string) => (v ? v[lang] || v.en || v.ar || '' : '');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeTicketCode = () => 'EV-' + Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** Payment methods this event accepts that are actually switched on right now. */
export function liveMethods(ev: Pick<EventRow, 'pay_methods' | 'currency'>): PayMethod[] {
  return ev.pay_methods.filter((m) => (m === 'paymob' ? paymobEnabled(ev.currency) : m === 'instapay' ? instapayEnabled(ev.currency) : true));
}

function toPublic(e: EventRow, now = new Date()): PublicEvent {
  const dates = upcomingDates(e, 30, now);
  return { ...e, dates, nextDate: dates[0] ?? null, methods: liveMethods(e) };
}

/** Active events that still have a date coming up, soonest first. Never throws (site keeps working if the table is missing). */
export async function listPublicEvents(): Promise<PublicEvent[]> {
  try {
    const rows = await q<EventRow>('SELECT * FROM events WHERE active ORDER BY sort_order, slug');
    return rows.map((r) => toPublic(r)).filter((e) => e.nextDate).sort((a, b) => (a.nextDate! < b.nextDate! ? -1 : a.nextDate! > b.nextDate! ? 1 : a.sort_order - b.sort_order));
  } catch (e) {
    console.error('[events] list failed', (e as Error).message);
    return [];
  }
}

export async function getPublicEvent(slug: string): Promise<PublicEvent | null> {
  const r = (await q<EventRow>('SELECT * FROM events WHERE slug=$1 AND active', [slug]))[0];
  return r ? toPublic(r) : null;
}

const HELD = `(status IN ('paid','pending_verification','pay_on_site') OR (status='awaiting_payment' AND (hold_expires_at IS NULL OR hold_expires_at > now())))`;

export async function seatsTaken(c: Q, eventId: string, date: string): Promise<number> {
  const r = await c.query(`SELECT COALESCE(sum(quantity),0)::int n FROM event_bookings WHERE event_id=$1 AND event_date=$2 AND ${HELD}`, [eventId, date]);
  return r.rows[0].n as number;
}

/** Seats left per date (null = unlimited). */
export async function seatsLeft(ev: PublicEvent): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  if (ev.capacity == null) { for (const d of ev.dates) out[d] = null; return out; }
  const rows = await q<{ event_date: string; n: number }>(
    `SELECT event_date, COALESCE(sum(quantity),0)::int n FROM event_bookings WHERE event_id=$1 AND event_date = ANY($2::date[]) AND ${HELD} GROUP BY event_date`,
    [ev.id, ev.dates]);
  const taken = new Map(rows.map((r) => [r.event_date, r.n]));
  for (const d of ev.dates) out[d] = Math.max(0, ev.capacity - (taken.get(d) ?? 0));
  return out;
}

export type EventBookingInput = {
  slug: string; date: string; quantity: number; optionKey?: string | null;
  isHotelGuest?: boolean; stayReference?: string | null;
  fullName: string; email: string; phone?: string | null; language: string; payMethod: PayMethod;
};

const HOLD_MIN: Record<PayMethod, number | null> = { paymob: 30, instapay: 12 * 60, cash: null };

export async function createEventBooking(input: EventBookingInput) {
  const qty = Math.trunc(input.quantity);
  if (!(qty >= 1 && qty <= 20)) throw new BookingError('INVALID_INPUT', 'quantity');
  if (!input.fullName?.trim() || input.fullName.trim().length < 2) throw new BookingError('INVALID_INPUT', 'name');
  if (!/^\S+@\S+\.\S+$/.test(input.email || '')) throw new BookingError('INVALID_INPUT', 'email');

  return tx(async (c) => {
    const ev = (await c.query('SELECT * FROM events WHERE slug=$1 AND active', [input.slug])).rows[0] as EventRow | undefined;
    if (!ev) throw new BookingError('NOT_FOUND', 'event');
    if (!isBookableDate(ev, input.date)) throw new BookingError('INVALID_DATES');
    if (!liveMethods(ev).includes(input.payMethod)) throw new BookingError('INVALID_INPUT', 'pay_method');

    let optionKey: string | null = null;
    if (ev.options.length) {
      const opt = ev.options.find((o) => o.key === input.optionKey);
      if (!opt) throw new BookingError('INVALID_INPUT', 'option');
      optionKey = opt.key;
    }

    // Guest price only for a real stay reference that covers the event date.
    let unit = ev.price_cents;
    let isGuest = false;
    let stayRef: string | null = null;
    if (input.isHotelGuest && ev.guest_price_cents != null) {
      stayRef = (input.stayReference || '').trim().toUpperCase();
      const stay = (await c.query(
        `SELECT 1 FROM reservations WHERE reference=$1 AND status IN ('pending','confirmed','checked_in') AND check_in <= $2::date AND check_out >= $2::date`,
        [stayRef, input.date])).rows[0];
      if (!stay) throw new BookingError('INVALID_INPUT', 'stay_reference');
      unit = ev.guest_price_cents;
      isGuest = true;
    }

    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['ev:' + ev.id + ':' + input.date]);
    if (ev.capacity != null) {
      const taken = await seatsTaken(c as unknown as Q, ev.id, input.date);
      if (taken + qty > ev.capacity) throw new BookingError('NO_AVAILABILITY');
    }

    const total = unit * qty;
    const status = input.payMethod === 'cash' || total === 0 ? 'pay_on_site' : 'awaiting_payment';
    const holdMin = status === 'awaiting_payment' ? HOLD_MIN[input.payMethod] : null;
    let code = makeTicketCode();
    for (let i = 0; i < 5; i++) {
      const dup = (await c.query('SELECT 1 FROM event_bookings WHERE ticket_code=$1', [code])).rows[0];
      if (!dup) break;
      code = makeTicketCode();
    }
    const row = (await c.query(
      `INSERT INTO event_bookings(ticket_code,event_id,event_date,quantity,option_key,is_hotel_guest,stay_reference,full_name,email,phone,language,
         unit_price_cents,total_cents,currency,pay_method,status,hold_expires_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, CASE WHEN $17::int IS NULL THEN NULL ELSE now() + make_interval(mins => $17::int) END)
       RETURNING *`,
      [code, ev.id, input.date, qty, optionKey, isGuest, stayRef, input.fullName.trim(), input.email.trim(), input.phone?.trim() || null, input.language,
        unit, total, ev.currency, input.payMethod, status, holdMin])).rows[0];
    await audit('website', 'event_booking.create', 'event_booking', row.id, { code, slug: ev.slug, date: input.date, qty, total, method: input.payMethod }, c as unknown as Q);
    return { booking: row, event: ev };
  });
}

export type TicketView = {
  booking: any; event: EventRow;
};

export async function getTicket(code: string): Promise<TicketView | null> {
  const b = (await q<any>('SELECT * FROM event_bookings WHERE ticket_code=$1', [code.toUpperCase()]))[0];
  if (!b) return null;
  // Release an unpaid hold that ran out.
  if (b.status === 'awaiting_payment' && b.hold_expires_at && new Date(b.hold_expires_at) < new Date()) {
    await q(`UPDATE event_bookings SET status='expired', updated_at=now() WHERE id=$1 AND status='awaiting_payment'`, [b.id]);
    b.status = 'expired';
  }
  const ev = (await q<EventRow>('SELECT * FROM events WHERE id=$1', [b.event_id]))[0];
  return { booking: b, event: ev };
}

/** Ticket is valid at the door when paid, or reserved to pay cash there. */
export const ticketValid = (status: string) => status === 'paid' || status === 'pay_on_site';

/* ───────── staff actions ───────── */

export async function markEventBookingPaid(bookingId: string, actor: string, note?: string) {
  const r = await q(`UPDATE event_bookings SET status='paid', paid_at=now(), hold_expires_at=NULL, staff_note=COALESCE($2,staff_note), updated_at=now()
                     WHERE id=$1 AND status IN ('awaiting_payment','pending_verification','pay_on_site','expired') RETURNING id`, [bookingId, note ?? null]);
  if (!r.length) throw new BookingError('BAD_STATE');
  await audit(actor, 'event_booking.paid', 'event_booking', bookingId, { note });
}

export async function checkInTicket(bookingId: string, actor: string) {
  const r = await q(`UPDATE event_bookings SET checked_in_at=now(), updated_at=now() WHERE id=$1 AND status IN ('paid','pay_on_site') AND checked_in_at IS NULL RETURNING id`, [bookingId]);
  if (!r.length) throw new BookingError('BAD_STATE', 'Ticket is not valid or already used');
  await audit(actor, 'event_booking.checkin', 'event_booking', bookingId);
}

export async function cancelEventBooking(bookingId: string, actor: string) {
  const r = await q(`UPDATE event_bookings SET status='cancelled', updated_at=now() WHERE id=$1 AND status <> 'cancelled' RETURNING id`, [bookingId]);
  if (!r.length) throw new BookingError('BAD_STATE');
  await audit(actor, 'event_booking.cancel', 'event_booking', bookingId);
}

export async function updateEventSettings(eventId: string, v: { priceCents: number; guestPriceCents: number | null; capacity: number | null; active: boolean }, actor: string) {
  await q(`UPDATE events SET price_cents=$2, guest_price_cents=$3, capacity=$4, active=$5, updated_at=now() WHERE id=$1`, [eventId, v.priceCents, v.guestPriceCents, v.capacity, v.active]);
  await audit(actor, 'event.update', 'event', eventId, v);
}
