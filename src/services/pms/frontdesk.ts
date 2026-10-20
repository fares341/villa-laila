import { q, tx, pool } from '@/lib/db';
import type { Q } from '@/lib/db';
import { todayLocal, addDays, parseRange, rangeStr, isIsoDate } from '@/lib/dates';
import { BookingError } from '../errors';
import { audit } from '../audit';
import { confirmReservation, checkIn as coreCheckIn, createReservation } from '../reservations';
import { freeUnits } from '../availability';
import { postStayNights, voidRoomNights, getFolio } from './folio';
import { pushAvailability } from './channel';
import { dayRate } from '../pricing';

/* ───────── Movement cockpit ───────── */

const ROOMS_OF = `(SELECT string_agg(DISTINCT rm.name || CASE WHEN t2.kind='dorm' THEN ' · ' || u.label ELSE '' END, ', ')
   FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id JOIN room_types t2 ON t2.id=rm.room_type_id
   WHERE ru.reservation_id=r.id AND ru.active)`;

export async function cockpit(date = todayLocal()) {
  const base = `SELECT r.id, r.reference, r.status, r.check_in, r.check_out, r.guests_count, r.source, r.total_cents, r.currency, r.checked_in_at,
      g.full_name, g.phone, t.name AS type_name, t.kind, ${ROOMS_OF} AS rooms,
      (SELECT COALESCE(sum(amount_cents),0) FROM payments p WHERE p.reservation_id=r.id AND p.status='verified')::bigint paid
    FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN room_types t ON t.id=r.room_type_id`;
  const [arrivals, departures, inhouse] = await Promise.all([
    q<any>(`${base} WHERE r.check_in=$1 AND r.status IN ('pending','confirmed','hold') ORDER BY r.status DESC, g.full_name`, [date]),
    q<any>(`${base} WHERE r.check_out<=$1 AND r.status='checked_in' ORDER BY r.check_out, g.full_name`, [date]),
    q<any>(`${base} WHERE r.status='checked_in' AND r.check_out>$1 ORDER BY r.check_out, g.full_name`, [date]),
  ]);
  const withBalance = async (rows: any[]) => {
    for (const r of rows) {
      const f = await getFolio(r.id);
      r.charges = f.charges + f.credits; r.paid = f.paid; r.balance = f.balance; r.state = f.state;
    }
    return rows;
  };
  return { date, arrivals: await withBalance(arrivals), departures: await withBalance(departures), inhouse: await withBalance(inhouse) };
}

/* ───────── Rooms / housekeeping ───────── */

export async function roomBoard(date = todayLocal()) {
  return q<any>(`
    SELECT rm.id, rm.name, rm.hk_status, rm.hk_updated_at, t.id room_type_id, t.code, t.kind, t.name type_name,
      (SELECT count(*) FROM units u WHERE u.room_id=rm.id AND u.active)::int units,
      (SELECT count(*) FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id JOIN units u ON u.id=ru.unit_id
        WHERE u.room_id=rm.id AND ru.active AND r.status='checked_in' AND ru.during @> $1::date)::int occupied,
      (SELECT string_agg(g.full_name, ', ') FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id JOIN units u ON u.id=ru.unit_id JOIN guests g ON g.id=r.guest_id
        WHERE u.room_id=rm.id AND ru.active AND r.status='checked_in' AND ru.during @> $1::date) guests,
      EXISTS (SELECT 1 FROM unit_blocks b JOIN units u ON u.id=b.unit_id WHERE u.room_id=rm.id AND b.during @> $1::date) blocked
    FROM rooms rm JOIN room_types t ON t.id=rm.room_type_id
    WHERE rm.active AND t.active ORDER BY rm.sort_order, t.sort_order, rm.name`, [date]);
}

export async function setHousekeeping(roomId: string, status: 'clean' | 'dirty' | 'inspected' | 'out_of_order', actor: string) {
  if (!['clean', 'dirty', 'inspected', 'out_of_order'].includes(status)) throw new BookingError('INVALID_INPUT');
  await q(`UPDATE rooms SET hk_status=$2, hk_updated_at=now() WHERE id=$1`, [roomId, status]);
  await audit(actor, 'room.hk_status', 'room', roomId, { status });
}

/* ───────── Check-in / out ───────── */

