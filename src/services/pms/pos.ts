import { randomUUID } from 'node:crypto';
import { q, tx } from '@/lib/db';
import type { Q } from '@/lib/db';
import { todayLocal } from '@/lib/dates';
import { cleanPayer, recordCardPayer, type CardPayer } from './card-payers';
import { BookingError } from '../errors';
import { audit } from '../audit';
import { verifyPin, clockIn, clockOut } from './staff';
import { getFolio } from './folio';
import { rateFor, toEgp, type Currency } from './fx';
import { onDrawerReceived, onTourSold } from './tasks';

export type PosItemInput = { type: 'product' | 'tour' | 'custom'; id?: string; name?: string; qty: number; unitCents?: number };
export type SettleMode = 'charge_room' | 'pay_now' | 'settle_all' | 'walk_in' | 'comp';
export type PayMethod = 'cash' | 'card';

/* ───────── Shift ───────── */

export async function openShiftRow() {
  return (await q<any>(`SELECT cs.*, s.full_name staff_name FROM cash_shifts cs LEFT JOIN staff s ON s.id=cs.staff_id WHERE cs.status='open' ORDER BY cs.created_at DESC LIMIT 1`))[0] ?? null;
}

function shiftLabel(now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: process.env.HOSTEL_TZ || 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(now));
  return h >= 6 && h < 14 ? 'Morning' : h >= 14 && h < 22 ? 'Evening' : 'Night';
}

export type Counts = { EGP: number; USD: number; EUR: number };
const cleanCounts = (c: Partial<Counts> | number | undefined): Counts => {
  const o = typeof c === 'number' ? { EGP: c } : c ?? {};
  const v = (x: any) => (Number.isFinite(Number(x)) ? Math.max(0, Math.round(Number(x))) : 0);
  return { EGP: v(o.EGP), USD: v(o.USD), EUR: v(o.EUR) };
};
const countsText = (c: Counts) => `EGP ${c.EGP / 100} · USD ${c.USD / 100} · EUR ${c.EUR / 100}`;

/**
 * The incoming person receives the drawer: they count each currency (that is the "Money received and checked" task).
 * If it differs from what the outgoing person counted at close, the manager gets a handover task.
 */
export async function openPosShift(staffId: string, counted: Partial<Counts> | number, deviceUserId: string) {
  const c = cleanCounts(counted);
  const shift = await tx(async (cl) => {
    await cl.query(`SELECT pg_advisory_xact_lock(hashtext('pos-shift'))`);
    const open = (await cl.query(`SELECT id FROM cash_shifts WHERE status='open' LIMIT 1`)).rows[0];
    if (open) throw new BookingError('BAD_STATE', 'A shift is already open. Close it before opening a new one.');
    return (await cl.query(
      `INSERT INTO cash_shifts(shift_date, shift_name, opened_by, staff_id, drawer_egp_start, drawer_usd_start, drawer_eur_start, open_count, opened_at, status)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),'open') RETURNING *`,
      [todayLocal(), shiftLabel(), deviceUserId, staffId, c.EGP, c.USD / 100, c.EUR / 100, JSON.stringify(c)])).rows[0];
  });
  const att = await clockIn(staffId, { cashShiftId: shift.id, source: 'pos' });
  // Compare with the previous handover count.
  const prev = (await q<any>(`SELECT cs.shift_no, cs.z_report, s.full_name FROM cash_shifts cs LEFT JOIN staff s ON s.id=cs.staff_id
                               WHERE cs.status='closed' AND cs.z_report IS NOT NULL AND cs.id <> $1 ORDER BY cs.closed_at DESC LIMIT 1`, [shift.id]))[0];
  let mismatch: string | null = null;
  if (prev?.z_report?.currencies) {
    const pc = cleanCounts({ EGP: prev.z_report.currencies.EGP?.counted, USD: prev.z_report.currencies.USD?.counted, EUR: prev.z_report.currencies.EUR?.counted });
    const diffs = (['EGP', 'USD', 'EUR'] as const).filter((k) => pc[k] !== c[k]).map((k) => `${k} ${(c[k] - pc[k]) / 100 > 0 ? '+' : ''}${(c[k] - pc[k]) / 100}`);
    if (diffs.length) {
      mismatch = diffs.join(', ');
      await q(`INSERT INTO tasks(title,detail,kind,dedupe_key) VALUES($1,$2,'payment',$3) ON CONFLICT (dedupe_key) DO NOTHING`,
        [`Drawer handover mismatch: shift #${shift.shift_no} received ${mismatch}`, `Shift #${prev.shift_no} (${prev.full_name ?? ''}) left ${countsText(pc)}. Received ${countsText(c)}.`, 'handover:' + shift.id]);
    }
  }
  await onDrawerReceived(staffId, c, mismatch).catch((e) => console.error('[tasks] drawer', e));
  await audit('pos', 'shift.open', 'cash_shift', shift.id, { staffId, counted: c, mismatch });
  return { shift, attendance: att.attendance, alreadyClockedIn: att.alreadyIn, mismatch };
}

