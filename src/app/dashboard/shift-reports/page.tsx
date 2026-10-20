import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, fmt, dt, BtnGhost, Input, Stat, Pill } from '@/components/dash';
import { Icon } from '@/components/icons';
import { shiftTotals } from '@/services/pms/pos';

export const dynamic = 'force-dynamic';

const Z_ROWS: [string, string, string?][] = [
  ['opening_float', 'Opening float'], ['cash_sales', '+ Cash sales'], ['room_cash_payments', '+ Room cash payments'], ['event_cash', '+ Event tickets (cash)'],
  ['approved_expenses', '− Approved expenses'], ['expected_cash', 'Expected cash', 'b'], ['counted_cash', 'Counted cash', 'b'],
];

export default async function ShiftReports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('reports.view');
  const sp = await searchParams;
  const today = todayLocal();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(today, -13);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const tab = sp.tab === 'comps' ? 'comps' : sp.tab === 'expenses' ? 'expenses' : 'shifts';
  const [shifts, comps, expenses] = await Promise.all([
    q<any>(`SELECT cs.*, s1.full_name cashier, s2.full_name closer FROM cash_shifts cs LEFT JOIN staff s1 ON s1.id=cs.staff_id LEFT JOIN staff s2 ON s2.id=cs.closed_by_staff
            WHERE cs.shift_no IS NOT NULL AND (COALESCE(cs.opened_at, cs.created_at) AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2
            ORDER BY COALESCE(cs.opened_at, cs.created_at) DESC`, [from, to]),
    q<any>(`SELECT oc.*, r.reference, g.full_name guest, a.full_name approver, c.full_name cashier, cs.shift_no,
              (SELECT string_agg(item_name || ' ×' || quantity, ', ') FROM service_orders so WHERE so.sale_id=oc.sale_id) items
            FROM owner_comps oc LEFT JOIN reservations r ON r.id=oc.reservation_id LEFT JOIN guests g ON g.id=r.guest_id
            LEFT JOIN staff a ON a.id=oc.approved_by LEFT JOIN staff c ON c.id=oc.cashier_id LEFT JOIN cash_shifts cs ON cs.id=oc.shift_id
            WHERE (oc.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2 ORDER BY oc.created_at DESC`, [from, to]),
    q<any>(`SELECT e.*, s.full_name staff, cs.shift_no FROM cash_expenses e LEFT JOIN staff s ON s.id=e.staff_id LEFT JOIN cash_shifts cs ON cs.id=e.shift_id
            WHERE e.date BETWEEN $1 AND $2 ORDER BY e.created_at DESC`, [from, to]),
  ]);
  const open = shifts.find((s) => s.status === 'open');
  const live = open ? await shiftTotals(open.id) : null;
  const closed = shifts.filter((s) => s.z_report);
  const net = closed.reduce((a, s) => a + Number(s.variance_cents ?? 0), 0);
  const compTotal = comps.reduce((a, c) => a + Number(c.amount_cents), 0);
  const range = `from=${from}&to=${to}`;

  return (
    <>
      <PageHeader title="Shifts & Z-reports" sub="Every POS shift closes blind: the cashier counts the drawer, then the system shows the variance.">
        <form className="flex items-center gap-2">
          <input type="hidden" name="tab" value={tab} />
          <input type="date" name="from" defaultValue={from} className={Input + ' w-40'} aria-label="From" />
          <input type="date" name="to" defaultValue={to} className={Input + ' w-40'} aria-label="To" />
          <button className={BtnGhost}>Show</button>
        </form>
        <a href="/pos" target="_blank" rel="noopener" className={BtnGhost}><Icon name="shopping-cart" size={16} /> POS</a>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Drawer open" value={open ? `#${open.shift_no}` : 'None'} hint={open ? `${open.cashier ?? ''} · expected ${fmt(live!.expectedCash)}` : 'Open from the POS'} />
        <Stat label="Shifts closed" value={closed.length} />
        <Stat label="Net variance" value={net === 0 ? fmt(0) : `${net > 0 ? 'Over' : 'Short'} ${fmt(Math.abs(net))}`} tone={net === 0 ? 'ok' : 'due'} />
        <Stat label="Owner allowances" value={fmt(compTotal)} hint={`${comps.length} approvals`} />
      </div>

      <nav className="mb-4 flex flex-wrap gap-2">
        {[['shifts', 'Z-reports', 'receipt'], ['comps', 'Owner allowances', 'gift'], ['expenses', 'Drawer expenses', 'banknote']].map(([k, l, i]) => (
          <Link key={k} href={`?tab=${k}&${range}`} aria-current={tab === k ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${tab === k ? 'border-cocoa-800 bg-cocoa-800 text-white' : 'border-cocoa-200 bg-white text-cocoa-800 hover:border-cocoa-600'}`}><Icon name={i} size={15} /> {l}</Link>
        ))}
      </nav>

      {tab === 'shifts' && (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {shifts.map((s) => {
            const z = s.z_report ?? (live && s.id === open?.id ? { opening_float: live.opening, cash_sales: live.cashSales, room_cash_payments: live.roomCashPayments, event_cash: live.eventCash, approved_expenses: live.expenses, expected_cash: live.expectedCash, card_sales: live.cardSales, room_card_payments: live.roomCardPayments, room_charges: live.roomCharges, owner_comps: live.comps, tour_profit: live.tourProfit, sales_count: live.salesCount } : null);
            const v = Number(s.variance_cents ?? 0);
            return (
              <Card key={s.id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div><h3 className="text-lg font-bold text-cocoa-800">Shift #{s.shift_no}</h3>
                    <p className="text-xs text-slate-500">{s.cashier ?? '—'} · {dt(s.opened_at ?? s.created_at)}{s.closed_at && ` → ${dt(s.closed_at)}`}</p></div>
                  {s.status === 'open' ? <Pill tone="green">Open</Pill> : v === 0 ? <Pill tone="green">Balanced</Pill> : <Pill tone="red">{v > 0 ? 'Over' : 'Short'} {fmt(Math.abs(v))}</Pill>}
                </div>
                {z ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {Z_ROWS.filter(([k]) => z[k] != null && !(k === 'event_cash' && !Number(z[k]))).map(([k, l, b]) => (
                        <tr key={k} className={b ? 'border-t border-slate-200 font-bold' : ''}><td className="py-1">{l}</td><td className="text-right tabular-nums">{fmt(Number(z[k]))}</td></tr>
                      ))}
                      {s.status !== 'open' && <tr className={`font-bold ${v === 0 ? 'text-emerald-700' : 'text-red-700'}`}><td className="py-1">Variance</td><td className="text-right tabular-nums">{v > 0 ? '+' : ''}{fmt(v)}</td></tr>}
                      <tr><td colSpan={2} className="pt-2 text-xs text-slate-500">
                        Card {fmt(Number(z.card_sales ?? 0) + Number(z.room_card_payments ?? 0))} · Charged to rooms {fmt(Number(z.room_charges ?? 0))} · Comps {fmt(Number(z.owner_comps ?? 0))} · Tour profit {fmt(Number(z.tour_profit ?? 0))} · {z.sales_count ?? 0} sales
                      </td></tr>
                    </tbody>
                  </table>
                ) : <p className="text-sm text-slate-500">Closed before blind close was introduced.</p>}
                {s.notes && <p className="mt-2 rounded-lg bg-cocoa-50 px-3 py-2 text-xs text-slate-700">{s.notes}</p>}
              </Card>
            );
          })}
          {shifts.length === 0 && <p className="text-slate-500">No shifts in this period.</p>}
        </div>
      )}

      {tab === 'comps' && (
        <Card title="Owner allowances report">
          <p className="mb-3 text-sm text-slate-600">Every owner comp needs a manager PIN and an approval note. No cash moves; the amount is recorded here for the owner.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>For</th><th>Items</th><th>Approval note</th><th>Approved by</th><th>Cashier</th><th className="text-right">Amount</th></tr></thead>
              <tbody>{comps.map((c) => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">{dt(c.created_at)}{c.shift_no && <div className="text-xs text-slate-500">Shift #{c.shift_no}</div>}</td>
                  <td>{c.reservation_id ? <Link href={`/dashboard/folio/${c.reservation_id}`} className="underline">{c.guest}</Link> : 'Walk-in'}{c.reference && <div className="font-mono text-xs text-slate-500">{c.reference}</div>}</td>
                  <td className="text-xs">{c.items || 'Folio balance'}</td>
                  <td>{c.note}</td><td>{c.approver}</td><td>{c.cashier}</td>
                  <td className="text-right font-semibold tabular-nums">{fmt(Number(c.amount_cents))}</td>
                </tr>))}
                {comps.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">No owner comps in this period.</td></tr>}
              </tbody>
              {comps.length > 0 && <tfoot><tr className="border-t-2 border-cocoa-200 font-bold"><td className="py-2" colSpan={6}>Total</td><td className="text-right tabular-nums">{fmt(compTotal)}</td></tr></tfoot>}
            </table>
          </div>
        </Card>
      )}

      {tab === 'expenses' && (
        <Card title="Expenses paid from the drawer">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>Category</th><th>Description</th><th>Staff</th><th>Shift</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{expenses.map((e) => (
              <tr key={e.id} className="border-t border-slate-100"><td className="py-2">{dt(e.created_at)}</td><td>{e.category.replace(/_/g, ' ')}</td><td>{e.description}</td><td>{e.staff ?? '—'}</td><td>{e.shift_no ? `#${e.shift_no}` : '—'}</td>
                <td className="text-right tabular-nums">{fmt(Number(e.amount_cents), e.currency)}</td></tr>))}
              {expenses.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No expenses in this period.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
