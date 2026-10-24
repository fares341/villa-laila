import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { reservationRows } from '@/services/queries';
import { Badge, PayBadge, PageHeader, Empty, Flash, fmt, Input, Btn, BtnGhost, Lbl, SubTabs, STATUS_LABEL, sourceLabel } from '@/components/dash';
import { navCounts } from '@/services/queries';
import { can } from '@/lib/permissions';
import { Icon } from '@/components/icons';

const STATUSES = ['hold', 'pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'rejected', 'expired', 'no_show'];

export default async function Reservations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('reservation.view');
  const sp = await searchParams;
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const rows = await reservationRows({ q: sp.q, status: sp.status, source: sp.source, roomType: sp.roomType, payment: sp.payment, from: sp.from, to: sp.to, sort: sp.sort, page, limit: 50 });
  const types = await q<any>('SELECT id, name FROM room_types ORDER BY sort_order');
  const ext = ((await navCounts().catch(() => ({}) as any)) as any).extensions ?? 0;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !['page', 'ok', 'err'].includes(k)) as [string, string][]);
  return (
    <>
      <PageHeader title="Reservations" sub="Search, filter and open any reservation.">
        {can(u.role, 'reservation.export') && <a className={BtnGhost} href={`/dashboard/reservations/export?${qs}`}>Download CSV</a>}
        <Link className={Btn} href="/dashboard/ota?ch=website#add">+ New booking</Link>
      </PageHeader>
      {can(u.role, 'extension.decide') && <SubTabs current="/dashboard/reservations" tabs={[{ href: '/dashboard/reservations', label: 'All reservations', icon: 'bed' }, { href: '/dashboard/extensions', label: 'Stay extensions', icon: 'arrow-left-right', count: ext }]} />}
      <Flash sp={sp} />
      <form className="mb-5 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4" method="get">
        <div className="sm:col-span-2"><Lbl htmlFor="q">Search (reference, name, email, phone)</Lbl><input id="q" name="q" defaultValue={sp.q} className={Input} /></div>
        <div><Lbl htmlFor="st">Status</Lbl><select id="st" name="status" defaultValue={sp.status ?? ''} className={Input}><option value="">All</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}</select></div>
        <div><Lbl htmlFor="so">Source</Lbl><select id="so" name="source" defaultValue={sp.source ?? ''} className={Input}><option value="">All</option>{['booking_com', 'airbnb', 'hostelworld', 'expedia', 'agoda', 'website', 'walk_in', 'staff', 'telegram', 'import'].map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}</select></div>
        <div><Lbl htmlFor="rt">Room type</Lbl><select id="rt" name="roomType" defaultValue={sp.roomType ?? ''} className={Input}><option value="">All</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name.en}</option>)}</select></div>
        <div><Lbl htmlFor="py">Payment</Lbl><select id="py" name="payment" defaultValue={sp.payment ?? ''} className={Input}><option value="">All</option><option value="unpaid">Unpaid</option><option value="partial">Part paid</option><option value="paid">Paid</option></select></div>
        <div><Lbl htmlFor="f">Staying between</Lbl><input id="f" type="date" name="from" defaultValue={sp.from} className={Input} /></div>
        <div><Lbl htmlFor="t">and</Lbl><input id="t" type="date" name="to" defaultValue={sp.to} className={Input} /></div>
        <div><Lbl htmlFor="sr">Sort by</Lbl><select id="sr" name="sort" defaultValue={sp.sort ?? 'created'} className={Input}><option value="created">Newest first</option><option value="checkin">Check-in (soonest)</option><option value="checkin_desc">Check-in (latest)</option><option value="updated">Recently updated</option><option value="balance">Highest balance</option></select></div>
        <div className="flex items-end gap-2"><button className={Btn}>Apply</button><Link href="/dashboard/reservations" className={BtnGhost}>Clear</Link></div>
      </form>
      {rows.length === 0 ? <Empty>No reservations match. Try clearing the filters, or <Link className="underline" href="/dashboard/ota?ch=website#add">add a booking</Link>.</Empty> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600"><tr>{['Booking', 'Guest', 'Dates', 'Bed / room', 'Guests', 'From', 'Status', 'Payment', 'Bill', 'Still to pay'].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono"><Link className="text-cocoa-600 underline" href={`/dashboard/reservations/${r.id}`}>{r.reference}</Link>{r.needs_review && ['hold', 'pending'].includes(r.status) && <span title={r.review_reason} className="ms-1 inline-flex items-center gap-1 text-xs font-sans text-amber-700"><Icon name="alert-triangle" size={14} />Check first</span>}</td>
                  <td className="px-3 py-2"><p className="font-medium">{r.full_name}</p><p className="text-xs text-slate-500">{r.phone ?? r.email ?? ''}</p></td>
                  <td className="whitespace-nowrap px-3 py-2">{r.check_in} → {r.check_out}</td>
                  <td className="px-3 py-2 text-xs">{r.beds ?? '—'}</td>
                  <td className="px-3 py-2">{r.guests_count}</td>
                  <td className="px-3 py-2">{sourceLabel(r.source)}</td>
                  <td className="px-3 py-2"><Badge status={r.status} /></td>
                  <td className="px-3 py-2"><PayBadge state={r.payState} awaiting={r.unverified > 0} /></td>
                  <td className="whitespace-nowrap px-3 py-2">{fmt(r.charges_cents, r.currency)}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${r.balance > 0 ? 'font-semibold text-red-800' : ''}`}>{fmt(r.balance, r.currency)}</td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? <Link className="underline" href={`?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page - 1) })}`}>← Previous</Link> : <span />}
        {rows.length === 50 && <Link className="underline" href={`?${new URLSearchParams({ ...Object.fromEntries(qs), page: String(page + 1) })}`}>Next →</Link>}
      </div>
    </>
  );
}