/** Cash the drawer should hold right now, per currency (never shown to the cashier before the blind count). */
export async function shiftTotals(shiftId: string) {
  const s = (await q<any>(`SELECT * FROM cash_shifts WHERE id=$1`, [shiftId]))[0];
  if (!s) throw new BookingError('NOT_FOUND');
  const sales = (await q<any>(`
    SELECT
      COALESCE(sum(amount_cents) FILTER (WHERE payment_method='cash' AND payment_status='paid'),0)::bigint cash_sales,
      COALESCE(sum(amount_cents) FILTER (WHERE payment_method='card_terminal' AND payment_status='paid'),0)::bigint card_sales,
      COALESCE(sum(amount_cents) FILTER (WHERE payment_status='charged_to_room'),0)::bigint room_charges,
      COALESCE(sum(amount_cents) FILTER (WHERE payment_status='comp'),0)::bigint comp_sales,
      COALESCE(sum((COALESCE(unit_price_cents, 0) - unit_cost_cents) * quantity) FILTER (WHERE tour_id IS NOT NULL AND payment_status <> 'void'),0)::bigint tour_profit,
      count(DISTINCT sale_id)::int sales_count
    FROM service_orders WHERE shift_id=$1 AND payment_status <> 'void'`, [shiftId]))[0];
  const salesCur = await q<any>(`SELECT paid_currency cur, COALESCE(sum(CASE WHEN paid_currency='EGP' THEN amount_cents ELSE paid_amount_minor END),0)::bigint n
                                 FROM service_orders WHERE shift_id=$1 AND payment_method='cash' AND payment_status='paid' GROUP BY paid_currency`, [shiftId]);
  const pays = (await q<any>(`
    SELECT COALESCE(sum(amount_cents) FILTER (WHERE method='cash'),0)::bigint cash, COALESCE(sum(amount_cents) FILTER (WHERE method='card_terminal'),0)::bigint card
    FROM payments WHERE shift_id=$1 AND status='verified'`, [shiftId]))[0];
  const paysCur = await q<any>(`SELECT cash_currency cur, COALESCE(sum(COALESCE(cash_amount_minor, amount_cents)),0)::bigint n
                                FROM payments WHERE shift_id=$1 AND status='verified' AND method='cash' GROUP BY cash_currency`, [shiftId]);
  const expCur = await q<any>(`SELECT currency cur, COALESCE(sum(amount_cents),0)::bigint n FROM cash_expenses WHERE shift_id=$1 AND approved GROUP BY currency`, [shiftId]);
  const taken = (await q<any>(`SELECT COALESCE(sum(egp_cents),0)::bigint egp, COALESCE(sum(usd_cents),0)::bigint usd, COALESCE(sum(eur_cents),0)::bigint eur FROM cash_taken WHERE shift_id=$1`, [shiftId]))[0];
  const comps = (await q<any>(`SELECT COALESCE(sum(amount_cents),0)::bigint c FROM owner_comps WHERE shift_id=$1`, [shiftId]))[0];
  const ev = (await q<any>(`SELECT COALESCE(sum(total_cents),0)::bigint c FROM event_bookings WHERE shift_id=$1 AND status='paid' AND pay_method='cash'`, [shiftId]))[0];
  const evCard = (await q<any>(`SELECT COALESCE(sum(total_cents),0)::bigint c FROM event_bookings WHERE shift_id=$1 AND status='paid' AND pay_method='card'`, [shiftId]))[0];
  // Money exchange: foreign notes come in, EGP goes out (not a sale).
  const exch = (await q<any>(`SELECT COALESCE(sum(egp_cents),0)::bigint egp, COALESCE(sum(foreign_minor) FILTER (WHERE currency='USD'),0)::bigint usd, COALESCE(sum(foreign_minor) FILTER (WHERE currency='EUR'),0)::bigint eur FROM cash_exchanges WHERE shift_id=$1`, [shiftId]).catch(() => [{ egp: 0, usd: 0, eur: 0 }]))[0];
  const exchBy: Counts = { EGP: -Number(exch.egp), USD: Number(exch.usd), EUR: Number(exch.eur) };
  const pick = (rows: any[], cur: string) => Number(rows.find((r) => r.cur === cur)?.n ?? 0);
  const openings: Counts = { EGP: Number(s.drawer_egp_start), USD: Math.round(Number(s.drawer_usd_start) * 100), EUR: Math.round(Number(s.drawer_eur_start) * 100) };
  const takenBy: Counts = { EGP: Number(taken.egp), USD: Number(taken.usd), EUR: Number(taken.eur) };
  const currencies: Record<string, { opening: number; sales: number; payments: number; events: number; exchange: number; expenses: number; taken: number; expected: number }> = {};
  for (const cur of ['EGP', 'USD', 'EUR'] as const) {
    const row = { opening: openings[cur], sales: pick(salesCur, cur), payments: pick(paysCur, cur), events: cur === 'EGP' ? Number(ev.c) : 0, exchange: exchBy[cur], expenses: pick(expCur, cur), taken: takenBy[cur], expected: 0 };
    row.expected = row.opening + row.sales + row.payments + row.events + row.exchange - row.expenses - row.taken;
    currencies[cur] = row;
  }
  const egp = currencies.EGP;
  return {
    shift: s, opening: egp.opening, cashSales: egp.sales, cardSales: Number(sales.card_sales) + Number(evCard.c), eventCard: Number(evCard.c), roomCharges: Number(sales.room_charges),
    roomCashPayments: egp.payments, eventCash: egp.events, roomCardPayments: Number(pays.card), expenses: egp.expenses, taken: egp.taken, comps: Number(comps.c),
    tourProfit: Number(sales.tour_profit), salesCount: sales.sales_count, expectedCash: egp.expected, currencies,
    allCashEgp: Number(sales.cash_sales) + Number(pays.cash),
  };
}

