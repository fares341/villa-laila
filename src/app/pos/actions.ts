'use server';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { setPosStaff, clearPosStaff, posStaffId } from '@/lib/pos-session';
import { rateLimit } from '@/lib/ratelimit';
import { BookingError } from '@/services/errors';
import { verifyPin, clockIn, clockOut } from '@/services/pms/staff';
import {
  openShiftRow, openPosShift, shiftTotals, todaysRevenue, closePosShiftBlind, recordExpense, posCatalog, inHouseGuests, processSale, takeFolioPayment, recentSales,
  type PosItemInput, type SettleMode, type PayMethod,
} from '@/services/pms/pos';
import { getFolio } from '@/services/pms/folio';
import { channelEnabled } from '@/services/pms/channel';

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

const fail = (e: unknown): ActionResult<never> => {
  if (e instanceof BookingError) return { ok: false, error: e.message && e.message !== e.code ? e.message : e.code.replace(/_/g, ' ').toLowerCase() };
  console.error('[pos]', e);
  return { ok: false, error: 'Something went wrong. Try again.' };
};

async function device() { return requireUser('pos.use'); }

async function cashier() {
  const sid = await posStaffId();
  if (!sid) throw new BookingError('FORBIDDEN', 'Screen is locked. Enter your PIN.');
  const s = (await q<any>(`SELECT id, full_name, role, is_manager FROM staff WHERE id=$1 AND active`, [sid]))[0];
  if (!s) throw new BookingError('FORBIDDEN', 'Screen is locked. Enter your PIN.');
  return s as { id: string; full_name: string; role: string; is_manager: boolean };
}

/** Everything the POS screen shows, in one round-trip. */
export async function posState(): Promise<ActionResult<any>> {
  try {
    await device();
    const sid = await posStaffId();
    const me = sid ? (await q<any>(`SELECT id, full_name, role, is_manager FROM staff WHERE id=$1 AND active`, [sid]))[0] ?? null : null;
    const shift = await openShiftRow();
    const [catalog, guests, revenue, totals, sales, onClock] = await Promise.all([
      me ? posCatalog() : Promise.resolve(null),
      me ? inHouseGuests() : Promise.resolve([]),
      me ? todaysRevenue() : Promise.resolve(0),
      me && shift ? shiftTotals(shift.id) : Promise.resolve(null),
      me && shift ? recentSales(shift.id) : Promise.resolve([]),
      me ? q<any>(`SELECT clock_in_at, delay_minutes, tier FROM staff_attendance WHERE staff_id=$1 AND clock_out_at IS NULL`, [me.id]).then((r) => r[0] ?? null) : Promise.resolve(null),
    ]);
    return {
      ok: true,
      data: {
        me, shift: shift ? { id: shift.id, no: shift.shift_no, staffId: shift.staff_id, staffName: shift.staff_name, openedAt: shift.opened_at ?? shift.created_at } : null,
        catalog, guests, revenue, onClock,
        drawer: totals && me?.is_manager ? totals.expectedCash : null,
        sales, channel: channelEnabled(), serverTime: new Date().toISOString(),
      },
    };
  } catch (e) { return fail(e); }
}

export async function posStaffList(): Promise<ActionResult<any[]>> {
  try {
    await device();
    return { ok: true, data: await q<any>(`SELECT id, full_name, role, is_manager FROM staff WHERE active AND can_use_pos AND pin_hash IS NOT NULL ORDER BY full_name`) };
  } catch (e) { return fail(e); }
}

export async function posUnlock(staffId: string, pin: string): Promise<ActionResult<{ name: string }>> {
  try {
    await device();
    if (!rateLimit('pin:' + staffId, 8, 5 * 60_000)) return { ok: false, error: 'Too many wrong PINs. Wait 5 minutes.' };
    const s = await verifyPin(staffId, pin);
    if (!s) return { ok: false, error: 'Wrong PIN' };
    await setPosStaff(s.id);
    return { ok: true, data: { name: s.full_name } };
  } catch (e) { return fail(e); }
}

export async function posLock(): Promise<ActionResult<null>> {
  await clearPosStaff();
  return { ok: true, data: null };
}

