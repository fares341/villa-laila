import type { PoolClient } from 'pg';
import { q, tx } from '@/lib/db';
import type { Q } from '@/lib/db';
import { eachNight, parseRange } from '@/lib/dates';
import { dayRate } from '../pricing';
import { BookingError } from '../errors';
import { audit } from '../audit';

export type RateSource = 'override' | 'booking' | 'little_hotelier' | 'local_rate';

/**
 * The price of ONE night for one unit. Order: manager override → the rate the guest booked for that date →
 * Little Hotelier's recorded rate for that date → local rate table. Each date is looked up on its own.
 */
export async function nightRate(c: Q, res: { id: string; room_type_id: string; price_breakdown: any }, roomTypeId: string, date: string): Promise<{ cents: number; source: RateSource }> {
  const ov = (await c.query(`SELECT rate_cents FROM rate_overrides WHERE reservation_id=$1 AND from_date <= $2::date AND to_date > $2::date ORDER BY created_at DESC LIMIT 1`, [res.id, date])).rows[0];
  if (ov) return { cents: Number(ov.rate_cents), source: 'override' };
  if (roomTypeId === res.room_type_id && Array.isArray(res.price_breakdown)) {
    const line = res.price_breakdown.find((l: any) => l?.date === date);
    if (line && Number.isFinite(Number(line.unitPriceCents))) return { cents: Number(line.unitPriceCents), source: 'booking' };
  }
  const r = await dayRate(c, roomTypeId, date);
  if (!r) throw new BookingError('NO_RATE', `No rate for ${date}. Add it in Rates or sync Little Hotelier.`);
  return { cents: r.cents, source: r.source };
}

/** Post (idempotently) one folio line per unit per night for the whole stay. Returns the room total. */
export async function postStayNights(c: PoolClient, reservationId: string, userId: string | null = null): Promise<number> {
  const cq = c as unknown as Q;
  const res = (await c.query('SELECT * FROM reservations WHERE id=$1', [reservationId])).rows[0];
  if (!res) throw new BookingError('NOT_FOUND');
  const units = (await c.query(
    `SELECT ru.unit_id, ru.during::text during, u.label, rm.name room, rm.room_type_id, t.kind
     FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id
     WHERE ru.reservation_id=$1 AND ru.active`, [reservationId])).rows;
  for (const u of units) {
    const { from, to } = parseRange(u.during);
    for (const night of eachNight(from, to)) {
      const exists = (await c.query(`SELECT 1 FROM folio_entries WHERE reservation_id=$1 AND entry_date=$2 AND unit_id=$3 AND kind='room' AND NOT voided`, [reservationId, night, u.unit_id])).rows[0];
      if (exists) continue;
      const rate = await nightRate(cq, res, u.room_type_id, night);
      const label = u.kind === 'dorm' ? `${u.room} · ${u.label}` : u.room;
      await c.query(
        `INSERT INTO folio_entries(reservation_id,entry_date,kind,description,quantity,unit_cents,amount_cents,currency,unit_id,room_type_id,rate_source,created_by)
         VALUES($1,$2,'room',$3,1,$4,$4,$5,$6,$7,$8,$9)`,
        [reservationId, night, `Night of ${night} · ${label}`, rate.cents, res.currency, u.unit_id, u.room_type_id, rate.source, userId]);
    }
  }
  const total = Number((await c.query(`SELECT COALESCE(sum(amount_cents),0)::bigint s FROM folio_entries WHERE reservation_id=$1 AND kind='room' AND NOT voided`, [reservationId])).rows[0].s);
  await c.query('UPDATE reservations SET total_cents=$2, updated_at=now() WHERE id=$1', [reservationId, total]);
  return total;
}