/**
 * Today's revenue (all cashiers) = money collected today, counted once:
 * POS sales paid on the spot + payments received on guest folios (incl. settling room charges) + event tickets paid.
 * Room charges are not counted until the guest pays them, so nothing is double-counted.
 */
export async function todaysRevenueBreakdown(day = todayLocal()) {
  const r = (await q<any>(`
    SELECT
      (SELECT COALESCE(sum(amount_cents),0) FROM service_orders WHERE order_date=$1 AND payment_status='paid')::bigint pos,
      (SELECT COALESCE(sum(amount_cents),0) FROM payments WHERE status='verified' AND amount_cents > 0
         AND (COALESCE(verified_at, created_at) AT TIME ZONE 'Africa/Cairo')::date=$1::date)::bigint folio,
      (SELECT COALESCE(sum(total_cents),0) FROM event_bookings WHERE status='paid' AND (paid_at AT TIME ZONE 'Africa/Cairo')::date=$1::date)::bigint events`, [day]))[0];
  const pos = Number(r.pos), folio = Number(r.folio), events = Number(r.events);
  return { day, pos, folio, events, total: pos + folio + events };
}

export async function todaysRevenue() {
  return (await todaysRevenueBreakdown()).total;
}

export async function closePosShiftBlind(shiftId: string, counted: Partial<Counts> | number, staffId: string, note: string | null) {
  const c = cleanCounts(counted);
  const t = await shiftTotals(shiftId);
  if (t.shift.status !== 'open') throw new BookingError('BAD_STATE', 'This shift is already closed');
  const closedAt = new Date();
  const hours = (closedAt.getTime() - new Date(t.shift.opened_at ?? t.shift.created_at).getTime()) / 3600000;
  const currencies: Record<string, any> = {};
  for (const cur of ['EGP', 'USD', 'EUR'] as const) currencies[cur] = { ...t.currencies[cur], counted: c[cur], variance: c[cur] - t.currencies[cur].expected };
  const variance = currencies.EGP.variance;
  const z = {
    shift_no: t.shift.shift_no, opened_at: t.shift.opened_at, closed_at: closedAt.toISOString(),
    opening_float: t.opening, cash_sales: t.cashSales, room_cash_payments: t.roomCashPayments, event_cash: t.eventCash, approved_expenses: t.expenses, taken: t.taken,
    expected_cash: t.expectedCash, counted_cash: c.EGP, variance, card_sales: t.cardSales, room_card_payments: t.roomCardPayments,
    room_charges: t.roomCharges, owner_comps: t.comps, tour_profit: t.tourProfit, sales_count: t.salesCount, hours_worked: Math.round(hours * 100) / 100,
    currencies,
  };
  const r = await q<any>(
    `UPDATE cash_shifts SET status='closed', closed_at=$2, counted_cash_cents=$3, expected_cash_cents=$4, variance_cents=$5, z_report=$6, blind_close=true,
       drawer_egp_actual=$3, drawer_usd_actual=$9, drawer_eur_actual=$10, closed_by_staff=$7, notes=COALESCE(notes || E'\\n','') || COALESCE($8,'') WHERE id=$1 AND status='open' RETURNING *`,
    [shiftId, closedAt, c.EGP, t.expectedCash, variance, JSON.stringify(z), staffId, note, c.USD / 100, c.EUR / 100]);
  if (!r.length) throw new BookingError('BAD_STATE');
  await clockOut(staffId, closedAt);
  await q(`UPDATE staff_attendance SET clock_out_at=$2 WHERE cash_shift_id=$1 AND clock_out_at IS NULL`, [shiftId, closedAt]);
  const off = (['EGP', 'USD', 'EUR'] as const).filter((k) => currencies[k].variance !== 0);
  for (const k of off) {
    const v = currencies[k].variance;
    // A shortage is the responsibility of the person handing over: they pay it now or it is deducted from salary.
    if (v < 0) await q(`INSERT INTO cash_shortages(shift_id,staff_id,currency,amount_minor) VALUES($1,$2,$3,$4)`, [shiftId, t.shift.staff_id, k, -v]);
  }
  if (off.length) {
    const txt = off.map((k) => `${k} ${currencies[k].variance > 0 ? 'over' : 'short'} ${Math.abs(currencies[k].variance) / 100}`).join(', ');
    await q(`INSERT INTO tasks(title,detail,kind,dedupe_key) VALUES($1,$2,'payment',$3) ON CONFLICT (dedupe_key) DO NOTHING`,
      [`Shift #${t.shift.shift_no} closed: ${txt}`, `Expected ${(['EGP', 'USD', 'EUR'] as const).map((k) => `${k} ${currencies[k].expected / 100}`).join(' · ')}. Counted ${countsText(c)}. Decide in Shifts & Z-reports: paid in cash or deduct from salary.`, 'zvar:' + shiftId]);
  }
  await audit('pos', 'shift.close_blind', 'cash_shift', shiftId, { counted: c, expected: t.expectedCash, variance });
  return z;
}

