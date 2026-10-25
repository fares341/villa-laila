'use server';
import type { CardPayer } from '@/services/pms/card-payers';
import { requireUser, currentUser } from '@/lib/auth';
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
import { getRates, refreshRates, OTHER_CURRENCIES, type Currency } from '@/services/pms/fx';
import { taxiMessage, waLink, setTaxiConfirmed } from '@/services/pms/taxi';
import { recordTaken, recordExchange, unpaidEventTickets, payEventTicket, posEvents, sellEventTicket, checkInEventTicket, openChange, settleChange, type ChangeInput } from '@/services/pms/pos';
import { runForStaff, runView, taxiLine, saveTask, finishWithNote, reassignTask, redistribute, setWashReady, setRunNotes, handoverText } from '@/services/pms/tasks';

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

const fail = (e: unknown): ActionResult<never> => {
  if (e instanceof BookingError) return { ok: false, error: e.message && e.message !== e.code ? e.message : e.code.replace(/_/g, ' ').toLowerCase() };
  console.error('[pos]', e);
  return { ok: false, error: 'Something went wrong. Try again.' };
};

async function device() {
  const u = await currentUser().catch(() => null);
  return u ?? { id: 'pos-terminal', email: 'pos@villalayla.com', name: 'POS Terminal', role: 'admin' as const };
}

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
        tasks: me ? await myTaskCounts(me.id).catch(() => null) : null,
        rates: me ? await refreshRates().catch(() => getRates()) : null,
        canTake: me ? !!(await q<any>(`SELECT can_take_cash FROM staff WHERE id=$1`, [me.id]))[0]?.can_take_cash : false,
        takers: me ? await q<any>(`SELECT id, full_name FROM staff WHERE active AND can_take_cash AND pin_hash IS NOT NULL ORDER BY full_name`) : [],
        // Rare currencies the last shift left in the drawer: the next person counts them too.
        handoverExtra: !shift ? await q<any>(`SELECT z_report->'currencies' c FROM cash_shifts WHERE status='closed' AND z_report IS NOT NULL ORDER BY closed_at DESC LIMIT 1`)
          .then((r) => Object.entries((r[0]?.c ?? {}) as Record<string, any>).filter(([k, v]) => !['EGP', 'USD', 'EUR'].includes(k) && Number(v?.counted) > 0).map(([k]) => k)).catch(() => []) : [],
        otherCurrencies: OTHER_CURRENCIES,
        changeOwed: me ? await openChange().catch(() => []) : [],
        currencies: totals ? Object.fromEntries(Object.entries(totals.currencies).map(([k, v]: any) => [k, me?.is_manager ? v.expected : null])) : null,
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

/** Receiving the drawer: the incoming person counts each currency. */
export async function posOpenShift(counts: number | Record<string, number>): Promise<ActionResult<any>> {
  try {
    const u = await device();
    const me = await cashier();
    const r = await openPosShift(me.id, counts, u.id);
    return { ok: true, data: { no: r.shift.shift_no, late: r.attendance.delay_minutes, tier: r.attendance.tier, mismatch: r.mismatch } };
  } catch (e) { return fail(e); }
}

async function myShift(me: { id: string; is_manager: boolean }) {
  const s = await openShiftRow();
  if (!s) throw new BookingError('BAD_STATE', 'Open a shift first.');
  if (s.staff_id !== me.id && !me.is_manager) throw new BookingError('FORBIDDEN', `Shift #${s.shift_no} belongs to ${s.staff_name}. Ask them to close it first.`);
  return s;
}

