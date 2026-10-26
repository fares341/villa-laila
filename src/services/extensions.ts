import { tx, q } from '@/lib/db';
import type { Q } from '@/lib/db';
import { rangeStr, nightsBetween, isIsoDate, addDays } from '@/lib/dates';
import { BookingError } from './errors';
import { quote } from './pricing';
import { getSetting } from './settings';
import { audit } from './audit';
import { sweepExpired } from './reservations';
import { cancelFollowups } from './followups';
import { hostelworldStayPrice } from './hostelworld-sync';
import { channelEnabled } from './pms/channel';

export type ExtensionRequest = { id: string; status: string; extra_nights: number; extra_cents: number; conflict_detail: string | null; new_check_out: string; old_check_out: string };

/** Can every allocation of this reservation simply run longer? Returns the first blocking reason, or null. */
async function checkExtendable(c: Q, reservationId: string, from: string, to: string): Promise<string | null> {
  const rus = (await c.query('SELECT unit_id, guests FROM reservation_units WHERE reservation_id=$1 AND active', [reservationId])).rows;
  for (const ru of rus) {
    const clash = (await c.query(
      `SELECT res.reference FROM reservation_units o JOIN reservations res ON res.id=o.reservation_id
       WHERE o.unit_id=$1 AND o.active AND o.reservation_id<>$2 AND o.during && $3::daterange
         AND NOT (res.status IN ('hold','pending') AND res.hold_expires_at < now()) LIMIT 1`, [ru.unit_id, reservationId, rangeStr(from, to)])).rows[0];
    if (clash) return `Bed/room already assigned to another guest (${clash.reference}) during the extra nights`;
    const blk = (await c.query('SELECT reason FROM unit_blocks WHERE unit_id=$1 AND during && $2::daterange LIMIT 1', [ru.unit_id, rangeStr(from, to)])).rows[0];
    if (blk) return `Bed/room is blocked for maintenance${blk.reason ? ` (${blk.reason})` : ''}`;
  }
  return null;
}