/** Cash removed from the drawer by the owner. Only staff allowed to take cash, with their own PIN. */
/**
 * Money exchange at the desk: the guest hands over USD / EUR notes and gets EGP from the drawer at the rate given
 * (today's rate unless the cashier types another). Not revenue: the drawer gains the foreign notes and loses the EGP.
 */
export async function recordExchange(shiftId: string, staffId: string, input: { currency: 'USD' | 'EUR'; foreignMinor: number; rate?: number | null; guest?: string | null; reservationId?: string | null }) {
  if (!['USD', 'EUR'].includes(input.currency)) throw new BookingError('INVALID_INPUT', 'Choose USD or EUR');
  if (!Number.isInteger(input.foreignMinor) || input.foreignMinor <= 0) throw new BookingError('INVALID_INPUT', 'Enter the amount the guest gives');
  const today = await rateFor(input.currency);
  const rate = input.rate && input.rate > 0 ? input.rate : today;
  // A typo in the rate would empty the drawer: stay within 15% of today's rate.
  if (Math.abs(rate - today) / today > 0.15) throw new BookingError('INVALID_INPUT', `That rate is far from today's (${today}). Check it.`);
  const egp = Math.floor((input.foreignMinor * rate) / 100) * 100; // whole pounds handed out
  if (egp <= 0) throw new BookingError('INVALID_INPUT', 'Amount too small');
  const t = await shiftTotals(shiftId);
  if (t.shift.status !== 'open') throw new BookingError('BAD_STATE', 'The shift is closed');
  if (egp > t.currencies.EGP.expected) throw new BookingError('INVALID_INPUT', `Only EGP ${(Math.max(0, t.currencies.EGP.expected) / 100).toLocaleString('en-US')} is in the drawer`);
  const row = (await q<any>(`INSERT INTO cash_exchanges(shift_id,staff_id,currency,foreign_minor,rate,egp_cents,guest,reservation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [shiftId, staffId, input.currency, input.foreignMinor, rate, egp, input.guest?.trim() || null, input.reservationId || null]))[0];
  await audit('pos', 'shift.exchange', 'cash_shift', shiftId, { currency: input.currency, foreign: input.foreignMinor, rate, egp });
  return { id: row.id, currency: input.currency, foreignMinor: input.foreignMinor, rate, egp };
}

/** Event tickets that still have to be paid (pay at the door / not paid yet), for the POS. */
export async function unpaidEventTickets() {
  return q<any>(`SELECT b.id, b.ticket_code, b.full_name, b.phone, b.event_date, b.total_cents, b.status, e.title
                 FROM event_bookings b JOIN events e ON e.id=b.event_id
                 WHERE b.status IN ('pay_on_site','awaiting_payment') AND b.event_date >= (now() AT TIME ZONE 'Africa/Cairo')::date - 1
                 ORDER BY b.event_date, b.full_name LIMIT 100`);
}

/** Event ticket paid on the POS: cash into the drawer or card on the machine (foreign card payers on the daily list). */
export async function payEventTicket(shiftId: string, input: { bookingId: string; method: 'cash' | 'card'; staffName: string; cardPayer?: CardPayer | null }) {
  const payer = input.method === 'card' ? cleanPayer(input.cardPayer) : null;
  const sh = (await q<any>(`SELECT shift_no FROM cash_shifts WHERE id=$1 AND status='open'`, [shiftId]))[0];
  if (!sh) throw new BookingError('BAD_STATE', 'The shift is closed');
  return tx(async (c) => {
    const b = (await c.query(`UPDATE event_bookings SET status='paid', paid_at=now(), hold_expires_at=NULL, shift_id=$2, pay_method=$3,
                                staff_note=COALESCE(staff_note || ' · ', '') || $4, updated_at=now()
                              WHERE id=$1 AND status IN ('pay_on_site','awaiting_payment','expired') RETURNING id, total_cents, ticket_code`,
      [input.bookingId, shiftId, input.method, `Paid ${input.method} on the POS · shift #${sh.shift_no} · ${input.staffName}`])).rows[0];
    if (!b) throw new BookingError('BAD_STATE', 'This ticket is already paid or cancelled');
    if (payer) await recordCardPayer(c as unknown as Q, payer, { amountCents: Number(b.total_cents), source: 'event', shiftId, staffName: input.staffName, paidFor: `Event ticket ${b.ticket_code}` });
    await audit('pos:' + input.staffName, 'event_booking.paid', 'event_booking', b.id, { method: input.method, shift: sh.shift_no }, c as unknown as Q);
    return { ticket: b.ticket_code, cents: Number(b.total_cents), method: input.method };
  });
}

