import { randomUUID } from 'node:crypto';
import { q, tx } from '@/lib/db';
import type { Q } from '@/lib/db';
import { todayLocal } from '@/lib/dates';
import { BookingError } from '../errors';
import { audit } from '../audit';
import { verifyPin, clockIn, clockOut } from './staff';
import { getFolio } from './folio';

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

export async function openPosShift(staffId: string, floatCents: number, deviceUserId: string) {
  if (!Number.isInteger(floatCents) || floatCents < 0) throw new BookingError('INVALID_INPUT', 'Opening float must be zero or more');
  const shift = await tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('pos-shift'))`);
    const open = (await c.query(`SELECT id FROM cash_shifts WHERE status='open' LIMIT 1`)).rows[0];
    if (open) throw new BookingError('BAD_STATE', 'A shift is already open. Close it before opening a new one.');
    return (await c.query(
      `INSERT INTO cash_shifts(shift_date, shift_name, opened_by, staff_id, drawer_egp_start, opened_at, status) VALUES($1,$2,$3,$4,$5,now(),'open') RETURNING *`,
      [todayLocal(), shiftLabel(), deviceUserId, staffId, floatCents])).rows[0];
  });
  const att = await clockIn(staffId, { cashShiftId: shift.id, source: 'pos' });
  await audit('pos', 'shift.open', 'cash_shift', shift.id, { staffId, floatCents });
  return { shift, attendance: att.attendance, alreadyClockedIn: att.alreadyIn };
}

/** Cash the drawer should hold right now (never shown to the cashier before the blind count). */
export async function shiftTotals(shiftId: string) {
  const s = (await q<any>(`SELECT * FROM cash_shifts WHERE id=$1`, [shiftId]))[0];
  if (!s) throw new BookingError('NOT_FOUND');
  const sales = (await q<any>(`
    SELECT
      COALESCE(sum(amount_cents) FILTER (WHERE payment_method='cash' AND payment_status='paid'),0)::bigint cash_sales,
      COALESCE(sum(amount_cents) FILTER (WHERE payment_method='card_terminal' AND payment_status='paid'),0)::bigint card_sales,
      COALESCE(sum(amount_cents) FILTER (WHERE payment_status='charged_to_room'),0)::bigint room_charges,
      COALESCE(sum(amount_cents) FILTER (WHERE payment_status='comp'),0)::bigint comp_sales,
      COALESCE(sum(amount_cents) FILTER (WHERE payment_method='cash' AND payment_status='paid' AND service_type IN ('market','drinks','water')),0)::bigint market_cash,
      COALESCE(sum((COALESCE(unit_price_cents, 0) - unit_cost_cents) * quantity) FILTER (WHERE tour_id IS NOT NULL AND payment_status <> 'void'),0)::bigint tour_profit,
      count(DISTINCT sale_id)::int sales_count
    FROM service_orders WHERE shift_id=$1 AND payment_status <> 'void'`, [shiftId]))[0];
  const pays = (await q<any>(`
    SELECT COALESCE(sum(amount_cents) FILTER (WHERE method='cash'),0)::bigint cash, COALESCE(sum(amount_cents) FILTER (WHERE method='card_terminal'),0)::bigint card
    FROM payments WHERE shift_id=$1 AND status='verified'`, [shiftId]))[0];
  const exp = (await q<any>(`SELECT COALESCE(sum(amount_cents),0)::bigint e FROM cash_expenses WHERE shift_id=$1 AND approved AND currency='EGP'`, [shiftId]))[0];
  const comps = (await q<any>(`SELECT COALESCE(sum(amount_cents),0)::bigint c FROM owner_comps WHERE shift_id=$1`, [shiftId]))[0];
  const ev = (await q<any>(`SELECT COALESCE(sum(total_cents),0)::bigint c FROM event_bookings WHERE shift_id=$1 AND status='paid' AND pay_method='cash'`, [shiftId]))[0];
  const opening = Number(s.drawer_egp_start);
  const expected = opening + Number(sales.cash_sales) + Number(pays.cash) + Number(ev.c) - Number(exp.e);
  return {
    shift: s, opening, cashSales: Number(sales.cash_sales), cardSales: Number(sales.card_sales), roomCharges: Number(sales.room_charges),
    roomCashPayments: Number(pays.cash), eventCash: Number(ev.c), roomCardPayments: Number(pays.card), expenses: Number(exp.e), comps: Number(comps.c),
    tourProfit: Number(sales.tour_profit), salesCount: sales.sales_count, expectedCash: expected,
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

export async function closePosShiftBlind(shiftId: string, countedCents: number, staffId: string, note: string | null) {
  if (!Number.isInteger(countedCents) || countedCents < 0) throw new BookingError('INVALID_INPUT', 'Enter the cash you counted');
  const t = await shiftTotals(shiftId);
  if (t.shift.status !== 'open') throw new BookingError('BAD_STATE', 'This shift is already closed');
  const closedAt = new Date();
  const hours = (closedAt.getTime() - new Date(t.shift.opened_at ?? t.shift.created_at).getTime()) / 3600000;
  const variance = countedCents - t.expectedCash;
  const z = {
    shift_no: t.shift.shift_no, opened_at: t.shift.opened_at, closed_at: closedAt.toISOString(),
    opening_float: t.opening, cash_sales: t.cashSales, room_cash_payments: t.roomCashPayments, event_cash: t.eventCash, approved_expenses: t.expenses,
    expected_cash: t.expectedCash, counted_cash: countedCents, variance, card_sales: t.cardSales, room_card_payments: t.roomCardPayments,
    room_charges: t.roomCharges, owner_comps: t.comps, tour_profit: t.tourProfit, sales_count: t.salesCount, hours_worked: Math.round(hours * 100) / 100,
  };
  const r = await q<any>(
    `UPDATE cash_shifts SET status='closed', closed_at=$2, counted_cash_cents=$3, expected_cash_cents=$4, variance_cents=$5, z_report=$6, blind_close=true,
       drawer_egp_actual=$3, closed_by_staff=$7, notes=COALESCE(notes || E'\\n','') || COALESCE($8,'') WHERE id=$1 AND status='open' RETURNING *`,
    [shiftId, closedAt, countedCents, t.expectedCash, variance, JSON.stringify(z), staffId, note]);
  if (!r.length) throw new BookingError('BAD_STATE');
  await clockOut(staffId, closedAt);
  await q(`UPDATE staff_attendance SET clock_out_at=$2 WHERE cash_shift_id=$1 AND clock_out_at IS NULL`, [shiftId, closedAt]);
  if (variance !== 0) {
    await q(`INSERT INTO tasks(title,detail,kind,dedupe_key) VALUES($1,$2,'payment',$3) ON CONFLICT (dedupe_key) DO NOTHING`,
      [`Shift #${t.shift.shift_no} closed ${variance > 0 ? 'over' : 'short'} by ${Math.abs(variance) / 100} EGP`, `Expected ${t.expectedCash / 100} EGP, counted ${countedCents / 100} EGP.`, 'zvar:' + shiftId]);
  }
  await audit('pos', 'shift.close_blind', 'cash_shift', shiftId, { counted: countedCents, expected: t.expectedCash, variance });
  return z;
}

