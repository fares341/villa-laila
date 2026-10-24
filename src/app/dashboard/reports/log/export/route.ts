import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { todayLocal } from '@/lib/dates';

/** Sales log as a CSV that opens in Excel (UTF-8 with BOM so Arabic names show correctly). */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!u || !can(u.role, 'reports.view')) return new Response('Forbidden', { status: 403 });
  const p = new URL(req.url).searchParams;
  const ok = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = ok(p.get('from')) ?? todayLocal(), to = ok(p.get('to')) ?? todayLocal();
  const rows = await q<any>(`SELECT to_char(s.created_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH24:MI') at, COALESCE(s.guest_name, g.full_name, 'Walk-in') guest, s.room_number, r.reference,
      s.item_name, s.service_type, s.quantity, s.amount_cents, s.payment_method, s.payment_status, s.paid_currency, s.paid_amount_minor, COALESCE(st.full_name, s.staff_name) cashier, cs.shift_no
    FROM service_orders s LEFT JOIN reservations r ON r.id=s.reservation_id LEFT JOIN guests g ON g.id=r.guest_id LEFT JOIN staff st ON st.id=s.pos_staff_id LEFT JOIN cash_shifts cs ON cs.id=s.shift_id
    WHERE s.order_date BETWEEN $1 AND $2 AND ($3='' OR s.pos_staff_id::text=$3) AND ($4='' OR s.service_type=$4) AND ($5='' OR s.payment_method=$5) ORDER BY s.created_at`,
    [from, to, p.get('staff') ?? '', p.get('kind') ?? '', p.get('method') ?? '']);
  const esc = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['Time', 'Guest', 'Room', 'Booking', 'Item', 'Service', 'Qty', 'Amount EGP', 'Paid by', 'Status', 'Paid currency', 'Paid amount', 'Cashier', 'Shift'];
  const lines = rows.map((r) => [r.at, r.guest, r.room_number, r.reference, r.item_name, r.service_type, r.quantity, (Number(r.amount_cents) / 100).toFixed(2), r.payment_method, r.payment_status, r.paid_currency, r.paid_amount_minor ? (Number(r.paid_amount_minor) / 100).toFixed(2) : '', r.cashier, r.shift_no].map(esc).join(','));
  return new Response('﻿' + [head.join(','), ...lines].join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="sales-log-${from}-to-${to}.csv"` } });
}