/** Steps 1–6: identify, validate, price, create the request, route conflicts to staff. Never touches the reservation itself. */
export async function requestExtension(reservationId: string, newCheckOut: string, requestedBy: string): Promise<ExtensionRequest> {
  if (!isIsoDate(newCheckOut)) throw new BookingError('INVALID_DATES');
  const maxNights = await getSetting<number>('max_nights');
  // The extra nights cost what Hostelworld charges for them right now (read before the transaction: it is a web call).
  const pre = (await q<any>(`SELECT r.check_out::text check_out, r.currency, t.code FROM reservations r JOIN room_types t ON t.id=r.room_type_id WHERE r.id=$1`, [reservationId]))[0];
  const hw = pre && newCheckOut > pre.check_out ? await hostelworldStayPrice(pre.code, pre.check_out, newCheckOut, pre.currency || 'EGP') : null;
  return tx(async (c) => {
    const cq = c as unknown as Q;
    await sweepExpired(cq);
    const r = (await c.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [reservationId])).rows[0];
    if (!r) throw new BookingError('NOT_FOUND');
    if (!['confirmed', 'checked_in'].includes(r.status)) throw new BookingError('BAD_STATE', 'Only confirmed or checked-in stays can be extended');
    if (newCheckOut <= r.check_out) throw new BookingError('INVALID_DATES', 'New departure must be after the current one');
    if (nightsBetween(r.check_in, newCheckOut) > maxNights) throw new BookingError('TOO_LONG');
    const open = (await c.query(`SELECT 1 FROM extension_requests WHERE reservation_id=$1 AND status IN ('pending','conflict')`, [reservationId])).rows[0];
    if (open) throw new BookingError('CONFLICT', 'An extension request is already open for this reservation');

    const unitCount = (await c.query('SELECT count(*)::int n FROM reservation_units WHERE reservation_id=$1 AND active', [reservationId])).rows[0].n;
    const extraNights = nightsBetween(r.check_out, newCheckOut);
    let extra = 0, noRate = false;
    const hwLines = hw && hw.lines.length === extraNights && hw.lines[0].date === String(r.check_out).slice(0, 10) ? hw.lines : null;
    if (hwLines) extra = hw!.perUnitCents * unitCount;
    else try { extra = (await quote(cq, r.room_type_id, r.check_out, newCheckOut, unitCount)).totalCents; } catch (e) { if (e instanceof BookingError && e.code === 'NO_RATE') noRate = true; else throw e; }
    const conflict = await checkExtendable(cq, reservationId, r.check_out, newCheckOut);
    const status = conflict || noRate ? 'conflict' : 'pending';
    const detail = conflict ?? (noRate ? 'No configured rate for some of the extra nights — price needs staff input' : null);

    const ext = (await c.query(
      `INSERT INTO extension_requests(reservation_id,old_check_out,new_check_out,extra_nights,extra_cents,status,conflict_detail,requested_by,price_lines,price_source)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [reservationId, r.check_out, newCheckOut, extraNights, extra, status, detail, requestedBy, hwLines ? JSON.stringify(hwLines) : null, hwLines ? 'hostelworld' : 'rates'])).rows[0];
    await c.query(
      `INSERT INTO tasks(title,detail,kind,reservation_id,extension_id,dedupe_key) VALUES($1,$2,'extension',$3,$4,$5)`,
      [`Extension request ${r.reference} → ${newCheckOut}`, detail ?? `+${extraNights} night(s), ${extra / 100} ${r.currency}. Needs approval.`, reservationId, ext.id, 'ext:' + ext.id]);
    await c.query('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [reservationId, requestedBy, 'extension_requested', JSON.stringify({ newCheckOut, status })]);
    await audit(requestedBy, 'extension.request', 'reservation', reservationId, { newCheckOut, status }, cq);
    return ext;
  });
}

/** Steps 7–9: staff decision. Re-validates against live data inside one transaction; only then changes the reservation. */
export async function decideExtension(extensionId: string, decision: 'approve' | 'reject', actor: string, staffUserId: string) {
  let result: { status: 'applied' | 'rejected' | 'conflict'; reservationId: string; detail?: string; extra_cents?: number };
  try {
    result = await tx(async (c) => {
      const cq = c as unknown as Q;
      const ext = (await c.query('SELECT * FROM extension_requests WHERE id=$1 FOR UPDATE', [extensionId])).rows[0];
      if (!ext) throw new BookingError('NOT_FOUND');
      if (!['pending', 'conflict'].includes(ext.status)) throw new BookingError('BAD_STATE', `Extension already ${ext.status}`);
      const r = (await c.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [ext.reservation_id])).rows[0];
      if (decision === 'reject') {
        await c.query(`UPDATE extension_requests SET status='rejected', decided_by=$2, decided_at=now() WHERE id=$1`, [extensionId, staffUserId]);
        await c.query(`UPDATE tasks SET status='done', completed_at=now() WHERE extension_id=$1`, [extensionId]);
        await c.query('INSERT INTO reservation_events(reservation_id,actor,action) VALUES($1,$2,$3)', [r.id, actor, 'extension_rejected']);
        await audit(actor, 'extension.reject', 'reservation', r.id, { extensionId }, cq);
        return { status: 'rejected' as const, reservationId: r.id };
      }
      if (!['confirmed', 'checked_in'].includes(r.status)) throw new BookingError('BAD_STATE', 'Reservation is no longer extendable');
      if (r.check_out !== ext.old_check_out) throw new BookingError('CONFLICT', 'Reservation dates changed since the request. Reject and create a new request.');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['rt:' + r.room_type_id]);
      const conflict = await checkExtendable(cq, r.id, ext.old_check_out, ext.new_check_out);
      if (conflict) {
        await c.query(`UPDATE extension_requests SET status='conflict', conflict_detail=$2 WHERE id=$1`, [extensionId, conflict]);
        return { status: 'conflict' as const, reservationId: r.id, detail: conflict };
      }
      // Only the bed(s) the guest is in on the last night are extended. After a room move the earlier
      // segment ends at the move date and must stay as it is.
      const unitCount = (await c.query('SELECT count(*)::int n FROM reservation_units WHERE reservation_id=$1 AND active AND upper(during)=$2::date', [r.id, ext.old_check_out])).rows[0].n;
      // Hostelworld's price saved with the request when there is one; otherwise the hostel's own rates (throws NO_RATE rather than guessing).
      const saved: any[] | null = Array.isArray(ext.price_lines) && ext.price_lines.length === ext.extra_nights ? ext.price_lines : null;
      const qt = saved
        ? { lines: saved, totalCents: saved.reduce((t, l) => t + Number(l.unitPriceCents), 0) * unitCount }
        : await quote(cq, r.room_type_id, ext.old_check_out, ext.new_check_out, unitCount);
      await c.query(`UPDATE reservation_units SET during = daterange(lower(during), $2::date, '[)') WHERE reservation_id=$1 AND active AND upper(during)=$3::date`, [r.id, ext.new_check_out, ext.old_check_out]);
      const lines = [...(r.price_breakdown ?? []), ...qt.lines];
      await c.query('UPDATE reservations SET check_out=$2, total_cents=total_cents+$3, price_breakdown=$4, updated_at=now() WHERE id=$1', [r.id, ext.new_check_out, qt.totalCents, JSON.stringify(lines)]);
      // Without the channel-manager connection the extra nights go on the dashboard alert, to be closed in Little Hotelier.
      if (!channelEnabled()) await c.query(`UPDATE reservations SET cm_ext_from=LEAST(COALESCE(cm_ext_from, $2::date), $2::date), cm_ext_to=$3::date WHERE id=$1`, [r.id, ext.old_check_out, ext.new_check_out]);
      await c.query(`UPDATE extension_requests SET status='applied', extra_cents=$2, decided_by=$3, decided_at=now() WHERE id=$1`, [extensionId, qt.totalCents, staffUserId]);
      await c.query(`UPDATE tasks SET status='done', completed_at=now() WHERE extension_id=$1`, [extensionId]);
      await c.query('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [r.id, actor, 'extension_applied', JSON.stringify({ newCheckOut: ext.new_check_out, extraCents: qt.totalCents })]);
      await audit(actor, 'extension.apply', 'reservation', r.id, { extensionId, extraCents: qt.totalCents }, cq);
      return { status: 'applied' as const, reservationId: r.id, extra_cents: qt.totalCents };
    });
  } catch (e: any) {
    if (e?.code === '23P01') {
      await q(`UPDATE extension_requests SET status='conflict', conflict_detail='Overlaps another reservation (database guard)' WHERE id=$1`, [extensionId]);
      return { status: 'conflict' as const, reservationId: '', detail: 'Overlaps another reservation' };
    }
    throw e;
  }
  if (result.status === 'applied') await cancelFollowups({ reservationId: result.reservationId, kinds: ['extension_followup'] });
  return result;
}