export async function recordTaken(shiftId: string, input: { takerId: string; takerPin: string; amounts: Partial<Counts>; note?: string }) {
  const s = await verifyPin(input.takerId, input.takerPin);
  if (!s) throw new BookingError('FORBIDDEN', 'Wrong PIN');
  const ok = (await q<any>(`SELECT can_take_cash FROM staff WHERE id=$1`, [s.id]))[0]?.can_take_cash;
  if (!ok) throw new BookingError('FORBIDDEN', `${s.full_name} is not allowed to take cash from the drawer`);
  const a = cleanCounts(input.amounts);
  if (!a.EGP && !a.USD && !a.EUR) throw new BookingError('INVALID_INPUT', 'Enter the amount taken');
  const t = await shiftTotals(shiftId);
  if (t.shift.status !== 'open') throw new BookingError('BAD_STATE', 'The shift is closed');
  for (const c of ['EGP', 'USD', 'EUR'] as const) {
    const inDrawer = Number((t.currencies as any)[c]?.expected ?? 0);
    if (a[c] > inDrawer) throw new BookingError('INVALID_INPUT', `Only ${c} ${(Math.max(0, inDrawer) / 100).toLocaleString('en-US')} is in the drawer`);
  }
  await q(`INSERT INTO cash_taken(shift_id,staff_id,egp_cents,usd_cents,eur_cents,note) VALUES($1,$2,$3,$4,$5,$6)`, [shiftId, s.id, a.EGP, a.USD, a.EUR, input.note?.trim() || null]);
  await audit('pos:' + s.full_name, 'shift.taken', 'cash_shift', shiftId, a);
  return { by: s.full_name, ...a };
}

export async function recordExpense(shiftId: string, staffId: string, input: { amountCents: number; category: string; description: string; approverId: string; approverPin: string; currency?: string }) {
  const approver = await verifyPin(input.approverId, input.approverPin);
  if (!approver?.is_manager) throw new BookingError('FORBIDDEN', 'A manager PIN is required to approve an expense');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new BookingError('INVALID_INPUT', 'amount');
  const cats = ['supplies', 'food_kitchen', 'maintenance', 'transport_taxi', 'pet_care', 'tips_wages', 'refund', 'other'];
  const cur = ['EGP', 'USD', 'EUR'].includes(input.currency ?? '') ? input.currency : 'EGP';
  await q(`INSERT INTO cash_expenses(shift_id,date,category,amount_cents,currency,description,staff_id,approved) VALUES($1,current_date,$2,$3,$6,$4,$5,true)`,
    [shiftId, cats.includes(input.category) ? input.category : 'other', input.amountCents, input.description.slice(0, 200) || 'Expense', staffId, cur]);
  await audit('pos', 'shift.expense', 'cash_shift', shiftId, { amount: input.amountCents, approvedBy: approver.full_name });
}

/* ───────── Catalog & guests ───────── */

export async function posCatalog() {
  const products = await q<any>(`SELECT id, name, pos_category, price_cents, cost_cents, stock_quantity, track_stock, low_stock_threshold, barcode, unit_label
                                 FROM products WHERE is_active ORDER BY pos_category, sort_order, name`);
  const tours = await q<any>(`SELECT t.id, t.name, t.organizer, t.cost_cents, t.price_cents, t.duration, t.guest_message,
      COALESCE((SELECT json_agg(json_build_object('id', f.id, 'name', f.name, 'mime', f.mime) ORDER BY f.created_at) FROM tour_files f WHERE f.tour_id=t.id), '[]') files
    FROM tours_catalog t WHERE t.active ORDER BY t.sort_order, t.name`);
  return { products, tours };
}

/** Checked-in guests with their rooms and live balance. */
/**
 * Guests the POS can work with: everyone checked in, plus bookings made on the Dashboard that have not arrived yet
 * (confirmed or pending, arriving within 60 days), so reception can take a deposit or the full price on the POS.
 * The payment lands on the same guest account, so the Dashboard folio shows it straight away.
 */
export async function inHouseGuests() {
  const rows = await q<any>(`
    SELECT r.id, r.reference, r.status, r.check_in, r.check_out, r.currency, g.full_name, g.nationality,
      (SELECT string_agg(DISTINCT rm.name || CASE WHEN t.kind='dorm' THEN ' · ' || u.label ELSE '' END, ', ')
       FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id
       WHERE ru.reservation_id=r.id AND ru.active AND (r.status<>'checked_in' OR ru.during @> current_date)) rooms
    FROM reservations r JOIN guests g ON g.id=r.guest_id
    WHERE r.status='checked_in'
       OR (r.status IN ('confirmed','pending') AND r.check_out > current_date AND r.check_in <= current_date + 60)
    ORDER BY r.status<>'checked_in', CASE WHEN r.status='checked_in' THEN NULL ELSE r.check_in END, g.full_name`);
  const out = [];
  for (const r of rows) {
    const f = await getFolio(r.id);
    out.push({ ...r, inHouse: r.status === 'checked_in', charges: f.charges + f.credits, paid: f.paid, balance: f.balance, state: f.state });
  }
  return out;
}

/* ───────── Sales ───────── */

type Line = { kind: 'product' | 'tour' | 'custom'; productId: string | null; tourId: string | null; name: string; qty: number; unit: number; cost: number; serviceType: string; trackStock: boolean };

