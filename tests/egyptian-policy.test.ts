import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { q } from '@/lib/db';
import { createReservation } from '@/services/reservations';
import { BookingError } from '@/services/errors';
import { normalizeGovernorate } from '@/services/policy';
import { addDays, todayLocal } from '@/lib/dates';
import { hasDb, resetDb, ruleDefaults, seedInventory, guest, closePool } from './helpers';

const d = hasDb ? describe : describe.skip;
const ci = addDays(todayLocal(), 5), co = addDays(todayLocal(), 7);

d('Egyptian guest rules', () => {
  let inv: Awaited<ReturnType<typeof seedInventory>>;
  beforeAll(async () => { await ruleDefaults(); });
  beforeEach(async () => {
    await resetDb(); inv = await seedInventory(3);
    await q(`INSERT INTO policy_rules(name,active,conditions,action,message) VALUES
      ('no mixed dorm',true,'[{"field":"nationality","op":"eq","value":"EG"},{"field":"room_kind","op":"eq","value":"dorm"},{"field":"room_gender","op":"eq","value":"mixed"}]','block','{"key":"dorm"}'),
      ('no id gov',true,'[{"field":"nationality","op":"eq","value":"EG"},{"field":"id_governorate","op":"in","value":["cairo","giza","qalyubia"]}]','block','{"key":"id"}')`);
  });
  afterAll(async () => { await q(`DELETE FROM policy_rules WHERE name IN ('no mixed dorm','no id gov')`); await closePool(); });
  const book = (roomTypeId: string, facts: any, source: any = 'website') =>
    createReservation({ guest: guest('Eg Guest'), roomTypeId, checkIn: ci, checkOut: co, guestsCount: 1, source, status: 'pending', facts, actor: 't' });

  it('blocks Egyptians from a mixed dorm', async () => {
    await expect(book(inv.dorm, { nationality: 'EG', id_governorate: 'alexandria' })).rejects.toMatchObject({ code: 'POLICY_BLOCKED' });
  });
  it('allows an Egyptian (non-Cairo/Giza/Qalyubia ID) in a private room', async () => {
    const r = await book(inv.priv, { nationality: 'EG', id_governorate: 'alexandria' });
    expect(r.status).toBe('pending');
  });
  it('blocks Cairo / Giza / Qalyubia IDs from any room', async () => {
    for (const g of ['القاهرة', 'Giza', 'القليوبية']) {
      await expect(book(inv.priv, { nationality: 'EG', id_governorate: normalizeGovernorate(g) })).rejects.toMatchObject({ code: 'POLICY_BLOCKED' });
    }
  });
  it('unknown governorate is sent to staff review, not rejected', async () => {
    const r = await book(inv.priv, { nationality: 'EG' });
    expect(r.needs_review).toBe(true);
  });
  it('foreigners are unaffected', async () => {
    expect((await book(inv.dorm, { nationality: 'ES' })).status).toBe('pending');
  });
  it('staff can override a block (flagged for review)', async () => {
    const r = await book(inv.dorm, { nationality: 'EG', id_governorate: 'alexandria' }, 'staff');
    expect(r.needs_review).toBe(true);
  });
});
