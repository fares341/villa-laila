import { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { reservationRows } from '@/services/queries';
import { audit } from '@/services/audit';

export const dynamic = 'force-dynamic';
// CSV cells beginning with = + - @ are neutralised so spreadsheets never execute guest-supplied text as formulas.
const cell = (v: unknown) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };

export async function GET(req: NextRequest) {
  const u = await requireUser('reservation.export');
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const rows = await reservationRows({ ...sp, limit: 5000, page: 1 } as any);
  const head = ['Reference', 'Guest', 'Phone', 'Email', 'Check-in', 'Check-out', 'Guests', 'Beds', 'Source', 'Status', 'Total (room + extras)', 'Verified paid', 'Balance', 'Currency', 'Staff notes', 'Created', 'Updated'];
  const lines = [head.map(cell).join(',')].concat(rows.map((r) => [r.reference, r.full_name, r.phone, r.email, r.check_in, r.check_out, r.guests_count, r.beds, r.source, r.status, Number(r.charges_cents) / 100, r.paid / 100, r.balance / 100, r.currency, r.staff_notes, r.created_at?.toISOString?.(), r.updated_at?.toISOString?.()].map(cell).join(',')));
  await audit(u.email, 'reservation.export', 'reservation', null, { rows: rows.length, filters: sp });
  return new Response('﻿' + lines.join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="reservations-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