export async function checkInGuest(reservationId: string, actor: string, userId: string) {
  const r = (await q<any>('SELECT status FROM reservations WHERE id=$1', [reservationId]))[0];
  if (!r) throw new BookingError('NOT_FOUND');
  if (['hold', 'pending'].includes(r.status)) await confirmReservation(reservationId, actor, userId);
  await coreCheckIn(reservationId, actor);
  await tx(async (c) => {
    await c.query(`UPDATE reservations SET checked_in_at=COALESCE(checked_in_at, now()) WHERE id=$1`, [reservationId]);
    await postStayNights(c, reservationId, userId);
  });
}

export async function checkOutGuest(reservationId: string, actor: string, opts: { force?: boolean } = {}) {
  const f = await getFolio(reservationId);
  if (f.balance > 0 && !opts.force) throw new BookingError('PAYMENT_REQUIRED', `Balance due ${(f.balance / 100).toLocaleString('en-US')} ${f.currency}. Collect it or check out with balance (manager).`);
  const today = todayLocal();
  const freed: { roomTypeId: string; from: string; to: string }[] = [];
  await tx(async (c) => {
    const res = (await c.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [reservationId])).rows[0];
    if (res.status !== 'checked_in') throw new BookingError('BAD_STATE', 'Only checked-in guests can be checked out');
    const units = (await c.query(`SELECT ru.id, ru.unit_id, ru.during::text during, rm.id room_id, rm.room_type_id FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=$1 AND ru.active`, [reservationId])).rows;
    // Early departure: release the unused nights and drop their charges.
    if (res.check_out > today) {
      for (const u of units) {
        const { from, to } = parseRange(u.during);
        if (to > today) {
          if (from < today) await c.query(`UPDATE reservation_units SET during=$2::daterange WHERE id=$1`, [u.id, rangeStr(from, today)]);
          else await c.query(`UPDATE reservation_units SET active=false WHERE id=$1`, [u.id]);
          freed.push({ roomTypeId: u.room_type_id, from: from > today ? from : today, to });
        }
      }
      await voidRoomNights(c, reservationId, today, 'Early check-out');
      await c.query(`UPDATE reservations SET check_out=$2 WHERE id=$1`, [reservationId, today > res.check_in ? today : addDays(res.check_in, 1)]);
      await c.query(`UPDATE reservations SET total_cents=(SELECT COALESCE(sum(amount_cents),0) FROM folio_entries WHERE reservation_id=$1 AND kind='room' AND NOT voided) WHERE id=$1`, [reservationId]);
    }
    await c.query(`UPDATE reservations SET status='checked_out', checked_out_at=now(), updated_at=now() WHERE id=$1`, [reservationId]);
    for (const roomId of new Set(units.map((u: any) => u.room_id))) await c.query(`UPDATE rooms SET hk_status='dirty', hk_updated_at=now() WHERE id=$1`, [roomId]);
    await c.query('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [reservationId, actor, 'checked_out', JSON.stringify({ balance: f.balance, forced: !!opts.force })]);
    await audit(actor, 'reservation.check_out', 'reservation', reservationId, { balance: f.balance, forced: !!opts.force }, c as unknown as Q);
  });
  for (const fr of freed) await pushAvailability(null, { ...fr, delta: +1, reason: 'early_check_out' });
}

/* ───────── Walk-in ───────── */

export async function walkInQuote(roomTypeId: string, nights: number, units = 1) {
  const today = todayLocal();
  const lines = [];
  for (let i = 0; i < nights; i++) {
    const d = addDays(today, i);
    const r = await dayRate(pool() as unknown as Q, roomTypeId, d);
    lines.push({ date: d, cents: r?.cents ?? null, source: r?.source ?? null });
  }
  const missing = lines.some((l) => l.cents == null);
  return { lines, total: missing ? null : lines.reduce((s, l) => s + (l.cents as number), 0) * units, missing };
}

