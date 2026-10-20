import { q, tx } from '@/lib/db';
import { postStayNights } from './folio';
import { pushAvailability } from './channel';

/**
 * Keep the folio and Little Hotelier in step after a stay changes outside the front-desk cockpit
 * (date change, bed reassignment, extension approved).
 */
export type StaySnapshot = { roomTypeId: string; checkIn: string; checkOut: string; units: number; status: string } | null;

export async function snapshotStay(reservationId: string): Promise<StaySnapshot> {
  const r = (await q<any>(`SELECT room_type_id, check_in, check_out, status, (SELECT count(*)::int FROM reservation_units WHERE reservation_id=$1 AND active) units FROM reservations WHERE id=$1`, [reservationId]))[0];
  return r ? { roomTypeId: r.room_type_id, checkIn: r.check_in, checkOut: r.check_out, units: r.units, status: r.status } : null;
}

/** Re-post room nights so the folio matches the current allocation. No-op until the guest has checked in. */
export async function resyncRoomNights(reservationId: string, userId: string | null = null) {
  return tx(async (c) => {
    const posted = (await c.query(`SELECT 1 FROM folio_entries WHERE reservation_id=$1 AND kind='room' AND NOT voided LIMIT 1`, [reservationId])).rows[0];
    if (!posted) return null;
    await c.query(
      `UPDATE folio_entries fe SET voided=true, void_reason='Stay changed', voided_at=now()
       WHERE fe.reservation_id=$1 AND fe.kind='room' AND NOT fe.voided
         AND NOT EXISTS (SELECT 1 FROM reservation_units ru WHERE ru.reservation_id=$1 AND ru.active AND ru.unit_id=fe.unit_id AND ru.during @> fe.entry_date)`, [reservationId]);
    return postStayNights(c, reservationId, userId);
  });
}

export async function afterStayChange(reservationId: string, before: StaySnapshot, userId: string | null, reason: string) {
  await resyncRoomNights(reservationId, userId);
  const now = await snapshotStay(reservationId);
  if (!before || !now) return;
  // Only stays that hold inventory matter to the channel.
  const holds = (s: string) => ['confirmed', 'checked_in'].includes(s);
  const same = before.roomTypeId === now.roomTypeId && before.checkIn === now.checkIn && before.checkOut === now.checkOut && before.units === now.units;
  if (same) return;
  if (holds(before.status)) await pushAvailability(null, { roomTypeId: before.roomTypeId, from: before.checkIn, to: before.checkOut, delta: +before.units, reason: reason + '.release' });
  if (holds(now.status)) await pushAvailability(null, { roomTypeId: now.roomTypeId, from: now.checkIn, to: now.checkOut, delta: -now.units, reason });
}
