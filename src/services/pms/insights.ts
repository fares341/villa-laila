import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { todaysRevenueBreakdown } from './pos';
import { getFolio } from './folio';
import { eventProfit } from '../events';
import { monthlyTimesheet } from './staff';

/**
 * Read-only KPIs for the executive assistant and the dashboard. Nothing in here writes.
 * Amounts are returned in EGP (not cents) so they can be quoted directly.
 */
const egp = (c: number | string | null | undefined) => Math.round(Number(c ?? 0)) / 100;
const range = (from?: string, to?: string) => {
  const t = todayLocal();
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  return { from: ok(from) ? from! : t, to: ok(to) ? to! : (ok(from) ? from! : t) };
};

export async function revenueSummary(from?: string, to?: string) {
  const r = range(from, to);
  const days: any[] = [];
  for (let d = r.from; d <= r.to && days.length < 62; d = addDays(d, 1)) {
    const b = await todaysRevenueBreakdown(d);
    days.push({ date: d, pos: egp(b.pos), folioPayments: egp(b.folio), eventTickets: egp(b.events), total: egp(b.total) });
  }
  const sum = (k: string) => Math.round(days.reduce((s, x) => s + x[k], 0) * 100) / 100;
  const posted = (await q<any>(`SELECT COALESCE(sum(amount_cents),0)::bigint s FROM folio_entries WHERE kind='room' AND NOT voided AND entry_date BETWEEN $1 AND $2`, [r.from, r.to]))[0].s;
  return {
    ...r, definition: 'Money collected: POS paid on the spot + payments received on guest folios + event tickets paid. Room charges count when paid.',
    collected: { pos: sum('pos'), folioPayments: sum('folioPayments'), eventTickets: sum('eventTickets'), total: sum('total') },
    roomNightsPostedEgp: egp(posted), byDay: days,
  };
}

export async function marketSales(from?: string, to?: string) {
  const r = range(from, to);
  const rows = await q<any>(`
    SELECT COALESCE(s.item_name, p.name, s.service_type) item, COALESCE(p.pos_category, CASE WHEN s.tour_id IS NOT NULL THEN 'tours' ELSE 'other' END) section,
           sum(s.quantity)::int qty, sum(s.amount_cents)::bigint revenue, sum(s.unit_cost_cents * s.quantity)::bigint cost
    FROM service_orders s LEFT JOIN products p ON p.id=s.product_id
    WHERE s.order_date BETWEEN $1 AND $2 AND s.payment_status NOT IN ('void','comp')
    GROUP BY 1,2 ORDER BY revenue DESC`, [r.from, r.to]);
  const sections: Record<string, { revenue: number; profit: number; qty: number }> = {};
  for (const x of rows) {
    const s = (sections[x.section] ||= { revenue: 0, profit: 0, qty: 0 });
    s.revenue += egp(x.revenue); s.profit += egp(Number(x.revenue) - Number(x.cost)); s.qty += x.qty;
  }
  return { ...r, sections, items: rows.map((x) => ({ item: x.item, section: x.section, qty: x.qty, revenue: egp(x.revenue), grossProfit: egp(Number(x.revenue) - Number(x.cost)) })) };
}

export async function eventProfits(from?: string, to?: string) {
  const r = range(from, to ?? addDays(from ?? todayLocal(), 30));
  const rows = await eventProfit(r.from, r.to);
  const out = rows.filter((e: any) => e.tickets > 0 || e.pending > 0).map((e: any) => ({
    event: e.title?.en ?? e.slug, kind: e.kind, tickets: e.tickets, pendingInstapay: e.pending, revenue: egp(e.revenue),
    costPerAttendee: egp(e.cost_per_attendee_cents), netProfit: egp(Number(e.revenue) - Number(e.cost_per_attendee_cents) * e.tickets),
  }));
  return { ...r, totalNetProfit: Math.round(out.reduce((s, e) => s + e.netProfit, 0) * 100) / 100, events: out };
}

export async function lowStock() {
  const rows = await q<any>(`SELECT name, pos_category, stock_quantity, low_stock_threshold, cost_cents, price_cents FROM products
                             WHERE is_active AND track_stock AND stock_quantity <= low_stock_threshold ORDER BY stock_quantity - low_stock_threshold, name`);
  return { count: rows.length, items: rows.map((p) => ({ item: p.name, section: p.pos_category, inStock: p.stock_quantity, alertAt: p.low_stock_threshold, sellPrice: egp(p.price_cents) })) };
}