async function resolveLines(c: Q, items: PosItemInput[]): Promise<Line[]> {
  if (!items.length) throw new BookingError('INVALID_INPUT', 'The cart is empty');
  const out: Line[] = [];
  for (const it of items) {
    const qty = Math.trunc(it.qty);
    if (!(qty >= 1 && qty <= 999)) throw new BookingError('INVALID_INPUT', 'quantity');
    if (it.type === 'product') {
      const p = (await c.query(`SELECT * FROM products WHERE id=$1 AND is_active FOR UPDATE`, [it.id])).rows[0];
      if (!p) throw new BookingError('NOT_FOUND', 'Item no longer available');
      if (p.track_stock && p.stock_quantity < qty) throw new BookingError('CONFLICT', `Only ${p.stock_quantity} × ${p.name} left in stock`);
      const st = p.pos_category === 'meals' ? (p.name.toLowerCase().includes('breakfast') ? 'breakfast' : 'meal')
        : p.category === 'laundry' ? 'laundry' : p.category === 'linen_towel' ? 'towel' : p.pos_category === 'market' ? 'market' : 'other';
      out.push({ kind: 'product', productId: p.id, tourId: null, name: p.name, qty, unit: Number(p.price_cents), cost: Number(p.cost_cents), serviceType: st, trackStock: p.track_stock });
    } else if (it.type === 'tour') {
      const t = (await c.query(`SELECT * FROM tours_catalog WHERE id=$1 AND active`, [it.id])).rows[0];
      if (!t) throw new BookingError('NOT_FOUND', 'Tour no longer available');
      out.push({ kind: 'tour', productId: null, tourId: t.id, name: `${t.name} (${t.organizer})`, qty, unit: Number(t.price_cents), cost: Number(t.cost_cents), serviceType: 'tour', trackStock: false });
    } else {
      const unit = Math.round(Number(it.unitCents));
      const name = (it.name || '').trim().slice(0, 120);
      if (!name || !Number.isFinite(unit) || unit <= 0) throw new BookingError('INVALID_INPUT', 'Custom charge needs a description and a price');
      out.push({ kind: 'custom', productId: null, tourId: null, name, qty, unit, cost: 0, serviceType: 'custom', trackStock: false });
    }
  }
  return out;
}

export type SaleInput = {
  shiftId: string; staffId: string; staffName: string; deviceUserId: string;
  reservationId?: string | null; items: PosItemInput[]; mode: SettleMode; method?: PayMethod;
  compNote?: string; approverId?: string; approverPin?: string; compBalance?: boolean;
  cashCurrency?: Currency;   // cash only: EGP, USD or EUR physically received
  cardPayer?: CardPayer | null; // card only: foreign guest's passport details (daily Excel)
};

