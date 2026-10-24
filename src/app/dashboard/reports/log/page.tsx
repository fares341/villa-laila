import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { todayLocal } from '@/lib/dates';
import { PageHeader, Card, fmt, dt, Input, Lbl, Btn, BtnGhost, SubTabs, REPORT_TABS, Pill } from '@/components/dash';

export const dynamic = 'force-dynamic';
const METHOD: Record<string, string> = { cash: 'Cash', card_terminal: 'Card', room_charge: 'On room bill', comp: 'Free (owner)' };
const STATUS: Record<string, string> = { paid: 'Paid', charged_to_room: 'On room bill', comp: 'Free', void: 'Cancelled' };

/** Every sale on the POS, one line each (the old "Log" sheet): who bought what, how they paid, which cashier. */
export default async function SalesLog({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('reports.view');
  const sp = await searchParams;
  const today = todayLocal();
  const ok = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = ok(sp.from) ?? today, to = ok(sp.to) ?? today;
  const [rows, staff, kinds] = await Promise.all([
    q<any>(`SELECT s.created_at, s.order_date, s.item_name, s.service_type, s.quantity, s.amount_cents, s.payment_method, s.payment_status, s.paid_currency, s.paid_amount_minor,
              COALESCE(s.guest_name, g.full_name, 'Walk-in') guest, COALESCE(s.room_number, '') room, r.reference, COALESCE(st.full_name, s.staff_name) cashier, cs.shift_no
            FROM service_orders s LEFT JOIN reservations r ON r.id=s.reservation_id LEFT JOIN guests g ON g.id=r.guest_id
            LEFT JOIN staff st ON st.id=s.pos_staff_id LEFT JOIN cash_shifts cs ON cs.id=s.shift_id
            WHERE s.order_date BETWEEN $1 AND $2 AND ($3='' OR s.pos_staff_id::text=$3) AND ($4='' OR s.service_type=$4) AND ($5='' OR s.payment_method=$5)
            ORDER BY s.created_at DESC LIMIT 1000`, [from, to, sp.staff ?? '', sp.kind ?? '', sp.method ?? '']),
    q<any>(`SELECT id, full_name FROM staff WHERE can_use_pos ORDER BY active DESC, full_name`).catch(() => q<any>(`SELECT id, full_name FROM staff ORDER BY full_name`)),
    q<any>(`SELECT DISTINCT service_type FROM service_orders WHERE service_type IS NOT NULL ORDER BY 1`),
  ]);
  const live = rows.filter((r) => r.payment_status !== 'void');
  const sum = (f: (r: any) => boolean) => live.filter(f).reduce((a, r) => a + Number(r.amount_cents), 0);
  const qs = new URLSearchParams(Object.entries({ from, to, staff: sp.staff ?? '', kind: sp.kind ?? '', method: sp.method ?? '' }).filter(([, v]) => v)).toString();
  return (
    <>
      <PageHeader title="Sales log" sub="Every sale made on the POS, newest first: what, for whom, how it was paid and who sold it.">
        <a className={BtnGhost} href={`/dashboard/reports/log/export?${qs}`}>Download for Excel</a>
      </PageHeader>
      <SubTabs current="/dashboard/reports/log" tabs={REPORT_TABS} />
      <form className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6" method="get">
        <div><Lbl htmlFor="f">From</Lbl><input id="f" type="date" name="from" defaultValue={from} className={Input} /></div>
        <div><Lbl htmlFor="t">To</Lbl><input id="t" type="date" name="to" defaultValue={to} className={Input} /></div>
        <div><Lbl htmlFor="s">Cashier</Lbl><select id="s" name="staff" defaultValue={sp.staff ?? ''} className={Input}><option value="">Everyone</option>{staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></div>
        <div><Lbl htmlFor="k">Service</Lbl><select id="k" name="kind" defaultValue={sp.kind ?? ''} className={Input}><option value="">All</option>{kinds.map((k: any) => <option key={k.service_type} value={k.service_type}>{k.service_type.replace(/_/g, ' ')}</option>)}</select></div>
        <div><Lbl htmlFor="m">Paid by</Lbl><select id="m" name="method" defaultValue={sp.method ?? ''} className={Input}><option value="">All</option>{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="flex items-end"><button className={Btn}>Show</button></div>
      </form>
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-cocoa-200 bg-white px-4 py-3 text-sm">
        <span>{live.length} lines</span><span>Cash <b className="tabular-nums">{fmt(sum((r) => r.payment_method === 'cash'))}</b></span><span>Card <b className="tabular-nums">{fmt(sum((r) => r.payment_method === 'card_terminal'))}</b></span>
        <span>On room bills <b className="tabular-nums">{fmt(sum((r) => r.payment_status === 'charged_to_room'))}</b></span><span>Free (owner) <b className="tabular-nums">{fmt(sum((r) => r.payment_status === 'comp'))}</b></span>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>Guest</th><th>What</th><th className="text-right">Qty</th><th className="text-right">Amount</th><th>Paid by</th><th>Cashier</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className={`border-t border-slate-100 ${r.payment_status === 'void' ? 'text-slate-400 line-through' : ''}`}>
                <td className="whitespace-nowrap py-2 text-xs">{dt(r.created_at)}</td>
                <td>{r.guest}{(r.room || r.reference) && <div className="text-xs text-slate-500">{[r.room, r.reference].filter(Boolean).join(' · ')}</div>}</td>
                <td>{r.item_name}<div className="text-xs text-slate-500">{(r.service_type ?? '').replace(/_/g, ' ')}</div></td>
                <td className="text-right tabular-nums">{r.quantity}</td>
                <td className="whitespace-nowrap text-right tabular-nums">{fmt(Number(r.amount_cents))}{r.paid_currency && r.paid_currency !== 'EGP' && r.paid_amount_minor && <div className="text-xs text-slate-500">{r.paid_currency} {(Number(r.paid_amount_minor) / 100).toFixed(2)}</div>}</td>
                <td><Pill tone={r.payment_status === 'charged_to_room' ? 'amber' : r.payment_status === 'comp' ? 'blue' : 'slate'}>{r.payment_status === 'paid' ? METHOD[r.payment_method] ?? r.payment_method : STATUS[r.payment_status] ?? r.payment_status}</Pill></td>
                <td className="text-xs">{r.cashier ?? '—'}{r.shift_no && <div className="text-slate-500">shift #{r.shift_no}</div>}</td>
              </tr>))}
              {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">No sales in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
