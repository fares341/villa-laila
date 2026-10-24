import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { tx, q } from '@/lib/db';
import type { Q } from '@/lib/db';
import { validateStay, rangeStr, todayLocal, nightsBetween } from '@/lib/dates';
import { BookingError } from './errors';
import { pushAvailability } from './pms/channel';
import { freeUnits, pickUnits } from './availability';
import { quote } from './pricing';
import { upsertGuest, type GuestInput } from './guests';
import { activeRules, evaluate, type Facts } from './policy';
import { getSetting } from './settings';
import { audit } from './audit';
import { cancelFollowups } from './followups';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeRef = () => 'VL-' + Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

export type CreateInput = {
  guest: GuestInput;
  roomTypeId: string; checkIn: string; checkOut: string; guestsCount: number;
  source: 'website' | 'telegram' | 'staff' | 'import' | 'walk_in' | 'channel';
  status: 'hold' | 'pending' | 'confirmed';
  guestNotes?: string; staffNotes?: string; createdBy?: string | null; actor: string;
  facts?: Facts;            // policy facts, e.g. { nationality: 'EG' }
  skipPastCheck?: boolean;  // import of historic data only
  unitIds?: string[];       // front desk: put the guest in these exact beds/rooms (must be free and of this type)
  staffEntered?: boolean;   // typed in by staff (e.g. a direct booking filed under "website"): house rules flag it for review instead of refusing
};

/** Release inventory of holds/pending requests whose time ran out. Safe to call repeatedly. */
export async function sweepExpired(c: Q): Promise<string[]> {
  const r = await c.query(
    `UPDATE reservations SET status='expired', updated_at=now()
     WHERE status IN ('hold','pending') AND hold_expires_at IS NOT NULL AND hold_expires_at < now() RETURNING id`);
  const ids = r.rows.map((x: any) => x.id as string);
  if (ids.length) {
    await c.query('UPDATE reservation_units SET active=false WHERE reservation_id = ANY($1::uuid[])', [ids]);
    for (const id of ids) await c.query(`INSERT INTO reservation_events(reservation_id,actor,action) VALUES($1,'system','expired')`, [id]);
  }
  return ids;
}

async function lockType(c: Q, roomTypeId: string) {
  // Serialises concurrent bookings of the same room type. The exclusion constraint remains the hard backstop.
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['rt:' + roomTypeId]);
}

export async function createReservation(input: CreateInput) {
  const res = await createReservationCore(input);
  // Website / staff bookings that are confirmed straight away take the room off Little Hotelier. Walk-ins push their own stop-sell.
  if (res.status === 'confirmed' && input.source !== 'walk_in') await channelPush(res.id, -1, 'reservation.create');
  return res;
}