export async function processSale(input: SaleInput) {
  const payer = input.method === 'card' ? cleanPayer(input.cardPayer) : null;
  const shift = (await q<any>(`SELECT * FROM cash_shifts WHERE id=$1 AND status='open'`, [input.shiftId]))[0];
  if (!shift) throw new BookingError('BAD_STATE', 'No open shift. Open a shift first.');
  const guestModes: SettleMode[] = ['charge_room', 'settle_all'];
  if (guestModes.includes(input.mode) && !input.reservationId) throw new BookingError('INVALID_INPUT', 'Select an in-house guest first');
  if (input.mode === 'walk_in' && input.reservationId) input.reservationId = null;
  const method: PayMethod = input.method === 'card' ? 'card' : 'cash';
  let approver: Awaited<ReturnType<typeof verifyPin>> = null;
  if (input.mode === 'comp') {
    if (!input.compNote?.trim()) throw new BookingError('INVALID_INPUT', 'An approval note is required for an owner comp');
    approver = input.approverId && input.approverPin ? await verifyPin(input.approverId, input.approverPin) : null;
    if (!approver?.is_manager) throw new BookingError('FORBIDDEN', 'Owner comp needs a manager / owner PIN');
  }
  const saleId = randomUUID();
  const cashCur: Currency = method === 'cash' && input.cashCurrency && ['USD', 'EUR'].includes(input.cashCurrency) ? input.cashCurrency : 'EGP';
  const rate = cashCur === 'EGP' ? 1 : await rateFor(cashCur);
  const foreign = (egpCents: number) => (cashCur === 'EGP' ? null : Math.round(egpCents / rate));
  const out = await tx(async (c) => {
    const cq = c as unknown as Q;
    let res: any = null;
    if (input.reservationId) {
      res = (await c.query(`SELECT r.*, g.full_name FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.id=$1`, [input.reservationId])).rows[0];
      if (!res) throw new BookingError('NOT_FOUND', 'guest');
      if (!['checked_in', 'confirmed', 'pending'].includes(res.status)) throw new BookingError('BAD_STATE', 'This booking is cancelled or already closed');
    }
    const lines = input.items.length ? await resolveLines(cq, input.items) : [];
    if (!lines.length && input.mode !== 'settle_all' && input.mode !== 'comp') throw new BookingError('INVALID_INPUT', 'The cart is empty');
    const cartTotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    const room = res ? ((await c.query(`SELECT string_agg(DISTINCT rm.name, ', ') n FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=$1 AND ru.active`, [res.id])).rows[0]?.n ?? null) : null;

    // How each line is recorded
    const toRoom = input.mode === 'charge_room' || input.mode === 'settle_all' || (input.mode === 'comp' && !!res);
    const pmethod = input.mode === 'comp' && !res ? 'comp' : toRoom ? 'room_charge' : method === 'card' ? 'card_terminal' : 'cash';
    const pstatus = input.mode === 'comp' && !res ? 'comp' : toRoom ? 'charged_to_room' : 'paid';

    const tourLines: { id: string; name: string; qty: number }[] = [];
    for (const l of lines) {
      const amount = l.unit * l.qty;
      const orderNo = `SO-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
      const so = (await c.query(
        `INSERT INTO service_orders(order_number,order_date,reservation_id,guest_name,room_number,service_type,product_id,quantity,amount_cents,currency,payment_method,payment_status,staff_name,comment,
           sale_id,shift_id,pos_staff_id,unit_cost_cents,unit_price_cents,item_name,tour_id,comp_note,comp_approved_by,paid_currency,paid_amount_minor,fx_rate)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'EGP',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
        [orderNo, todayLocal(), res?.id ?? null, res?.full_name ?? 'Walk-in', room, l.serviceType, l.productId, l.qty, amount, pmethod, pstatus, input.staffName, null,
          saleId, input.shiftId, input.staffId, l.cost, l.unit, l.name, l.tourId, input.mode === 'comp' ? input.compNote : null, approver?.id ?? null,
          pmethod === 'cash' ? cashCur : 'EGP', pmethod === 'cash' ? foreign(amount) : null, pmethod === 'cash' && cashCur !== 'EGP' ? rate : null])).rows[0];
      if (l.kind === 'tour') tourLines.push({ id: so.id, name: l.name, qty: l.qty });
      if (l.trackStock && l.productId) {
        const p = (await c.query(`UPDATE products SET stock_quantity = stock_quantity - $2 WHERE id=$1 RETURNING stock_quantity`, [l.productId, l.qty])).rows[0];
        await c.query(`INSERT INTO inventory_movements(product_id,movement_type,quantity,previous_stock,new_stock,reference,note) VALUES($1,'sale',$2,$3,$4,$5,$6)`,
          [l.productId, -l.qty, p.stock_quantity + l.qty, p.stock_quantity, orderNo, `POS sale · shift #${shift.shift_no}`]);
      }
      if (toRoom && res) {
        await c.query(`INSERT INTO folio_entries(reservation_id,entry_date,kind,description,quantity,unit_cents,amount_cents,currency,ref_type,ref_id,shift_id,staff_id)
                       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'service_order',$9,$10,$11)`,
          [res.id, todayLocal(), l.kind === 'tour' ? 'tour' : l.kind === 'custom' ? 'custom' : 'pos', l.name, l.qty, l.unit, amount, res.currency, so.id, input.shiftId, input.staffId]);
      }
    }

    let paidCents = 0;
    let compCents = 0;
    if (res && (input.mode === 'settle_all' || input.mode === 'comp')) {
      // Balance after the cart was posted to the folio
      const charges = Number((await c.query(`SELECT COALESCE(sum(amount_cents),0)::bigint s FROM folio_entries WHERE reservation_id=$1 AND NOT voided`, [res.id])).rows[0].s);
      const roomPosted = (await c.query(`SELECT 1 FROM folio_entries WHERE reservation_id=$1 AND kind='room' AND NOT voided LIMIT 1`, [res.id])).rows[0];
      const roomPart = roomPosted ? 0 : Number(res.total_cents);
      const paid = Number((await c.query(`SELECT COALESCE(sum(amount_cents),0)::bigint s FROM payments WHERE reservation_id=$1 AND status='verified'`, [res.id])).rows[0].s);
      const balance = charges + roomPart - paid;
      if (input.mode === 'settle_all' && balance > 0) {
        paidCents = balance;
        await c.query(`INSERT INTO payments(reservation_id,amount_cents,method,reference,status,note,recorded_by,verified_by,verified_at,shift_id,staff_id,cash_currency,cash_amount_minor,fx_rate)
                       VALUES($1,$2,$3,$4,'verified',$5,$6,$6,now(),$7,$8,$9,$10,$11)`,
          [res.id, balance, method === 'card' ? 'card_terminal' : 'cash', `POS shift #${shift.shift_no}`, `Settled at POS by ${input.staffName}`, input.deviceUserId, input.shiftId, input.staffId,
            method === 'cash' ? cashCur : 'EGP', method === 'cash' ? foreign(balance) : null, method === 'cash' && cashCur !== 'EGP' ? rate : null]);
      }
      if (input.mode === 'comp') {
        compCents = input.compBalance ? Math.max(0, balance) : Math.min(cartTotal, Math.max(0, balance));
        if (compCents > 0) {
          await c.query(`INSERT INTO folio_entries(reservation_id,entry_date,kind,description,quantity,unit_cents,amount_cents,currency,shift_id,staff_id,note)
                         VALUES($1,$2,'comp',$3,1,$4,$4,$5,$6,$7,$8)`,
            [res.id, todayLocal(), `Owner comp — ${input.compNote}`, -compCents, res.currency, input.shiftId, input.staffId, `Approved by ${approver!.full_name}`]);
        }
      }
    } else if (input.mode === 'comp') {
      compCents = cartTotal;
    } else if (input.mode !== 'charge_room') {
      paidCents = cartTotal;
    }
    if (payer && method === 'card' && paidCents > 0) {
      await recordCardPayer(cq, payer, { amountCents: paidCents, source: 'pos_sale', saleId, reservationId: res?.id ?? null, shiftId: input.shiftId, staffName: input.staffName,
        paidFor: [lines.map((l) => `${l.name} ×${l.qty}`).join(', '), input.mode === 'settle_all' ? `Account balance ${res?.reference ?? ''}`.trim() : ''].filter(Boolean).join(' + ') });
    }
    if (input.mode === 'comp' && compCents > 0) {
      await c.query(`INSERT INTO owner_comps(reservation_id,sale_id,amount_cents,note,approved_by,cashier_id,shift_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [res?.id ?? null, saleId, compCents, input.compNote, approver!.id, input.staffId, input.shiftId]);
    }
    await audit('pos:' + input.staffName, 'pos.sale', 'sale', saleId, { mode: input.mode, method, cartTotal, paidCents, compCents, reservation: res?.reference ?? null }, cq);
    return { saleId, cartTotal, paidCents, compCents, mode: input.mode, method, guest: res?.full_name ?? null, reference: res?.reference ?? null, lines: lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit })),
      cashCurrency: cashCur, cashForeign: cashCur === 'EGP' ? null : foreign(paidCents), rate: cashCur === 'EGP' ? null : rate, tourLines, guestName: res?.full_name ?? 'Walk-in', room };
  });
  // Whoever takes the money for a tour books the car in the same shift.
  for (const t of out.tourLines) await onTourSold({ serviceOrderId: t.id, staffId: input.staffId, tour: t.name, qty: t.qty, guest: out.guestName, room: out.room }).catch((e) => console.error('[tasks] tour', e));
  return out;
}

/** Partial / full payment on a guest account (front desk or POS). Cash may be EGP, USD or EUR; card is always EGP. */
export async function takeFolioPayment(input: { reservationId: string; amountCents: number; method: PayMethod; shiftId: string | null; staffId: string | null; userId: string; note?: string; actor: string; currency?: Currency; cardPayer?: CardPayer | null; staffName?: string | null }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new BookingError('INVALID_INPUT', 'Enter an amount');
  const payer = input.method === 'card' ? cleanPayer(input.cardPayer) : null;
  const st = (await q<any>(`SELECT status FROM reservations WHERE id=$1`, [input.reservationId]))[0]?.status;
  if (!st) throw new BookingError('NOT_FOUND', 'Booking not found');
  if (['cancelled', 'no_show'].includes(st)) throw new BookingError('BAD_STATE', 'This booking is cancelled, no payment can be taken on it');
  if (input.method === 'cash' && !input.shiftId) throw new BookingError('BAD_STATE', 'Open a POS shift to take cash, so it is counted in the drawer');
  const sh = input.shiftId ? (await q<any>(`SELECT shift_no FROM cash_shifts WHERE id=$1 AND status='open'`, [input.shiftId]))[0] : null;
  if (input.shiftId && !sh) throw new BookingError('BAD_STATE', 'The shift is closed');
  const cur: Currency = input.method === 'cash' && input.currency && ['USD', 'EUR'].includes(input.currency) ? input.currency : 'EGP';
  const rate = cur === 'EGP' ? 1 : await rateFor(cur);
  // amountCents is in the currency received; the folio is credited with its EGP value at today's rate.
  const egp = cur === 'EGP' ? input.amountCents : toEgp(input.amountCents, rate);
  // EGP cash and card: never more than is owed, so a typo cannot leave money on the account nobody asked for.
  // (USD / EUR notes may come to a little more than the balance; the extra stays as credit on the guest's account.)
  const owed = (await getFolio(input.reservationId)).balance;
  if (cur === 'EGP' && egp > owed) throw new BookingError('INVALID_INPUT', owed > 0 ? `That is more than the balance due (EGP ${(owed / 100).toLocaleString('en-US')})` : 'Nothing is due on this booking');
  await tx(async (c) => {
  const pay = (await c.query(`INSERT INTO payments(reservation_id,amount_cents,method,reference,status,note,recorded_by,verified_by,verified_at,shift_id,staff_id,cash_currency,cash_amount_minor,fx_rate)
           VALUES($1,$2,$3,$4,'verified',$5,$6,$6,now(),$7,$8,$9,$10,$11) RETURNING id`,
    [input.reservationId, egp, input.method === 'card' ? 'card_terminal' : 'cash', sh ? `Shift #${sh.shift_no}` : 'Front desk',
      cur === 'EGP' ? input.note ?? null : [`${cur} ${input.amountCents / 100} @ ${rate}`, input.note].filter(Boolean).join(' · '),
      input.userId, input.shiftId, input.staffId, cur, cur === 'EGP' ? null : input.amountCents, cur === 'EGP' ? null : rate])).rows[0];
  if (payer) {
    const ref = (await c.query(`SELECT reference FROM reservations WHERE id=$1`, [input.reservationId])).rows[0]?.reference ?? '';
    await recordCardPayer(c as unknown as Q, payer, { amountCents: egp, source: 'folio_payment', paymentId: pay.id, reservationId: input.reservationId, shiftId: input.shiftId, staffName: input.staffName ?? input.actor, paidFor: `Payment on account ${ref}`.trim() });
  }
  });
  await audit(input.actor, 'folio.payment', 'reservation', input.reservationId, { amount: input.amountCents, currency: cur, egp, method: input.method });
  return { egp, currency: cur, rate };
}

export async function recentSales(shiftId: string, limit = 12) {
  return q<any>(`SELECT sale_id, min(created_at) at, string_agg(item_name || ' ×' || quantity, ', ') items, sum(amount_cents)::bigint total,
                   min(payment_method) method, min(guest_name) guest
                 FROM service_orders WHERE shift_id=$1 AND sale_id IS NOT NULL GROUP BY sale_id ORDER BY min(created_at) DESC LIMIT $2`, [shiftId, limit]);
}