export async function recordExpense(shiftId: string, staffId: string, input: { amountCents: number; category: string; description: string; approverId: string; approverPin: string }) {
  const approver = await verifyPin(input.approverId, input.approverPin);
  if (!approver?.is_manager) throw new BookingError('FORBIDDEN', 'A manager PIN is required to approve an expense');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new BookingError('INVALID_INPUT', 'amount');
  const cats = ['supplies', 'food_kitchen', 'maintenance', 'transport_taxi', 'pet_care', 'tips_wages', 'refund', 'other'];
  await q(`INSERT INTO cash_expenses(shift_id,date,category,amount_cents,currency,description,staff_id,approved) VALUES($1,current_date,$2,$3,'EGP',$4,$5,true)`,
    [shiftId, cats.includes(input.category) ? input.category : 'other', input.amountCents, input.description.slice(0, 200) || 'Expense', staffId]);
  await audit('pos', 'shift.expense', 'cash_shift', shiftId, { amount: input.amountCents, approvedBy: approver.full_name });
}

/* ───────── Catalog & guests ───────── */

export async function posCatalog() {
  const products = await q<any>(`SELECT id, name, pos_category, price_cents, cost_cents, stock_quantity, track_stock, low_stock_threshold, barcode, unit_label
                                 FROM products WHERE is_active ORDER BY pos_category, sort_order, name`);
  const tours = await q<any>(`SELECT id, name, organizer, cost_cents, price_cents, duration FROM tours_catalog WHERE active ORDER BY sort_order, name`);
  return { products, tours };
}