export async function walkIn(input: {
  fullName: string; phone?: string | null; email?: string | null; nationality?: string | null;
  roomTypeId: string; unitIds?: string[]; nights: number; guests: number; actor: string; userId: string;
}) {
  if (!input.fullName?.trim()) throw new BookingError('INVALID_INPUT', 'Guest name is required');
  if (!(input.nights >= 1 && input.nights <= 60)) throw new BookingError('INVALID_INPUT', 'Nights must be 1–60');
  const checkIn = todayLocal(), checkOut = addDays(checkIn, input.nights);
  const res = await createReservation({
    guest: { fullName: input.fullName.trim(), phone: input.phone || null, email: input.email || null, nationality: input.nationality || null, language: 'en' },
    roomTypeId: input.roomTypeId, checkIn, checkOut, guestsCount: input.guests, source: 'walk_in', status: 'confirmed',
    createdBy: input.userId, actor: input.actor, unitIds: input.unitIds?.filter(Boolean), facts: { nationality: input.nationality || undefined },
  });
  await coreCheckIn(res.id, input.actor);
  await tx(async (c) => {
    await c.query(`UPDATE reservations SET checked_in_at=now() WHERE id=$1`, [res.id]);
    await postStayNights(c, res.id, input.userId);
  });
  // Stop-sell: tell Little Hotelier the unit is gone so OTAs can't sell it again.
  const n = Number((await q<any>(`SELECT count(*)::int n FROM reservation_units WHERE reservation_id=$1 AND active`, [res.id]))[0].n);
  await pushAvailability(null, { roomTypeId: input.roomTypeId, from: checkIn, to: checkOut, delta: -n, reason: 'walk_in', stopSell: true });
  return res;
}

/* ───────── Room / bed move ───────── */

export async function moveOptions(reservationId: string) {
  const today = todayLocal();
  const res = (await q<any>(`SELECT * FROM reservations WHERE id=$1`, [reservationId]))[0];
  if (!res) throw new BookingError('NOT_FOUND');
  const from = res.check_in > today ? res.check_in : today;
  if (from >= res.check_out) return { from, options: [] as any[] };
  const types = await q<any>(`SELECT id, code, kind, name FROM room_types WHERE active ORDER BY sort_order, code`);
  const options: any[] = [];
  for (const t of types) {
    const free = await freeUnits(pool() as unknown as Q, t.id, from, res.check_out, reservationId);
    const rooms = await q<any>(`SELECT id, hk_status FROM rooms WHERE room_type_id=$1`, [t.id]);
    const hk = new Map(rooms.map((r: any) => [r.id, r.hk_status]));
    for (const u of free) options.push({ unitId: u.id, label: t.kind === 'dorm' ? `${u.room_name} · ${u.label}` : u.room_name, roomTypeId: t.id, typeName: t.name?.en ?? t.code, kind: t.kind, hk: hk.get(u.room_id) ?? 'clean', capacity: u.capacity });
  }
  return { from, options };
}

/**
 * Move one allocation to another bed/room from `effective` (default today) to check-out.
 * Old room → DIRTY. Remaining nights are re-priced at the destination room type's rate for each date.
 */