async function createReservationCore(input: CreateInput) {
  const maxNights = await getSetting<number>('max_nights');
  const today = todayLocal();
  if (!input.skipPastCheck) {
    const v = validateStay(input.checkIn, input.checkOut, today, maxNights);
    if (!v.ok) throw new BookingError(v.code === 'past' ? 'PAST_DATE' : v.code === 'too_long' ? 'TOO_LONG' : 'INVALID_DATES');
  }
  if (!Number.isInteger(input.guestsCount) || input.guestsCount < 1 || input.guestsCount > 40) throw new BookingError('INVALID_INPUT', 'guests');
  if (!input.guest.fullName?.trim()) throw new BookingError('INVALID_INPUT', 'name');

  const rules = await activeRules();

  const holdHours = await getSetting<number>('pending_hold_hours');
  const holdMin = await getSetting<number>('temp_hold_minutes');

  try {
    return await tx(async (c) => {
      const cq = c as unknown as Q;
      await sweepExpired(cq);
      const t = (await c.query('SELECT * FROM room_types WHERE id=$1', [input.roomTypeId])).rows[0];
      if (!t) throw new BookingError('NOT_FOUND', 'room type');
      if (!t.active) throw new BookingError('ROOM_TYPE_INACTIVE');
      await lockType(cq, input.roomTypeId);
      const policy = evaluate(rules, { ...(input.facts ?? {}), nationality: input.facts?.nationality ?? input.guest.nationality ?? undefined, room_kind: t.kind, room_gender: t.gender });
      // Guest-facing channels are refused outright; staff-created bookings are allowed but flagged for review.
      if (policy.blocked) {
        if (['website', 'telegram', 'whatsapp'].includes(input.source) && !input.staffEntered) throw new BookingError('POLICY_BLOCKED', policy.blocked.name, policy.blocked.message);
        policy.needsReview = true; policy.reasons.push(`Blocked by rule "${policy.blocked.name}" (staff override)`);
      }

      const free = await freeUnits(cq, input.roomTypeId, input.checkIn, input.checkOut);
      let picked = pickUnits(t.kind, free, input.guestsCount);
      if (input.unitIds?.length) {
        const chosen = input.unitIds.map((id) => free.find((u) => u.id === id));
        if (chosen.some((u) => !u)) throw new BookingError('NO_AVAILABILITY', 'That bed/room is not free for these dates');
        // Dorm party bigger than the beds picked: add more free beds, same room first.
        if (t.kind === 'dorm' && chosen.length < input.guestsCount) {
          const rest = free.filter((u) => !chosen.some((x) => x!.id === u.id)).sort((a, b) => Number(b.room_id === chosen[0]!.room_id) - Number(a.room_id === chosen[0]!.room_id));
          chosen.push(...rest.slice(0, input.guestsCount - chosen.length));
        }
        const cap = chosen.reduce((s2, u) => s2 + (t.kind === 'dorm' ? 1 : u!.capacity), 0);
        if (cap < input.guestsCount) throw new BookingError('CONFLICT', 'Not enough beds/capacity in the chosen units');
        let left = input.guestsCount;
        picked = chosen.map((u) => { const g = t.kind === 'dorm' ? 1 : Math.min(u!.capacity, left); left -= g; return { unit: u!, guests: Math.max(1, g) }; });
      }
      if (!picked) throw new BookingError('NO_AVAILABILITY');
      const qt = await quote(cq, input.roomTypeId, input.checkIn, input.checkOut, picked.length);

      const guestId = await upsertGuest(cq, input.guest);
      const expiresAt = input.status === 'confirmed' ? null : new Date(Date.now() + (input.status === 'hold' ? holdMin * 60_000 : holdHours * 3_600_000));
      const currency = await getSetting<string>('currency', cq);

      let reservation: any;
      for (let attempt = 0; attempt < 5; attempt++) {
        const ref = makeRef();
        await c.query('SAVEPOINT ref');
        try {
          const r = await c.query(
            `INSERT INTO reservations(reference,guest_id,room_type_id,check_in,check_out,guests_count,source,status,hold_expires_at,total_cents,currency,price_breakdown,policy_version,policy_outcome,needs_review,review_reason,staff_notes,guest_notes,created_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
            [ref, guestId, input.roomTypeId, input.checkIn, input.checkOut, input.guestsCount, input.source, input.status, expiresAt, qt.totalCents, currency, JSON.stringify(qt.lines), policy.version, JSON.stringify(policy), policy.needsReview, policy.reasons.join('; ') || null, input.staffNotes ?? null, input.guestNotes ?? null, input.createdBy ?? null]);
          reservation = r.rows[0];
          await c.query('RELEASE SAVEPOINT ref');
          break;
        } catch (e: any) {
          await c.query('ROLLBACK TO SAVEPOINT ref');
          if (e.code !== '23505') throw e;
        }
      }
      if (!reservation) throw new Error('could not allocate reference');

      for (const p of picked) {
        await c.query('INSERT INTO reservation_units(reservation_id,unit_id,during,guests) VALUES($1,$2,$3::daterange,$4)', [reservation.id, p.unit.id, rangeStr(input.checkIn, input.checkOut), p.guests]);
      }
      await c.query('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [reservation.id, input.actor, 'created:' + input.status, JSON.stringify({ source: input.source, units: picked.map((p) => p.unit.label) })]);
      await audit(input.actor, 'reservation.create', 'reservation', reservation.id, { reference: reservation.reference, status: input.status }, cq);

      if (input.status === 'pending' || reservation.needs_review) {
        await c.query(
          `INSERT INTO tasks(title,detail,kind,reservation_id,dedupe_key) VALUES($1,$2,'review_booking',$3,$4) ON CONFLICT (dedupe_key) DO NOTHING`,
          [`Review booking request ${reservation.reference}`, reservation.review_reason ?? 'New booking request awaiting confirmation', reservation.id, 'review:' + reservation.id]);
      }
      return reservation as { id: string; reference: string; status: string; total_cents: number; needs_review: boolean; guest_id: string; hold_expires_at: string | null; currency: string };
    });
  } catch (e: any) {
    if (e?.code === '23P01') throw new BookingError('NO_AVAILABILITY', 'Overlapping reservation for the same bed/room');
    throw e;
  }
}

async function lockReservation(c: PoolClient, id: string) {
  const r = (await c.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!r) throw new BookingError('NOT_FOUND', 'reservation');
  return r;
}

export async function verifiedPaid(c: Q, reservationId: string): Promise<number> {
  const r = await c.query(`SELECT COALESCE(SUM(amount_cents),0)::bigint s FROM payments WHERE reservation_id=$1 AND status='verified'`, [reservationId]);
  return Number(r.rows[0].s);
}

export async function confirmReservation(id: string, actor: string, staffUserId: string | null) {
  const out = await tx(async (c) => {
    const cq = c as unknown as Q;
    const r = await lockReservation(c, id);
    await lockType(cq, r.room_type_id);
    if (r.status === 'expired') {
      // Staff may try to reinstate an expired request; the DB constraint decides if the beds are still free.
      try { await c.query('UPDATE reservation_units SET active=true WHERE reservation_id=$1', [id]); }
      catch (e: any) { if (e.code === '23P01') throw new BookingError('NO_AVAILABILITY', 'Those beds were taken after the request expired'); throw e; }
    } else if (!['hold', 'pending'].includes(r.status)) {
      throw new BookingError('BAD_STATE', `Cannot confirm a ${r.status} reservation`);
    }
    const deposit = await getSetting<number>('confirm_requires_deposit_cents', cq);
    if (deposit > 0 && (await verifiedPaid(cq, id)) < Math.min(deposit, r.total_cents)) throw new BookingError('PAYMENT_REQUIRED', 'A verified payment is required before confirming');
    const outcome = { ...(r.policy_outcome ?? {}), reviewedBy: actor, reviewedAt: new Date().toISOString() };
    await c.query(`UPDATE reservations SET status='confirmed', hold_expires_at=NULL, needs_review=false, policy_outcome=$2, updated_at=now() WHERE id=$1`, [id, JSON.stringify(outcome)]);
    await c.query(`UPDATE tasks SET status='done', completed_at=now() WHERE reservation_id=$1 AND kind='review_booking' AND status='open'`, [id]);
    await c.query('INSERT INTO reservation_events(reservation_id,actor,action) VALUES($1,$2,$3)', [id, actor, 'confirmed']);
    await audit(actor, 'reservation.confirm', 'reservation', id, {}, cq);
    return r;
  }).catch((e: any) => { if (e?.code === '23P01') throw new BookingError('NO_AVAILABILITY'); throw e; });
  await cancelFollowups({ reservationId: id, kinds: ['pending_reminder', 'staff_unreviewed', 'payment_followup_pending'] });
  await channelPush(id, -1, 'reservation.confirm');
  return out;
}

/** Tell Little Hotelier that this stay's rooms are taken (-1) or free again (+1). Never throws. */
async function channelPush(reservationId: string, sign: 1 | -1, reason: string, prior?: { room_type_id: string; check_in: string; check_out: string; units: number }) {
  try {
    const r = prior ?? (await q<any>(`SELECT room_type_id, check_in, check_out, (SELECT count(*)::int FROM reservation_units WHERE reservation_id=$1 AND active) units FROM reservations WHERE id=$1`, [reservationId]))[0];
    if (!r || !r.units) return;
    const today = todayLocal();
    const from = sign > 0 && r.check_in < today ? today : r.check_in;
    if (from >= r.check_out) return;
    await pushAvailability(null, { roomTypeId: r.room_type_id, from, to: r.check_out, delta: sign * r.units, reason });
  } catch (e) { console.error('[channel push]', (e as Error).message); }
}

async function end(id: string, status: 'cancelled' | 'rejected' | 'no_show', reason: string | null, actor: string) {
  const prior = await tx(async (c) => {
    const cq = c as unknown as Q;
    const r = await lockReservation(c, id);
    r.units = (await c.query('SELECT count(*)::int n FROM reservation_units WHERE reservation_id=$1 AND active', [id])).rows[0].n;
    if (['cancelled', 'rejected', 'checked_out', 'expired'].includes(r.status)) throw new BookingError('BAD_STATE', `Already ${r.status}`);
    if (r.status === 'checked_in') throw new BookingError('BAD_STATE', 'The guest is in house. Use Check out (the folio settles the nights and the room goes to housekeeping).');
    if (status === 'rejected' && !['hold', 'pending'].includes(r.status)) throw new BookingError('BAD_STATE', 'Only requests can be rejected; cancel instead');
    await c.query('UPDATE reservation_units SET active=false WHERE reservation_id=$1', [id]);
    await c.query('UPDATE reservations SET status=$2, cancelled_reason=$3, hold_expires_at=NULL, needs_review=false, updated_at=now() WHERE id=$1', [id, status, reason]);
    await c.query(`UPDATE tasks SET status='dismissed', completed_at=now() WHERE reservation_id=$1 AND status='open' AND kind IN ('review_booking','extension')`, [id]);
    await c.query(`UPDATE extension_requests SET status='cancelled' WHERE reservation_id=$1 AND status IN ('pending','conflict')`, [id]);
    const paid = await verifiedPaid(cq, id);
    if (paid > 0) {
      await c.query(`INSERT INTO tasks(title,detail,kind,reservation_id,dedupe_key) VALUES($1,$2,'payment',$3,$4) ON CONFLICT (dedupe_key) DO NOTHING`,
        [`Refund decision needed for ${r.reference}`, `${paid / 100} ${r.currency} verified payments exist on a ${status} reservation. Decide refund per cancellation policy.`, id, 'refund:' + id]);
    }
    await c.query('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [id, actor, status, JSON.stringify({ reason })]);
    await audit(actor, 'reservation.' + status, 'reservation', id, { reason }, cq);
    return r;
  });
  await cancelFollowups({ reservationId: id });
  if (['confirmed', 'checked_in'].includes(prior.status)) await channelPush(id, 1, 'reservation.' + status, prior);
}
export const cancelReservation = (id: string, reason: string | null, actor: string) => end(id, 'cancelled', reason, actor);
export const rejectReservation = (id: string, reason: string | null, actor: string) => end(id, 'rejected', reason, actor);
export const markNoShow = (id: string, actor: string) => end(id, 'no_show', null, actor);

export async function checkIn(id: string, actor: string) {
  await tx(async (c) => {
    const r = await lockReservation(c, id);
    if (r.status !== 'confirmed') throw new BookingError('BAD_STATE', 'Only confirmed reservations can be checked in');
    if (r.check_in > todayLocal()) throw new BookingError('BAD_STATE', 'Check-in date has not arrived yet');
    await c.query(`UPDATE reservations SET status='checked_in', updated_at=now() WHERE id=$1`, [id]);
    await c.query('INSERT INTO reservation_events(reservation_id,actor,action) VALUES($1,$2,$3)', [id, actor, 'checked_in']);
    await audit(actor, 'reservation.check_in', 'reservation', id, {}, c as unknown as Q);
  });
}
export async function checkOut(id: string, actor: string) {
  await tx(async (c) => {
    const r = await lockReservation(c, id);
    if (r.status !== 'checked_in') throw new BookingError('BAD_STATE', 'Only checked-in reservations can be checked out');
    await c.query(`UPDATE reservations SET status='checked_out', updated_at=now() WHERE id=$1`, [id]);
    await c.query('INSERT INTO reservation_events(reservation_id,actor,action) VALUES($1,$2,$3)', [id, actor, 'checked_out']);
    await audit(actor, 'reservation.check_out', 'reservation', id, {}, c as unknown as Q);
  });
  await cancelFollowups({ reservationId: id });
}

/** Change dates on a live reservation (calendar drag / edit form). The DB constraint validates every unit. */
export async function changeStay(id: string, newIn: string, newOut: string, actor: string) {
  const maxNights = await getSetting<number>('max_nights');
  const v = validateStay(newIn, newOut, '0000-01-01', maxNights);
  if (!v.ok) throw new BookingError('INVALID_DATES');
  try {
    return await tx(async (c) => {
      const cq = c as unknown as Q;
      const r = await lockReservation(c, id);
      if (!['hold', 'pending', 'confirmed', 'checked_in'].includes(r.status)) throw new BookingError('BAD_STATE', `Cannot change a ${r.status} reservation`);
      await lockType(cq, r.room_type_id);
      const blocked = await c.query('SELECT 1 FROM reservation_units ru JOIN unit_blocks b ON b.unit_id=ru.unit_id AND b.during && $2::daterange WHERE ru.reservation_id=$1 AND ru.active LIMIT 1', [id, rangeStr(newIn, newOut)]);
      if (blocked.rows[0]) throw new BookingError('CONFLICT', 'A unit is blocked for maintenance in that period');
      // A stay can be split over two beds after a room move. Only the first segment's start and the last
      // segment's end follow the new dates; the move date in between stays where it is.
      const segs = (await c.query(`SELECT id, lower(during)::text lo, upper(during)::text hi FROM reservation_units WHERE reservation_id=$1 AND active`, [id])).rows;
      for (const s of segs) {
        const lo = s.lo === r.check_in ? newIn : s.lo, hi = s.hi === r.check_out ? newOut : s.hi;
        if (lo >= hi) throw new BookingError('CONFLICT', 'These dates cut across a room move. Move the guest back to one bed first, then change the dates.');
        await c.query('UPDATE reservation_units SET during=$2::daterange WHERE id=$1', [s.id, rangeStr(lo, hi)]);
      }
      const unitCount = segs.filter((s: any) => s.hi === r.check_out).length || 1;
      const qt = await quote(cq, r.room_type_id, newIn, newOut, unitCount);
      // Nights already booked keep the price they were booked at; only new nights take today's rate.
      const old = new Map<string, any>((r.price_breakdown ?? []).map((l: any) => [l.date, l]));
      const lines = qt.lines.map((l) => old.get(l.date) ?? l);
      const total = lines.reduce((a: number, l: any) => a + Number(l.unitPriceCents), 0) * unitCount;
      await c.query('UPDATE reservations SET check_in=$2, check_out=$3, total_cents=$4, price_breakdown=$5, updated_at=now() WHERE id=$1', [id, newIn, newOut, total, JSON.stringify(lines)]);
      qt.totalCents = total;
      await c.query('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [id, actor, 'dates_changed', JSON.stringify({ from: [r.check_in, r.check_out], to: [newIn, newOut], oldTotal: r.total_cents, newTotal: qt.totalCents })]);
      await audit(actor, 'reservation.change_dates', 'reservation', id, { newIn, newOut }, cq);
      return { totalCents: qt.totalCents, nights: nightsBetween(newIn, newOut) };
    });
  } catch (e: any) {
    if (e?.code === '23P01') throw new BookingError('NO_AVAILABILITY', 'Those dates overlap another reservation for the same bed/room');
    throw e;
  }
}

/** Move one allocation to another bed/room of the SAME room type (keeps pricing consistent). */
export async function reassignUnit(reservationUnitId: string, newUnitId: string, actor: string) {
  try {
    await tx(async (c) => {
      const cq = c as unknown as Q;
      const ru = (await c.query('SELECT ru.*, r.room_type_id, r.status FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id WHERE ru.id=$1 FOR UPDATE OF ru', [reservationUnitId])).rows[0];
      if (!ru) throw new BookingError('NOT_FOUND');
      if (!['hold', 'pending', 'confirmed', 'checked_in'].includes(ru.status)) throw new BookingError('BAD_STATE');
      const nu = (await c.query('SELECT u.*, r.room_type_id FROM units u JOIN rooms r ON r.id=u.room_id WHERE u.id=$1 AND u.active', [newUnitId])).rows[0];
      if (!nu) throw new BookingError('NOT_FOUND', 'unit');
      if (nu.room_type_id !== ru.room_type_id) throw new BookingError('CONFLICT', 'Bed must be in the same room type');
      if (nu.capacity < ru.guests) throw new BookingError('CONFLICT', 'Capacity too small');
      await lockType(cq, ru.room_type_id);
      const b = await c.query('SELECT 1 FROM unit_blocks WHERE unit_id=$1 AND during && $2::daterange LIMIT 1', [newUnitId, ru.during]);
      if (b.rows[0]) throw new BookingError('CONFLICT', 'Target is blocked for maintenance');
      await c.query('UPDATE reservation_units SET unit_id=$2 WHERE id=$1', [reservationUnitId, newUnitId]);
      await c.query('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [ru.reservation_id, actor, 'unit_reassigned', JSON.stringify({ from: ru.unit_id, to: newUnitId })]);
      await audit(actor, 'reservation.reassign', 'reservation', ru.reservation_id, { from: ru.unit_id, to: newUnitId }, cq);
    });
  } catch (e: any) {
    if (e?.code === '23P01') throw new BookingError('NO_AVAILABILITY', 'That bed is already taken for these dates');
    throw e;
  }
}

export async function addNote(id: string, note: string, actor: string) {
  await q(`UPDATE reservations SET staff_notes = CASE WHEN staff_notes IS NULL OR staff_notes='' THEN $2 ELSE staff_notes || E'\\n' || $2 END, updated_at=now() WHERE id=$1`, [id, `[${new Date().toISOString().slice(0, 16)} ${actor}] ${note}`]);
  await q('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [id, actor, 'note', JSON.stringify({ note })]);
}