/** In-house guests with an open balance, oldest debt first. minDays = nights since check-in. */
export async function unpaidInHouse(minDays = 1) {
  const rows = await q<any>(`SELECT r.id, r.reference, r.check_in, r.check_out, g.full_name, g.phone FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.status='checked_in' ORDER BY r.check_in`);
  const today = todayLocal();
  const out = [];
  for (const r of rows) {
    const f = await getFolio(r.id);
    const days = Math.round((Date.parse(today) - Date.parse(r.check_in)) / 864e5);
    if (f.balance > 0 && days >= minDays) out.push({ guest: r.full_name, reference: r.reference, phone: r.phone, checkIn: r.check_in, checkOut: r.check_out, daysInHouse: days, balanceDue: egp(f.balance), link: `/dashboard/reservations/${r.id}` });
  }
  return { minDays, count: out.length, totalDue: Math.round(out.reduce((s, x) => s + x.balanceDue, 0) * 100) / 100, guests: out };
}

export async function shiftSummaries(from?: string, to?: string) {
  const r = range(from ?? addDays(todayLocal(), -6), to ?? todayLocal());
  const rows = await q<any>(`SELECT cs.shift_no, cs.status, cs.opened_at, cs.closed_at, cs.variance_cents, cs.expected_cash_cents, cs.counted_cash_cents, cs.z_report, s.full_name cashier
                             FROM cash_shifts cs LEFT JOIN staff s ON s.id=cs.staff_id
                             WHERE cs.shift_no IS NOT NULL AND (COALESCE(cs.opened_at, cs.created_at) AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2 ORDER BY cs.opened_at DESC`, [r.from, r.to]);
  const comps = await q<any>(`SELECT COALESCE(sum(amount_cents),0)::bigint s, count(*)::int n FROM owner_comps WHERE (created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2`, [r.from, r.to]);
  return {
    ...r, ownerAllowances: { count: comps[0].n, total: egp(comps[0].s) },
    shifts: rows.map((s) => ({
      shift: `#${s.shift_no}`, cashier: s.cashier, status: s.status, openedAt: s.opened_at, closedAt: s.closed_at,
      expectedCash: s.status === 'closed' ? egp(s.expected_cash_cents) : null, countedCash: s.status === 'closed' ? egp(s.counted_cash_cents) : null,
      variance: s.status === 'closed' ? egp(s.variance_cents) : null,
      cashSales: s.z_report ? egp(s.z_report.cash_sales) : null, cardSales: s.z_report ? egp(s.z_report.card_sales) : null, roomCharges: s.z_report ? egp(s.z_report.room_charges) : null,
    })),
  };
}

export async function attendanceSummary(month?: string) {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : todayLocal().slice(0, 7);
  const rows = await monthlyTimesheet(m);
  const today = todayLocal();
  const lateToday = await q<any>(`SELECT s.full_name, a.delay_minutes, a.tier, a.deduction_cents, a.waived FROM staff_attendance a JOIN staff s ON s.id=a.staff_id WHERE a.work_date=$1 AND a.tier > 0 ORDER BY a.delay_minutes DESC`, [today]);
  return {
    month: m,
    lateToday: lateToday.map((x) => ({ staff: x.full_name, minutesLate: x.delay_minutes, tier: x.tier, deduction: egp(x.deduction_cents), waived: x.waived })),
    staff: rows.map((x) => ({ staff: x.full_name, role: x.role, targetHours: x.target_hours, scheduledHours: Math.round(x.scheduled_hours * 10) / 10, workedHours: Math.round(x.worked_hours * 10) / 10,
      varianceHours: Math.round((x.worked_hours - x.target_hours) * 10) / 10, lateCount: x.late_count, lateMinutes: x.late_minutes, deductions: egp(x.deductions_cents), waived: egp(x.waived_cents), onShiftNow: !!x.open_now })),
  };
}

/** Compact briefing used in the assistant's context. */
export async function executiveBriefing() {
  const [rev, low, unpaid, shifts, att] = await Promise.all([revenueSummary(), lowStock(), unpaidInHouse(1), shiftSummaries(addDays(todayLocal(), -1)), attendanceSummary()]);
  return {
    revenueToday: rev.collected, lowStock: low.items.slice(0, 15), unpaidInHouseOver1Day: unpaid.guests.slice(0, 20),
    recentShifts: shifts.shifts.slice(0, 6), lateToday: att.lateToday,
  };
}