export async function moveRoom(input: { reservationUnitId?: string; reservationId: string; newUnitId: string; effective?: string; actor: string; userId: string }) {
  const today = todayLocal();
  const pushes: { roomTypeId: string; from: string; to: string; delta: number }[] = [];
  try {
    await tx(async (c) => {
      const cq = c as unknown as Q;
      const res = (await c.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [input.reservationId])).rows[0];
      if (!res) throw new BookingError('NOT_FOUND');
      if (!['confirmed', 'checked_in', 'pending', 'hold'].includes(res.status)) throw new BookingError('BAD_STATE', `Cannot move a ${res.status} reservation`);
      const ru = (await c.query(
        `SELECT ru.*, ru.during::text during_txt, rm.id room_id, rm.room_type_id FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id
         WHERE ru.reservation_id=$1 AND ru.active ${input.reservationUnitId ? 'AND ru.id=$2' : ''} ORDER BY ru.id LIMIT 1 FOR UPDATE OF ru`,
        input.reservationUnitId ? [input.reservationId, input.reservationUnitId] : [input.reservationId])).rows[0];
      if (!ru) throw new BookingError('NOT_FOUND', 'allocation');
      const nu = (await c.query(`SELECT u.*, rm.id room_id, rm.room_type_id, rm.hk_status, t.kind FROM units u JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id WHERE u.id=$1 AND u.active AND rm.active`, [input.newUnitId])).rows[0];
      if (!nu) throw new BookingError('NOT_FOUND', 'destination');
      if (nu.id === ru.unit_id) throw new BookingError('INVALID_INPUT', 'Guest is already in that bed/room');
      if (nu.kind !== 'dorm' && nu.capacity < ru.guests) throw new BookingError('CONFLICT', 'Destination is too small for this party');
      const { from, to } = parseRange(ru.during_txt);
      let eff = input.effective && isIsoDate(input.effective) ? input.effective : today;
      if (eff < from) eff = from;
      if (eff >= to) throw new BookingError('INVALID_DATES', 'Nothing left of the stay to move');
      const blocked = (await c.query(`SELECT 1 FROM unit_blocks WHERE unit_id=$1 AND during && $2::daterange LIMIT 1`, [nu.id, rangeStr(eff, to)])).rows[0];
      if (blocked) throw new BookingError('CONFLICT', 'Destination is blocked for maintenance');

      if (eff === from) {
        await c.query(`UPDATE reservation_units SET unit_id=$2 WHERE id=$1`, [ru.id, nu.id]);
      } else {
        await c.query(`UPDATE reservation_units SET during=$2::daterange WHERE id=$1`, [ru.id, rangeStr(from, eff)]);
        await c.query(`INSERT INTO reservation_units(reservation_id,unit_id,during,guests) VALUES($1,$2,$3::daterange,$4)`, [res.id, nu.id, rangeStr(eff, to), ru.guests]);
      }
      // If the whole stay moved, the reservation now belongs to the new room type.
      const typeChanged = nu.room_type_id !== ru.room_type_id;
      if (typeChanged && eff <= res.check_in) await c.query(`UPDATE reservations SET room_type_id=$2 WHERE id=$1`, [res.id, nu.room_type_id]);

      const posted = (await c.query(`SELECT 1 FROM folio_entries WHERE reservation_id=$1 AND kind='room' AND NOT voided LIMIT 1`, [res.id])).rows[0];
      if (posted) {
        await voidRoomNights(c, res.id, eff, `Moved to another ${nu.kind === 'dorm' ? 'bed' : 'room'}`, ru.unit_id, to);
        await postStayNights(c, res.id, input.userId);
      } else if (typeChanged) {
        // Not checked in yet: re-price the moved nights at the new type's rate for each date.
        const br: any[] = Array.isArray(res.price_breakdown) ? res.price_breakdown : [];
        for (const l of br) if (l.date >= eff && l.date < to) { const r = await dayRate(cq, nu.room_type_id, l.date); if (r) { l.unitPriceCents = r.cents; l.rate = r.name; } }
        const units = Number((await c.query(`SELECT count(*)::int n FROM reservation_units WHERE reservation_id=$1 AND active AND upper(during) > lower(during)`, [res.id])).rows[0].n || 1);
        await c.query(`UPDATE reservations SET price_breakdown=$2, total_cents=$3 WHERE id=$1`, [res.id, JSON.stringify(br), br.reduce((s, l) => s + Number(l.unitPriceCents), 0) * Math.max(1, units)]);
      }
      if (res.status === 'checked_in' && eff <= today) await c.query(`UPDATE rooms SET hk_status='dirty', hk_updated_at=now() WHERE id=$1`, [ru.room_id]);
      if (typeChanged) {
        pushes.push({ roomTypeId: ru.room_type_id, from: eff, to, delta: +1 });
        pushes.push({ roomTypeId: nu.room_type_id, from: eff, to, delta: -1 });
      }
      await c.query('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [res.id, input.actor, 'room_move', JSON.stringify({ from: ru.unit_id, to: nu.id, effective: eff })]);
      await audit(input.actor, 'reservation.room_move', 'reservation', res.id, { from: ru.unit_id, to: nu.id, effective: eff, typeChanged }, cq);
    });
  } catch (e: any) {
    if (e?.code === '23P01') throw new BookingError('NO_AVAILABILITY', 'That bed/room is taken for these nights');
    throw e;
  }
  for (const p of pushes) await pushAvailability(null, { ...p, reason: 'room_move' });
}


/**
 * A move booked for a later night: on that day the room the guest leaves needs cleaning.
 * Runs from the worker; a room cleaned later the same day is not marked again.
 */
export async function sweepMovedOutRooms(day = todayLocal()) {
  const r = await q<any>(`
    UPDATE rooms rm SET hk_status='dirty', hk_updated_at=now()
    WHERE rm.hk_status <> 'dirty' AND rm.hk_status <> 'out_of_order'
      AND (rm.hk_updated_at IS NULL OR (rm.hk_updated_at AT TIME ZONE 'Africa/Cairo')::date < $1::date)
      AND EXISTS (SELECT 1 FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id JOIN units u ON u.id=ru.unit_id
                  WHERE u.room_id=rm.id AND ru.active AND r.status='checked_in' AND upper(ru.during)=$1::date AND r.check_out > $1::date)
    RETURNING rm.id`, [day]);
  return r.length;
}
