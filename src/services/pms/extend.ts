import { q, pool } from '@/lib/db';
import type { Q } from '@/lib/db';
import { addDays, rangeStr } from '@/lib/dates';
import { BookingError } from '../errors';
import { requestExtension, decideExtension } from '../extensions';
import { snapshotStay, afterStayChange } from './sync';
import { getFolio } from './folio';

/**
 * Extend a stay at the desk in one step (dashboard or POS): same bed(s), extra nights priced per date and added to
 * the bill, applied at once. Guests asking online still go through Stay extensions for approval.
 */
export async function extendStay(reservationId: string, input: { nights?: number; newCheckOut?: string }, actor: string, userId: string | null) {
  const r = (await q<any>(`SELECT id, status, check_out, reference FROM reservations WHERE id=$1`, [reservationId]))[0];
  if (!r) throw new BookingError('NOT_FOUND', 'Booking not found');
  if (!['confirmed', 'checked_in'].includes(r.status)) throw new BookingError('BAD_STATE', 'Only a confirmed or checked-in stay can be extended');
  const to = input.newCheckOut ?? (input.nights && input.nights >= 1 && input.nights <= 60 ? addDays(r.check_out, Math.trunc(input.nights)) : null);
  if (!to || to <= r.check_out) throw new BookingError('INVALID_DATES', 'Choose at least one more night');
  const before = await snapshotStay(reservationId);
  const e = await requestExtension(reservationId, to, actor);
  if (e.status !== 'pending') {
    const max = await freeNightsAfter(reservationId);
    throw new BookingError('CONFLICT', `${e.conflict_detail ?? 'Cannot extend'}.${max > 0 ? ` The same bed is free for ${max} more night${max === 1 ? '' : 's'}.` : ' Move the guest to a free bed first (Dates & beds), then extend.'}`);
  }
  const d = await decideExtension((e as any).id, 'approve', actor, userId as any);
  if (d.status === 'conflict') throw new BookingError('CONFLICT', d.detail ?? 'Cannot extend');
  await afterStayChange(reservationId, before, userId, 'extension.apply');
  const f = await getFolio(reservationId);
  return { reference: r.reference, newCheckOut: to, nights: e.extra_nights, extraCents: d.extra_cents ?? e.extra_cents, balance: f.balance, priceSource: (e as any).price_source === 'hostelworld' ? 'Hostelworld price' : 'our rates' };
}

/** How many nights after check-out the same bed(s) stay free (0–30), to tell staff how far a stay can be extended. */
export async function freeNightsAfter(reservationId: string, cap = 30) {
  const r = (await q<any>(`SELECT check_out FROM reservations WHERE id=$1`, [reservationId]))[0];
  if (!r) return 0;
  const c = pool() as unknown as Q;
  const units = (await c.query(`SELECT unit_id FROM reservation_units WHERE reservation_id=$1 AND active AND upper(during) >= $2::date`, [reservationId, r.check_out])).rows;
  if (!units.length) return 0;
  let n = 0;
  for (; n < cap; n++) {
    const night = rangeStr(addDays(r.check_out, n), addDays(r.check_out, n + 1));
    const busy = (await c.query(
      `SELECT 1 FROM reservation_units o JOIN reservations x ON x.id=o.reservation_id WHERE o.unit_id = ANY($1::uuid[]) AND o.active AND o.reservation_id<>$2 AND o.during && $3::daterange
         AND x.status IN ('hold','pending','confirmed','checked_in') AND NOT (x.status IN ('hold','pending') AND x.hold_expires_at < now())
       UNION ALL SELECT 1 FROM unit_blocks b WHERE b.unit_id = ANY($1::uuid[]) AND b.during && $3::daterange LIMIT 1`, [units.map((u: any) => u.unit_id), reservationId, night])).rows[0];
    if (busy) break;
  }
  return n;
}
