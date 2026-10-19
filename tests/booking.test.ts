import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { q } from '@/lib/db';
import { addDays, todayLocal } from '@/lib/dates';
import { createReservation, confirmReservation, cancelReservation, sweepExpired, changeStay, checkIn } from '@/services/reservations';
import { availabilityFor } from '@/services/availability';
import { BookingError } from '@/services/errors';
import { hasDb, resetDb, seedInventory, guest, closePool, ruleDefaults } from './helpers';

const d = (n: number) => addDays(todayLocal(), n);
const base = (inv: any, over: any = {}) => ({ guest: guest('A Guest'), roomTypeId: inv.dorm, checkIn: d(10), checkOut: d(12), guestsCount: 1, source: 'website' as const, status: 'pending' as const, actor: 'test', ...over });

describe.skipIf(!hasDb)('reservation engine', () => {
  let inv: Awaited<ReturnType<typeof seedInventory>>;
  beforeEach(async () => { await resetDb(); await ruleDefaults(); inv = await seedInventory(3); });
  afterAll(closePool);

  it('prices nights from configured rates and never invents a rate', async () => {
    const r = await createReservation(base(inv, { guestsCount: 2 }));
    expect(r.total_cents).toBe(2 * 2 * 10000); // 2 beds x 2 nights
    await q('DELETE FROM rates WHERE room_type_id=$1', [inv.dorm]);
    await expect(createReservation(base(inv, { guest: guest('B') }))).rejects.toMatchObject({ code: 'NO_RATE' });
  });

  it('checkout day is free: back-to-back stays on the same bed are allowed, overlaps are not', async () => {
    await createReservation(base(inv, { checkIn: d(10), checkOut: d(12), guestsCount: 3 }));
    const b2b = await createReservation(base(inv, { guest: guest('B'), checkIn: d(12), checkOut: d(13), guestsCount: 3 }));
    expect(b2b.reference).toMatch(/^VL-/);
    await expect(createReservation(base(inv, { guest: guest('C'), checkIn: d(11), checkOut: d(13) }))).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });
  });

  it('database constraint rejects overlapping active allocations even if the service were bypassed', async () => {
    const r = await createReservation(base(inv));
    const ru = (await q('SELECT * FROM reservation_units WHERE reservation_id=$1', [r.id]))[0];
    const g = (await q(`SELECT id FROM guests LIMIT 1`))[0].id;
    const other = (await q(`INSERT INTO reservations(reference,guest_id,room_type_id,check_in,check_out,guests_count,source,status) VALUES('VL-RAW001',$1,$2,$3,$4,1,'staff','confirmed') RETURNING id`, [g, inv.dorm, d(10), d(12)]))[0].id;
    await expect(q(`INSERT INTO reservation_units(reservation_id,unit_id,during) VALUES($1,$2,$3::daterange)`, [other, ru.unit_id, `[${d(11)},${d(13)})`])).rejects.toMatchObject({ code: '23P01' });
  });

  it('concurrent requests for the last bed: exactly one wins', async () => {
    await createReservation(base(inv, { guestsCount: 2 })); // 1 bed left
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createReservation(base(inv, { guest: guest('Racer ' + i) }))));
    const ok = attempts.filter((a) => a.status === 'fulfilled').length;
    expect(ok).toBe(1);
    attempts.filter((a) => a.status === 'rejected').forEach((a: any) => expect(a.reason).toBeInstanceOf(BookingError));
    const active = await q(`SELECT count(*)::int n FROM reservation_units WHERE active AND unit_id IN (SELECT id FROM units WHERE room_id=(SELECT room_id FROM units WHERE id=$1))`, [inv.units[0]]);
    expect(active[0].n).toBe(3);
  });

  it('dorm books N distinct beds; private respects capacity', async () => {
    const r = await createReservation(base(inv, { guestsCount: 3 }));
    const n = (await q('SELECT count(DISTINCT unit_id)::int n FROM reservation_units WHERE reservation_id=$1', [r.id]))[0].n;
    expect(n).toBe(3);
    await expect(createReservation(base(inv, { guest: guest('Big'), roomTypeId: inv.priv, guestsCount: 3, checkIn: d(30), checkOut: d(31) }))).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });
    const p = await createReservation(base(inv, { guest: guest('Two'), roomTypeId: inv.priv, guestsCount: 2, checkIn: d(30), checkOut: d(31) }));
    expect(p.total_cents).toBe(30000);
  });

  it('validates dates: past, order, malformed, too long', async () => {
    await expect(createReservation(base(inv, { checkIn: d(-2), checkOut: d(1) }))).rejects.toMatchObject({ code: 'PAST_DATE' });
    await expect(createReservation(base(inv, { checkIn: d(5), checkOut: d(5) }))).rejects.toMatchObject({ code: 'INVALID_DATES' });
    await expect(createReservation(base(inv, { checkIn: '2026-02-30', checkOut: d(5) }))).rejects.toMatchObject({ code: 'INVALID_DATES' });
    await expect(createReservation(base(inv, { checkIn: d(5), checkOut: d(200) }))).rejects.toMatchObject({ code: 'TOO_LONG' });
  });

  it('a request is NOT confirmed until staff confirms; confirm requires a verified deposit when configured', async () => {
    const r = await createReservation(base(inv));
    expect(r.status).toBe('pending');
    await q(`INSERT INTO settings(key,value) VALUES('confirm_requires_deposit_cents','5000')`);
    await expect(confirmReservation(r.id, 'staff', null)).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
    await q(`DELETE FROM settings WHERE key='confirm_requires_deposit_cents'`);
    await confirmReservation(r.id, 'staff', null);
    expect((await q('SELECT status FROM reservations WHERE id=$1', [r.id]))[0].status).toBe('confirmed');
    await expect(confirmReservation(r.id, 'staff', null)).rejects.toMatchObject({ code: 'BAD_STATE' });
  });

  it('expired holds release inventory and cannot be silently confirmed over another booking', async () => {
    const r = await createReservation(base(inv, { guestsCount: 3 }));
    await q(`UPDATE reservations SET hold_expires_at = now() - interval '1 minute' WHERE id=$1`, [r.id]);
    expect((await availabilityFor(d(10), d(12), 3)).find((a) => a.code === 'dorm')!.canFit).toBe(true); // read path ignores expired holds
    const other = await createReservation(base(inv, { guest: guest('Taker'), guestsCount: 3 }));        // write path sweeps them
    expect((await q('SELECT status FROM reservations WHERE id=$1', [r.id]))[0].status).toBe('expired');
    await expect(confirmReservation(r.id, 'staff', null)).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });
    expect(other.status).toBe('pending');
  });

  it('cancelling frees the beds; maintenance blocks remove availability', async () => {
    const r = await createReservation(base(inv, { guestsCount: 3 }));
    await cancelReservation(r.id, 'test', 'staff');
    expect((await availabilityFor(d(10), d(12), 3)).find((a) => a.code === 'dorm')!.freeCount).toBe(3);
    await q(`INSERT INTO unit_blocks(unit_id,during,reason) VALUES($1,$2::daterange,'plumbing')`, [inv.units[0], `[${d(9)},${d(20)})`]);
    expect((await availabilityFor(d(10), d(12), 1)).find((a) => a.code === 'dorm')!.freeCount).toBe(2);
  });

  it('changing dates is validated by the database and re-prices the stay', async () => {
    const a = await createReservation(base(inv, { guestsCount: 3, checkIn: d(10), checkOut: d(12) }));
    const b = await createReservation(base(inv, { guest: guest('B'), guestsCount: 3, checkIn: d(14), checkOut: d(16) }));
    await expect(changeStay(a.id, d(10), d(15), 'staff')).rejects.toMatchObject({ code: 'NO_AVAILABILITY' });
    const ok = await changeStay(a.id, d(10), d(14), 'staff');
    expect(ok.totalCents).toBe(4 * 3 * 10000);
    expect(b.status).toBe('pending');
  });

  it('check-in only on/after the arrival date', async () => {
    const r = await createReservation(base(inv));
    await confirmReservation(r.id, 'staff', null);
    await expect(checkIn(r.id, 'staff')).rejects.toMatchObject({ code: 'BAD_STATE' });
  });

  it('sweepExpired is idempotent', async () => {
    const r = await createReservation(base(inv));
    await q(`UPDATE reservations SET hold_expires_at = now() - interval '1 minute' WHERE id=$1`, [r.id]);
    const c = { query: (t: string, p?: any[]) => q(t, p).then((rows) => ({ rows, rowCount: rows.length })) } as any;
    expect((await sweepExpired(c)).length).toBe(1);
    expect((await sweepExpired(c)).length).toBe(0);
  });
});