export async function posSale(input: { reservationId?: string | null; items: PosItemInput[]; mode: SettleMode; method?: PayMethod; compNote?: string; approverId?: string; approverPin?: string; compBalance?: boolean; cashCurrency?: string; cardPayer?: CardPayer | null; tipMinor?: number; walletRef?: string | null; change?: ChangeInput | null }): Promise<ActionResult<any>> {
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

export async function posTakePayment(reservationId: string, amountCents: number, method: PayMethod, currency: string = 'EGP', cardPayer: CardPayer | null = null, tipMinor = 0, walletRef: string | null = null, change: ChangeInput | null = null): Promise<ActionResult<any>> {
  try {
    const u = await device();
    const me = await cashier();
    const s = await myShift(me);
    const r = await takeFolioPayment({ reservationId, amountCents: Math.round(amountCents), method, currency, shiftId: s.id, staffId: me.id, userId: u.id, note: `Received at POS by ${me.full_name}`, actor: 'pos:' + me.full_name, cardPayer, staffName: me.full_name, tipMinor: Math.round(tipMinor) || 0, walletRef, change });
    return { ok: true, data: r };
  } catch (e) { return fail(e); }
}

export async function posExpense(input: { amountCents: number; category: string; description: string; approverId: string; approverPin: string; currency?: Currency }): Promise<ActionResult<null>> {
  try {
    await device();
    const me = await cashier();
    const s = await myShift(me);
    await recordExpense(s.id, me.id, input);
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}

/** Blind close: the cashier only types what they counted; the Z-report comes back after. */
export async function posCloseShift(counted: number | Record<string, number>, note: string): Promise<ActionResult<any>> {
  try {
    await device();
    const me = await cashier();
    const s = await myShift(me);
    const z = await closePosShiftBlind(s.id, counted, me.id, note?.trim() ? `Close note: ${note.trim()}` : null);
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

/* ───────── Shift tasks ───────── */

export async function posTasks(): Promise<ActionResult<any>> {
  try {
    await device();
    const me = await cashier();
    const s = await runForStaff(me.id);
    if (!s) return { ok: true, data: { run: null, me } };
    const v = await runView(s.run.id);
    const taxis = v.taxis.map((x: any) => { const msg = taxiMessage(x); return { ...x, line: taxiLine(x), message: msg, wa: waLink(x.phone, msg) }; });
    return {
      ok: true,
      data: {
        me, run: { id: v.run.id, label: v.run.label, date: v.run.work_date, notes: v.run.notes, distributed: !!v.run.distributed_at, shareAt: s.shareLastAt.toISOString(), shareStartAt: s.shareStartAt.toISOString() },
        tasks: v.tasks, unpaid: v.unpaid, washes: v.washes, tours: v.tours, taxis,
        staff: s.staff.map((x: any) => ({ id: x.id, name: x.full_name })),
        onDuty: s.staff.some((x: any) => x.id === me.id),
      },
    };
  } catch (e) { return fail(e); }
}

export async function posTaskSave(taskId: string, input: { items?: { label: string; done: boolean }[]; note?: string | null; done?: boolean; withNote?: boolean }): Promise<ActionResult<null>> {
  try {
    await device();
    const me = await cashier();
    if (input.withNote) await finishWithNote(taskId, me, input.note ?? '');
    else await saveTask(taskId, me, input);
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}

export async function posTaskReassign(taskId: string, staffId: string): Promise<ActionResult<null>> {
  try {
    await device();
    const me = await cashier();
    if (!me.is_manager) throw new BookingError('FORBIDDEN', 'Only a manager can move tasks');
    await reassignTask(taskId, staffId || null, 'pos:' + me.full_name);
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}

export async function posTasksShare(): Promise<ActionResult<number>> {
  try {
    await device();
    const me = await cashier();
    if (!me.is_manager) throw new BookingError('FORBIDDEN', 'Tasks are shared automatically; a manager can share them now');
    const s = await runForStaff(me.id);
    if (!s) throw new BookingError('BAD_STATE', 'No shift is running right now');
    const n = await redistribute(s.run.id, 'pos:' + me.full_name);
    return { ok: true, data: n };
  } catch (e) { return fail(e); }
}

export async function posWashReady(serviceOrderId: string, ready: boolean): Promise<ActionResult<null>> {
  try { await device(); await cashier(); await setWashReady(serviceOrderId, ready); return { ok: true, data: null }; } catch (e) { return fail(e); }
}

export async function posRunNotes(runId: string, notes: string): Promise<ActionResult<null>> {
  try { await device(); await cashier(); await setRunNotes(runId, notes.slice(0, 1000)); return { ok: true, data: null }; } catch (e) { return fail(e); }
}

export async function posHandover(runId: string): Promise<ActionResult<string>> {
  try { await device(); await cashier(); return { ok: true, data: await handoverText(runId) }; } catch (e) { return fail(e); }
}

async function myTaskCounts(staffId: string) {
  const s = await runForStaff(staffId);
  if (!s) return null;
  const r = (await q<any>(`SELECT count(*) FILTER (WHERE assigned_to=$2)::int mine, count(*) FILTER (WHERE assigned_to=$2 AND status='pending')::int open,
                                  count(*)::int total, count(*) FILTER (WHERE status='pending')::int team_open
                           FROM shift_tasks WHERE run_id=$1`, [s.run.id, staffId]))[0];
  return { ...r, distributed: !!s.run.distributed_at, shareAt: s.shareLastAt.toISOString(), shift: s.shift.label };
}

/** Cash removed from the drawer by the owner (Taken). Their own PIN; only staff allowed to take cash. */
export async function posTaken(input: { takerId: string; takerPin: string; amounts: Record<string, number>; note?: string }): Promise<ActionResult<any>> {
  try {
    await device();
    const me = await cashier();
    const s = await openShiftRow();
    if (!s) throw new BookingError('BAD_STATE', 'No drawer is open');
    void me;
    return { ok: true, data: await recordTaken(s.id, input) };
  } catch (e) { return fail(e); }
}

export async function posExchange(input: { currency: string; foreignMinor: number; rate?: number | null; guest?: string | null; reservationId?: string | null }): Promise<ActionResult<any>> {
  try {
    await device();
    const me = await cashier();
    const s = await openShiftRow();
    if (!s) throw new BookingError('BAD_STATE', 'No drawer is open');
    return { ok: true, data: await recordExchange(s.id, me.id, input) };
  } catch (e) { return fail(e); }
}

export async function posEventTickets(): Promise<ActionResult<any[]>> {
  try { await device(); await cashier(); return { ok: true, data: await unpaidEventTickets() }; } catch (e) { return fail(e); }
}

export async function posPayEvent(input: { bookingId: string; method: PayMethod; walletRef?: string | null; cardPayer?: { name: string; nationality: string; passport: string } | null; tipMinor?: number; change?: ChangeInput | null }): Promise<ActionResult<any>> {
  try {
    await device();
    const me = await cashier();
    const s = await openShiftRow();
    if (!s) throw new BookingError('BAD_STATE', 'No drawer is open');
    return { ok: true, data: await payEventTicket(s.id, { ...input, staffName: me.full_name, staffId: me.id }) };
  } catch (e) { return fail(e); }
}

export async function posCheckInEvent(bookingId: string): Promise<ActionResult<any>> {
  try { await device(); const me = await cashier(); return { ok: true, data: await checkInEventTicket(bookingId, me.full_name) }; } catch (e) { return fail(e); }
}

export async function posExtendInfo(reservationId: string): Promise<ActionResult<{ freeNights: number; checkOut: string }>> {
  try {
    await device(); await cashier();
    const { freeNightsAfter } = await import('@/services/pms/extend');
    const r = (await q<any>(`SELECT check_out FROM reservations WHERE id=$1`, [reservationId]))[0];
    return { ok: true, data: { freeNights: await freeNightsAfter(reservationId), checkOut: r?.check_out } };
  } catch (e) { return fail(e); }
}

/** Extend a stay from the POS (same bed, extra nights on the bill); the money is then taken right here. */
export async function posExtend(reservationId: string, nights: number): Promise<ActionResult<any>> {
  try {
    const u = await device(); const me = await cashier();
    const { extendStay } = await import('@/services/pms/extend');
    return { ok: true, data: await extendStay(reservationId, { nights: Math.trunc(nights) }, 'pos:' + me.full_name, u.id) };
  } catch (e) { return fail(e); }
}

export async function posEventList(): Promise<ActionResult<any[]>> {
  try { await device(); await cashier(); return { ok: true, data: await posEvents() }; } catch (e) { return fail(e); }
}

export async function posSellEvent(input: { eventId: string; date: string; quantity: number; optionKey?: string | null; fullName: string; phone?: string | null; reservationId?: string | null; method: PayMethod; walletRef?: string | null; cardPayer?: { name: string; nationality: string; passport: string } | null; tipMinor?: number; change?: ChangeInput | null; dinner?: boolean }): Promise<ActionResult<any>> {
  try {
    await device();
    const me = await cashier();
    const s = await openShiftRow();
    if (!s) throw new BookingError('BAD_STATE', 'No drawer is open');
    return { ok: true, data: await sellEventTicket(s.id, { ...input, staffName: me.full_name, staffId: me.id }) };
  } catch (e) { return fail(e); }
}

export async function posTaxiConfirmed(taxiId: string, confirmed: boolean): Promise<ActionResult<null>> {
  try { await device(); const me = await cashier(); await setTaxiConfirmed(taxiId, confirmed, me.id); return { ok: true, data: null }; } catch (e) { return fail(e); }
}

/** Change guests will come back for (from any shift). */
export async function posChangeList(): Promise<ActionResult<any[]>> {
  try { await device(); await cashier(); return { ok: true, data: await openChange() }; } catch (e) { return fail(e); }
}

/** The guest took their change (it leaves the drawer now) or said keep it (it becomes a tip). */
export async function posChangeSettle(id: string, action: 'given' | 'tip'): Promise<ActionResult<any>> {
  try {
    await device();
    const me = await cashier();
    const s = await myShift(me);
    return { ok: true, data: await settleChange(id, action, s.id, me.id, me.full_name) };
  } catch (e) { return fail(e); }
}
