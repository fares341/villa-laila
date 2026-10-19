import { describe, it, expect } from 'vitest';
import { can } from '@/lib/permissions';
import { evaluate, requiredFacts, type PolicyRule } from '@/services/policy';
import { parseDateText, normalizeNationality } from '@/bot/flow';
import { validateStay, zonedToUtc, nightsBetween, addDays, todayLocal, isIsoDate } from '@/lib/dates';
import { normalizePhone } from '@/services/guests';
import { t } from '@/i18n/bot';
import { STRINGS, LANGS } from '@/i18n/bot';
import { toCents, fmtMoney } from '@/lib/money';

const rule = (o: Partial<PolicyRule>): PolicyRule => ({ id: 'aaaaaaaa-0000', name: 'R', version: 1, active: true, conditions: [{ field: 'nationality', op: 'eq', value: 'EG' }], action: 'review', questions: [], message: {}, ...o });

describe('authorization matrix', () => {
  it('receptionists cannot manage inventory, settings, users, reports, cancel or verify payments', () => {
    for (const p of ['inventory.manage', 'settings.manage', 'users.manage', 'reports.view', 'reservation.cancel', 'payment.verify', 'policy.manage', 'import.run']) expect(can('receptionist', p)).toBe(false);
    for (const p of ['reservation.create', 'reservation.confirm', 'inbox.use', 'payment.record', 'extension.decide']) expect(can('receptionist', p)).toBe(true);
  });
  it('managers cannot change settings/users/policies; owners can do everything listed', () => {
    for (const p of ['settings.manage', 'users.manage', 'policy.manage']) { expect(can('manager', p)).toBe(false); expect(can('owner', p)).toBe(true); }
    expect(can('manager', 'payment.verify')).toBe(true);
  });
  it('unknown permissions are denied by default', () => { expect(can('owner', 'does.not.exist')).toBe(false); });
});

describe('policy engine', () => {
  it('no active rules -> nothing applied, nothing rejected', () => {
    const o = evaluate([], { nationality: 'EG' });
    expect(o).toMatchObject({ needsReview: false, appliedRules: [] });
  });
  it('matching rule triggers review; non-matching does not; version is recorded', () => {
    expect(evaluate([rule({})], { nationality: 'EG' })).toMatchObject({ needsReview: true });
    expect(evaluate([rule({})], { nationality: 'ES' }).needsReview).toBe(false);
    expect(evaluate([rule({})], { nationality: 'EG' }).version).toContain('@1');
  });
  it('unknown facts route to a human instead of auto-rejecting', () => {
    const o = evaluate([rule({})], {});
    expect(o.needsReview).toBe(true);
    expect(o.undecidable).toEqual(['nationality']);
  });
  it('asks only for facts that active rules need', () => {
    expect(requiredFacts([rule({})])).toEqual(['nationality']);
    expect(requiredFacts([])).toEqual([]);
  });
  it('supports in / neq / exists operators', () => {
    expect(evaluate([rule({ conditions: [{ field: 'nationality', op: 'in', value: ['eg', 'sa'] }] })], { nationality: 'SA' }).needsReview).toBe(true);
    expect(evaluate([rule({ conditions: [{ field: 'nationality', op: 'neq', value: 'EG' }] })], { nationality: 'ES' }).needsReview).toBe(true);
  });
});

describe('dates and parsing', () => {
  it('validates stays', () => {
    const t0 = '2026-10-14';
    expect(validateStay('2026-10-15', '2026-10-16', t0)).toEqual({ ok: true });
    expect(validateStay('2026-10-13', '2026-10-16', t0)).toMatchObject({ code: 'past' });
    expect(validateStay('2026-10-16', '2026-10-16', t0)).toMatchObject({ code: 'order' });
    expect(validateStay('2026-02-30', '2026-03-02', t0)).toMatchObject({ code: 'invalid' });
    expect(validateStay('2026-10-15', '2027-10-15', t0)).toMatchObject({ code: 'too_long' });
  });
  it('counts nights across month/year/leap boundaries; checkout excluded', () => {
    expect(nightsBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(nightsBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isIsoDate('2026-13-01')).toBe(false);
  });
  it('"today" follows the hostel timezone, not UTC', () => {
    // 22:30 UTC on 14 Oct is already 15 Oct in Cairo (UTC+3 in October 2026 — Egypt DST ends last Thursday of Oct)
    expect(todayLocal(new Date('2026-10-14T22:30:00Z'), 'Africa/Cairo')).toBe('2026-10-15');
    expect(todayLocal(new Date('2026-10-14T22:30:00Z'), 'UTC')).toBe('2026-10-14');
  });
  it('converts local wall time to UTC', () => {
    expect(zonedToUtc('2026-07-01', '08:00', 'UTC').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-01-15', '08:00', 'Africa/Cairo').toISOString()).toBe('2026-01-15T06:00:00.000Z');
  });
  it('parses guest-typed dates incl. Arabic digits and DD/MM', () => {
    expect(parseDateText('15/11', '2026-10-14')).toBe('2026-11-15');
    expect(parseDateText('1/10', '2026-10-14')).toBe('2027-10-01'); // already passed this year -> next year
    expect(parseDateText('٢٠٢٦-١١-١٥', '2026-10-14')).toBe('2026-11-15');
    expect(parseDateText('31/02/2027', '2026-10-14')).toBeNull();
    expect(parseDateText('banana', '2026-10-14')).toBeNull();
  });
  it('normalizes nationality, phone and money', () => {
    expect(normalizeNationality('مصري')).toBe('EG'); expect(normalizeNationality('Egyptian')).toBe('EG'); expect(normalizeNationality('Spain')).toBe('SPAIN');
    expect(normalizePhone('01012345678')).toBe('+201012345678'); expect(normalizePhone('+34 600 11 22 33')).toBe('+34600112233'); expect(normalizePhone('abc')).toBeNull();
    expect(toCents('12.34')).toBe(1234); expect(toCents('0.1') + toCents('0.2')).toBe(30); expect(fmtMoney(25000)).toBe('250 EGP');
  });
});

describe('translations', () => {
  it('every language has every key (no missing/untranslated bot strings)', () => {
    const keys = Object.keys(STRINGS.en);
    for (const l of LANGS) {
      const missing = keys.filter((k) => !(k in STRINGS[l]));
      expect(missing, `missing in ${l}`).toEqual([]);
    }
  });
  it('placeholders are preserved in every translation', () => {
    for (const k of Object.keys(STRINGS.en)) {
      const ph = (STRINGS.en[k].match(/\{\w+\}/g) ?? []).sort().join();
      for (const l of LANGS) expect((STRINGS[l][k].match(/\{\w+\}/g) ?? []).sort().join(), `${l}.${k}`).toBe(ph);
    }
  });
  it('critical messages never say "confirmed" for a request', () => {
    expect(t('en', 'request_created', { ref: 'VL-X', until: 'soon' })).toContain('NOT confirmed');
    expect(t('ar', 'request_created', { ref: 'VL-X', until: 'x' })).toContain('لم يتأكد');
  });
});