/** Checked-in guests with their rooms and live balance. */
export async function inHouseGuests() {
  const rows = await q<any>(`
    SELECT r.id, r.reference, r.check_in, r.check_out, r.currency, g.full_name,
      (SELECT string_agg(DISTINCT rm.name || CASE WHEN t.kind='dorm' THEN ' · ' || u.label ELSE '' END, ', ')
       FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id
       WHERE ru.reservation_id=r.id AND ru.active AND ru.during @> current_date) rooms
    FROM reservations r JOIN guests g ON g.id=r.guest_id
    WHERE r.status='checked_in' ORDER BY rooms NULLS LAST, g.full_name`);
  const out = [];
  for (const r of rows) {
    const f = await getFolio(r.id);
    out.push({ ...r, charges: f.charges + f.credits, paid: f.paid, balance: f.balance, state: f.state });
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
};

export async function processSale(input: SaleInput) {
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
  const out = await tx(async (c) => {
    const cq = c as unknown as Q;
    let res: any = null;
    if (input.reservationId) {
      res = (await c.query(`SELECT r.*, g.full_name FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.id=$1`, [input.reservationId])).rows[0];
      if (!res) throw new BookingError('NOT_FOUND', 'guest');
      if (!['checked_in', 'confirmed'].includes(res.status)) throw new BookingError('BAD_STATE', 'Guest is not in house');
    }
    const lines = input.items.length ? await resolveLines(cq, input.items) : [];
    if (!lines.length && input.mode !== 'settle_all' && input.mode !== 'comp') throw new BookingError('INVALID_INPUT', 'The cart is empty');
    const cartTotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    const room = res ? ((await c.query(`SELECT string_agg(DISTINCT rm.name, ', ') n FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=$1 AND ru.active`, [res.id])).rows[0]?.n ?? null) : null;

    // How each line is recorded
    const toRoom = input.mode === 'charge_room' || input.mode === 'settle_all' || (input.mode === 'comp' && !!res);
    const pmethod = input.mode === 'comp' && !res ? 'comp' : toRoom ? 'room_charge' : method === 'card' ? 'card_terminal' : 'cash';
    const pstatus = input.mode === 'comp' && !res ? 'comp' : toRoom ? 'charged_to_room' : 'paid';

    for (const l of lines) {
      const amount = l.unit * l.qty;
      const orderNo = `SO-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)}`;
      const so = (await c.query(
        `INSERT INTO service_orders(order_number,order_date,reservation_id,guest_name,room_number,service_type,product_id,quantity,amount_cents,currency,payment_method,payment_status,staff_name,comment,
           sale_id,shift_id,pos_staff_id,unit_cost_cents,unit_price_cents,item_name,tour_id,comp_note,comp_approved_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'EGP',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,
        [orderNo, todayLocal(), res?.id ?? null, res?.full_name ?? 'Walk-in', room, l.serviceType, l.productId, l.qty, amount, pmethod, pstatus, input.staffName, null,
          saleId, input.shiftId, input.staffId, l.cost, l.unit, l.name, l.tourId, input.mode === 'comp' ? input.compNote : null, approver?.id ?? null])).rows[0];
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
        await c.query(`INSERT INTO payments(reservation_id,amount_cents,method,reference,status,note,recorded_by,verified_by,verified_at,shift_id,staff_id)
                       VALUES($1,$2,$3,$4,'verified',$5,$6,$6,now(),$7,$8)`,
          [res.id, balance, method === 'card' ? 'card_terminal' : 'cash', `POS shift #${shift.shift_no}`, `Settled at POS by ${input.staffName}`, input.deviceUserId, input.shiftId, input.staffId]);
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
    if (input.mode === 'comp' && compCents > 0) {
      await c.query(`INSERT INTO owner_comps(reservation_id,sale_id,amount_cents,note,approved_by,cashier_id,shift_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [res?.id ?? null, saleId, compCents, input.compNote, approver!.id, input.staffId, input.shiftId]);
    }
    await audit('pos:' + input.staffName, 'pos.sale', 'sale', saleId, { mode: input.mode, method, cartTotal, paidCents, compCents, reservation: res?.reference ?? null }, cq);
    return { saleId, cartTotal, paidCents, compCents, mode: input.mode, method, guest: res?.full_name ?? null, reference: res?.reference ?? null, lines: lines.map((l) => ({ name: l.name, qty: l.qty, unit: l.unit })) };
  });
  return out;
}

/** Partial / full payment on a guest account (front desk or POS). */
export async function takeFolioPayment(input: { reservationId: string; amountCents: number; method: PayMethod; shiftId: string | null; staffId: string | null; userId: string; note?: string; actor: string }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new BookingError('INVALID_INPUT', 'Enter an amount');
  if (input.method === 'cash' && !input.shiftId) throw new BookingError('BAD_STATE', 'Open a POS shift to take cash, so it is counted in the drawer');
  const sh = input.shiftId ? (await q<any>(`SELECT shift_no FROM cash_shifts WHERE id=$1 AND status='open'`, [input.shiftId]))[0] : null;
  if (input.shiftId && !sh) throw new BookingError('BAD_STATE', 'The shift is closed');
  await q(`INSERT INTO payments(reservation_id,amount_cents,method,reference,status,note,recorded_by,verified_by,verified_at,shift_id,staff_id)
           VALUES($1,$2,$3,$4,'verified',$5,$6,$6,now(),$7,$8)`,
    [input.reservationId, input.amountCents, input.method === 'card' ? 'card_terminal' : 'cash', sh ? `Shift #${sh.shift_no}` : 'Front desk', input.note ?? null, input.userId, input.shiftId, input.staffId]);
  await audit(input.actor, 'folio.payment', 'reservation', input.reservationId, { amount: input.amountCents, method: input.method });
}

export async function recentSales(shiftId: string, limit = 12) {
  return q<any>(`SELECT sale_id, min(created_at) at, string_agg(item_name || ' ×' || quantity, ', ') items, sum(amount_cents)::bigint total,
                   min(payment_method) method, min(guest_name) guest
                 FROM service_orders WHERE shift_id=$1 AND sale_id IS NOT NULL GROUP BY sale_id ORDER BY min(created_at) DESC LIMIT $2`, [shiftId, limit]);
}
