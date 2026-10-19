import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { q } from '@/lib/db';
import { addDays, todayLocal } from '@/lib/dates';
import { createReservation, confirmReservation, verifiedPaid } from '@/services/reservations';
import { requestExtension, decideExtension } from '@/services/extensions';
import { recordPayment, verifyPayment, payState } from '@/services/payments';
import { hasDb, resetDb, seedInventory, guest, closePool, ruleDefaults } from './helpers';

const d = (n: number) => addDays(todayLocal(), n);
let inv: Awaited<ReturnType<typeof seedInventory>>;
let staff: string;
const mk = async (over: any = {}) => {
  const r = await createReservation({ guest: guest('Ext Guest'), roomTypeId: inv.dorm, checkIn: d(10), checkOut: d(12), guestsCount: 1, source: 'telegram', status: 'pending', actor: 'test', ...over });
  await confirmReservation(r.id, 'staff', null);
  return r;
};

describe.skipIf(!hasDb)('stay extensions', () => {
  beforeEach(async () => { await resetDb(); await ruleDefaults(); inv = await seedInventory(1); staff = (await q(`INSERT INTO users(email,name,password_hash,role) VALUES('s@x.test','S','x','manager') ON CONFLICT (email) DO UPDATE SET name='S' RETURNING id`))[0].id; });

  it('free bed: creates a PENDING request with correct price, does not touch the reservation, then applies only after approval', async () => {
    const r = await mk();
    const ext = await requestExtension(r.id, d(14), 'telegram');
    expect(ext).toMatchObject({ status: 'pending', extra_nights: 2, extra_cents: 20000 });
    expect((await q('SELECT check_out,total_cents FROM reservations WHERE id=$1', [r.id]))[0]).toMatchObject({ check_out: d(12), total_cents: 20000 });
    expect((await q(`SELECT count(*)::int n FROM tasks WHERE extension_id=$1 AND status='open'`, [ext.id]))[0].n).toBe(1); // routed to staff
    const res = await decideExtension(ext.id, 'approve', 'staff', staff);
    expect(res.status).toBe('applied');
    expect((await q('SELECT check_out,total_cents FROM reservations WHERE id=$1', [r.id]))[0]).toMatchObject({ check_out: d(14), total_cents: 40000 });
    expect((await q('SELECT during FROM reservation_units WHERE reservation_id=$1', [r.id]))[0].during).toBe(`[${d(10)},${d(14)})`);
  });

  it('never extends into a bed assigned to someone else: request becomes a conflict for staff, approval is refused', async () => {
    const r = await mk();
    await mk({ guest: guest('Next Guest'), checkIn: d(12), checkOut: d(13) });
    const ext = await requestExtension(r.id, d(14), 'telegram');
    expect(ext.status).toBe('conflict');
    expect(ext.conflict_detail).toMatch(/another guest/);
    const res = await decideExtension(ext.id, 'approve', 'staff', staff);
    expect(res.status).toBe('conflict');
    expect((await q('SELECT check_out FROM reservations WHERE id=$1', [r.id]))[0].check_out).toBe(d(12));
  });

  it('a booking made AFTER the request is caught at approval time', async () => {
    const r = await mk();
    const ext = await requestExtension(r.id, d(14), 'telegram');
    await mk({ guest: guest('Late Booker'), checkIn: d(12), checkOut: d(13) });
    expect((await decideExtension(ext.id, 'approve', 'staff', staff)).status).toBe('conflict');
  });

  it('rejects invalid extensions and duplicates; reject keeps reservation unchanged', async () => {
    const r = await mk();
    await expect(requestExtension(r.id, d(11), 'telegram')).rejects.toMatchObject({ code: 'INVALID_DATES' });
    const ext = await requestExtension(r.id, d(13), 'telegram');
    await expect(requestExtension(r.id, d(14), 'telegram')).rejects.toMatchObject({ code: 'CONFLICT' });
    await decideExtension(ext.id, 'reject', 'staff', staff);
    expect((await q('SELECT check_out FROM reservations WHERE id=$1', [r.id]))[0].check_out).toBe(d(12));
    await expect(decideExtension(ext.id, 'approve', 'staff', staff)).rejects.toMatchObject({ code: 'BAD_STATE' });
  });

  it('unconfirmed reservations cannot be extended', async () => {
    const r = await createReservation({ guest: guest('P'), roomTypeId: inv.dorm, checkIn: d(10), checkOut: d(12), guestsCount: 1, source: 'website', status: 'pending', actor: 't' });
    await expect(requestExtension(r.id, d(14), 'telegram')).rejects.toMatchObject({ code: 'BAD_STATE' });
  });

  it('missing rate for extra nights routes to staff instead of guessing a price', async () => {
    const r = await mk();
    await q(`DELETE FROM rates WHERE room_type_id=$1`, [inv.dorm]);
    const ext = await requestExtension(r.id, d(14), 'telegram');
    expect(ext.status).toBe('conflict');
    await expect(decideExtension(ext.id, 'approve', 'staff', staff)).rejects.toMatchObject({ code: 'NO_RATE' });
  });
});

describe.skipIf(!hasDb)('payments', () => {
  beforeEach(async () => { await resetDb(); await ruleDefaults(); inv = await seedInventory(2); staff = (await q(`INSERT INTO users(email,name,password_hash,role) VALUES('s@x.test','S','x','manager') ON CONFLICT (email) DO UPDATE SET name='S' RETURNING id`))[0].id; });

  it('recorded payments do NOT count until verified by staff; rejected never count', async () => {
    const r = await mk();
    const p = await recordPayment(r.id, 5000, 'bank_transfer', 'REF1', null, staff, 'staff');
    expect(p.status).toBe('recorded');
    expect(await verifiedPaid({ query: (t: string, a?: any[]) => q(t, a).then((rows) => ({ rows, rowCount: rows.length })) } as any, r.id)).toBe(0);
    await verifyPayment(p.id, true, staff, 'staff');
    expect(await verifiedPaid({ query: (t: string, a?: any[]) => q(t, a).then((rows) => ({ rows, rowCount: rows.length })) } as any, r.id)).toBe(5000);
    await expect(verifyPayment(p.id, true, staff, 'staff')).rejects.toMatchObject({ code: 'BAD_STATE' });
    const p2 = await recordPayment(r.id, 99999, 'instapay', null, 'screenshot only', staff, 'staff');
    await verifyPayment(p2.id, false, staff, 'staff');
    expect(await verifiedPaid({ query: (t: string, a?: any[]) => q(t, a).then((rows) => ({ rows, rowCount: rows.length })) } as any, r.id)).toBe(5000);
  });

  it('payment state math', () => {
    expect(payState(20000, 0)).toBe('unpaid');
    expect(payState(20000, 5000)).toBe('partial');
    expect(payState(20000, 20000)).toBe('paid');
    expect(payState(20000, 25000)).toBe('overpaid');
  });

  it('rejects zero/invalid amounts and unknown methods; there is no column for card numbers', async () => {
    const r = await mk();
    await expect(recordPayment(r.id, 0, 'cash', null, null, staff, 's')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(recordPayment(r.id, 1.5 as any, 'cash', null, null, staff, 's')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(recordPayment(r.id, 100, 'bitcoin' as any, null, null, staff, 's')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const cols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='payments'`)).map((c: any) => c.column_name);
    expect(cols.some((c: string) => /card|pan|cvv/i.test(c))).toBe(false);
  });
});

afterAll(closePool);