export async function voidRoomNights(c: PoolClient, reservationId: string, fromDate: string, reason: string, unitId: string | null = null, toDate: string | null = null) {
  await c.query(
    `UPDATE folio_entries SET voided=true, void_reason=$3, voided_at=now()
     WHERE reservation_id=$1 AND kind='room' AND NOT voided AND entry_date >= $2::date
       AND ($4::uuid IS NULL OR unit_id=$4) AND ($5::date IS NULL OR entry_date < $5::date)`,
    [reservationId, fromDate, reason, unitId, toDate]);
}

export type FolioLine = { id: string | null; date: string; kind: string; description: string; quantity: number; unit_cents: number; amount_cents: number; rate_source?: string | null; posted: boolean; created_at?: string };

export async function getFolio(reservationId: string) {
  const res = (await q<any>(`SELECT r.*, g.full_name FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.id=$1`, [reservationId]))[0];
  if (!res) throw new BookingError('NOT_FOUND');
  const entries = await q<any>(`SELECT * FROM folio_entries WHERE reservation_id=$1 AND NOT voided ORDER BY entry_date, kind <> 'room', created_at`, [reservationId]);
  const roomPosted = entries.some((e) => e.kind === 'room');
  const lines: FolioLine[] = entries.map((e) => ({ id: e.id, date: e.entry_date, kind: e.kind, description: e.description, quantity: Number(e.quantity), unit_cents: Number(e.unit_cents), amount_cents: Number(e.amount_cents), rate_source: e.rate_source, posted: true, created_at: e.created_at }));
  if (!roomPosted && Number(res.total_cents) > 0) {
    // Not checked in yet: show the booked nights (price agreed per date), not yet posted.
    const units = Number((await q<any>(`SELECT count(*)::int n FROM reservation_units WHERE reservation_id=$1 AND active`, [reservationId]))[0]?.n || 1);
    const br: any[] = Array.isArray(res.price_breakdown) ? res.price_breakdown : [];
    if (br.length) for (const l of br) lines.unshift({ id: null, date: l.date, kind: 'room', description: `Night of ${l.date} (booked${units > 1 ? ` × ${units}` : ''})`, quantity: units, unit_cents: Number(l.unitPriceCents), amount_cents: Number(l.unitPriceCents) * units, rate_source: 'booking', posted: false });
    else lines.unshift({ id: null, date: res.check_in, kind: 'room', description: 'Room total (booked)', quantity: 1, unit_cents: Number(res.total_cents), amount_cents: Number(res.total_cents), rate_source: 'booking', posted: false });
    lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  const pays = await q<any>(`SELECT id, amount_cents, method, status, reference, note, created_at FROM payments WHERE reservation_id=$1 ORDER BY created_at`, [reservationId]);
  const charges = lines.filter((l) => l.amount_cents > 0).reduce((s, l) => s + l.amount_cents, 0);
  const credits = lines.filter((l) => l.amount_cents < 0).reduce((s, l) => s + l.amount_cents, 0);
  const paid = pays.filter((p) => p.status === 'verified').reduce((s, p) => s + Number(p.amount_cents), 0);
  const pending = pays.filter((p) => p.status === 'recorded').reduce((s, p) => s + Number(p.amount_cents), 0);
  const balance = charges + credits - paid;
  const state: 'due' | 'settled' | 'credit' = balance > 0 ? 'due' : balance < 0 ? 'credit' : 'settled';
  return { reservation: res, lines, payments: pays, charges, credits, paid, pending, balance, state, currency: res.currency as string, roomPosted };
}

export async function folioBalance(reservationId: string) {
  const f = await getFolio(reservationId);
  return { charges: f.charges + f.credits, paid: f.paid, balance: f.balance, state: f.state };
}

export async function addFolioCharge(input: {
  reservationId: string; kind: 'pos' | 'custom' | 'event' | 'tour' | 'adjustment' | 'discount' | 'comp'; description: string;
  quantity?: number; unitCents: number; date?: string; refType?: string; refId?: string; shiftId?: string | null; staffId?: string | null; userId?: string | null; note?: string;
}, c?: PoolClient) {
  const qty = input.quantity ?? 1;
  const amount = Math.round(input.unitCents * qty);
  const run = c ?? null;
  const sql = `INSERT INTO folio_entries(reservation_id,entry_date,kind,description,quantity,unit_cents,amount_cents,currency,ref_type,ref_id,shift_id,staff_id,created_by,note)
     VALUES($1,COALESCE($2::date,current_date),$3,$4,$5,$6,$7,(SELECT currency FROM reservations WHERE id=$1),$8,$9,$10,$11,$12,$13) RETURNING *`;
  const params = [input.reservationId, input.date ?? null, input.kind, input.description, qty, input.unitCents, amount, input.refType ?? null, input.refId ?? null, input.shiftId ?? null, input.staffId ?? null, input.userId ?? null, input.note ?? null];
  return run ? (await run.query(sql, params)).rows[0] : (await q(sql, params))[0];
}

export async function voidFolioEntry(entryId: string, reason: string, actor: string) {
  if (!reason?.trim()) throw new BookingError('INVALID_INPUT', 'A reason is required');
  const r = await q(`UPDATE folio_entries SET voided=true, void_reason=$2, voided_at=now() WHERE id=$1 AND NOT voided RETURNING reservation_id, kind`, [entryId, reason]);
  if (!r.length) throw new BookingError('NOT_FOUND');
  await audit(actor, 'folio.void', 'folio_entry', entryId, { reason });
  if (r[0].kind === 'room') await q(`UPDATE reservations SET total_cents=(SELECT COALESCE(sum(amount_cents),0) FROM folio_entries WHERE reservation_id=$1 AND kind='room' AND NOT voided) WHERE id=$1`, [r[0].reservation_id]);
}

/** Manager discount / custom rate for part of a stay. Re-prices the affected nights from the folio. */
export async function applyRateOverride(reservationId: string, from: string, to: string, rateCents: number, reason: string, userId: string, actor: string) {
  if (!reason?.trim()) throw new BookingError('INVALID_INPUT', 'A reason is required for a rate override');
  if (!(to > from)) throw new BookingError('INVALID_DATES');
  if (!Number.isInteger(rateCents) || rateCents < 0) throw new BookingError('INVALID_INPUT', 'rate');
  return tx(async (c) => {
    const res = (await c.query('SELECT * FROM reservations WHERE id=$1 FOR UPDATE', [reservationId])).rows[0];
    if (!res) throw new BookingError('NOT_FOUND');
    await c.query(`INSERT INTO rate_overrides(reservation_id,from_date,to_date,rate_cents,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)`, [reservationId, from, to, rateCents, reason, userId]);
    const posted = (await c.query(`SELECT 1 FROM folio_entries WHERE reservation_id=$1 AND kind='room' AND NOT voided LIMIT 1`, [reservationId])).rows[0];
    let total: number;
    if (posted) {
      await voidRoomNights(c, reservationId, from, 'Rate override: ' + reason, null, to);
      total = await postStayNights(c, reservationId, userId);
    } else {
      const units = Number((await c.query(`SELECT count(*)::int n FROM reservation_units WHERE reservation_id=$1 AND active`, [reservationId])).rows[0].n || 1);
      const lines = (Array.isArray(res.price_breakdown) ? res.price_breakdown : []).map((l: any) => (l.date >= from && l.date < to ? { ...l, unitPriceCents: rateCents, rate: 'Override' } : l));
      total = lines.reduce((s: number, l: any) => s + Number(l.unitPriceCents), 0) * units;
      await c.query('UPDATE reservations SET price_breakdown=$2, total_cents=$3, updated_at=now() WHERE id=$1', [reservationId, JSON.stringify(lines), total]);
    }
    await c.query('INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,$2,$3,$4)', [reservationId, actor, 'rate_override', JSON.stringify({ from, to, rateCents, reason })]);
    await audit(actor, 'reservation.rate_override', 'reservation', reservationId, { from, to, rateCents, reason }, c as unknown as Q);
    return total;
  });
}