/** Clock in/out without touching the drawer (housekeeping, kitchen …). */
export async function posClock(staffId: string, pin: string, direction: 'in' | 'out'): Promise<ActionResult<any>> {
  try {
    await device();
    if (!rateLimit('pin:' + staffId, 8, 5 * 60_000)) return { ok: false, error: 'Too many wrong PINs. Wait 5 minutes.' };
    const s = await verifyPin(staffId, pin);
    if (!s) return { ok: false, error: 'Wrong PIN' };
    if (direction === 'in') {
      const r = await clockIn(s.id, { source: 'pos' });
      return { ok: true, data: { name: s.full_name, already: r.alreadyIn, minutes: r.attendance.delay_minutes, tier: r.attendance.tier } };
    }
    const open = (await q<any>(`SELECT 1 FROM cash_shifts WHERE status='open' AND staff_id=$1`, [s.id]))[0];
    if (open) return { ok: false, error: 'Close your POS shift first (Close Shift).' };
    const r = await clockOut(s.id);
    return { ok: true, data: { name: s.full_name, out: !!r } };
  } catch (e) { return fail(e); }
}

export async function posOpenShift(floatCents: number): Promise<ActionResult<any>> {
  try {
    const u = await device();
    const me = await cashier();
    const r = await openPosShift(me.id, Math.round(floatCents), u.id);
    return { ok: true, data: { no: r.shift.shift_no, late: r.attendance.delay_minutes, tier: r.attendance.tier } };
  } catch (e) { return fail(e); }
}

async function myShift(me: { id: string; is_manager: boolean }) {
  const s = await openShiftRow();
  if (!s) throw new BookingError('BAD_STATE', 'Open a shift first.');
  if (s.staff_id !== me.id && !me.is_manager) throw new BookingError('FORBIDDEN', `Shift #${s.shift_no} belongs to ${s.staff_name}. Ask them to close it first.`);
  return s;
}

export async function posSale(input: { reservationId?: string | null; items: PosItemInput[]; mode: SettleMode; method?: PayMethod; compNote?: string; approverId?: string; approverPin?: string; compBalance?: boolean }): Promise<ActionResult<any>> {
  try {
    const u = await device();
    const me = await cashier();
    const s = await myShift(me);
    const r = await processSale({ ...input, shiftId: s.id, staffId: me.id, staffName: me.full_name, deviceUserId: u.id });
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

export async function posGuestFolio(reservationId: string): Promise<ActionResult<any>> {
  try {
    await device(); await cashier();
    const f = await getFolio(reservationId);
    return { ok: true, data: { lines: f.lines, payments: f.payments.filter((p: any) => p.status === 'verified'), charges: f.charges + f.credits, paid: f.paid, balance: f.balance, state: f.state, currency: f.currency } };
  } catch (e) { return fail(e); }
}

export async function posTakePayment(reservationId: string, amountCents: number, method: PayMethod): Promise<ActionResult<null>> {
  try {
    const u = await device();
    const me = await cashier();
    const s = await myShift(me);
    await takeFolioPayment({ reservationId, amountCents: Math.round(amountCents), method, shiftId: s.id, staffId: me.id, userId: u.id, note: `Taken at POS by ${me.full_name}`, actor: 'pos:' + me.full_name });
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}

export async function posExpense(input: { amountCents: number; category: string; description: string; approverId: string; approverPin: string }): Promise<ActionResult<null>> {
  try {
    await device();
    const me = await cashier();
    const s = await myShift(me);
    await recordExpense(s.id, me.id, input);
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}

/** Blind close: the cashier only types what they counted; the Z-report comes back after. */
export async function posCloseShift(countedCents: number, note: string): Promise<ActionResult<any>> {
  try {
    await device();
    const me = await cashier();
    const s = await myShift(me);
    const z = await closePosShiftBlind(s.id, Math.round(countedCents), me.id, note?.trim() ? `Close note: ${note.trim()}` : null);
    await clearPosStaff();
    return { ok: true, data: z };
  } catch (e) { return fail(e); }
}

export async function posManagers(): Promise<ActionResult<any[]>> {
  try {
    await device();
    return { ok: true, data: await q<any>(`SELECT id, full_name FROM staff WHERE active AND is_manager AND pin_hash IS NOT NULL ORDER BY full_name`) };
  } catch (e) { return fail(e); }
}
