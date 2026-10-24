import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, fmt, dt, BtnGhost, Input, Stat, Pill } from '@/components/dash';
import { Icon } from '@/components/icons';
import { shiftTotals } from '@/services/pms/pos';
import { cardPayersFor } from '@/services/pms/card-payers';
import { getRates } from '@/services/pms/fx';
import { shortageResolve, fxSave } from '../pms-actions';
import { Lbl, Btn, Flash } from '@/components/dash';

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
  const tab = (['comps', 'expenses', 'shortages', 'taken', 'foreign'] as const).find((t) => t === sp.tab) ?? 'shifts';
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
  const [shortages, taken, rates] = await Promise.all([
    q<any>(`SELECT cs.*, s.full_name staff, sh.shift_no, sh.closed_at, u.name resolved_name FROM cash_shortages cs LEFT JOIN staff s ON s.id=cs.staff_id
            LEFT JOIN cash_shifts sh ON sh.id=cs.shift_id LEFT JOIN users u ON u.id=cs.resolved_by
            WHERE cs.status='open' OR (cs.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2 ORDER BY cs.status <> 'open', cs.created_at DESC`, [from, to]),
    q<any>(`SELECT t.*, s.full_name, sh.shift_no FROM cash_taken t JOIN staff s ON s.id=t.staff_id LEFT JOIN cash_shifts sh ON sh.id=t.shift_id
            WHERE (t.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2 ORDER BY t.created_at DESC`, [from, to]),
    getRates(),
  ]);
  const openShort = shortages.filter((x) => x.status === 'open');
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
      <Flash sp={sp} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Drawer open" value={open ? `#${open.shift_no}` : 'None'} hint={open ? `${open.cashier ?? ''} · expected ${fmt(live!.expectedCash)}` : 'Open from the POS'} />
        <Stat label="Shifts closed" value={closed.length} />
        <Stat label="Net variance" value={net === 0 ? fmt(0) : `${net > 0 ? 'Over' : 'Short'} ${fmt(Math.abs(net))}`} tone={net === 0 ? 'ok' : 'due'} />
        <Stat label="Open shortages" value={openShort.length} tone={openShort.length ? 'due' : 'ok'} hint={openShort.map((x) => `${x.staff ?? ''} ${x.currency} ${Number(x.amount_minor) / 100}`).join(' · ') || 'None'} />
      </div>

      <Card className="mb-5">
        <form action={fxSave} className="flex flex-wrap items-end gap-3">
          <div><p className="text-sm font-bold text-cocoa-800">Exchange rates (EGP)</p>
            <p className="text-xs text-slate-500">{rates.source === 'none' ? 'Not set yet' : `${rates.source === 'manual' ? 'Set by hand' : 'Market rate'} · ${rates.updated_at ? dt(rates.updated_at) : ''}`}. Used for cash in USD / EUR and taxi prices.</p></div>
          <div><Lbl htmlFor="fx-usd">1 USD</Lbl><input id="fx-usd" name="usd" type="number" step="0.01" min={1} defaultValue={rates.USD ?? ''} className={Input + ' w-28'} /></div>
          <div><Lbl htmlFor="fx-eur">1 EUR</Lbl><input id="fx-eur" name="eur" type="number" step="0.01" min={1} defaultValue={rates.EUR ?? ''} className={Input + ' w-28'} /></div>
          <button className={Btn}>Save</button>
          <button name="refresh" value="1" className={BtnGhost}><Icon name="refresh" size={16} /> Get today’s rate</button>
        </form>
      </Card>

      <nav className="mb-4 flex flex-wrap gap-2">
        {[['shifts', 'Z-reports', 'receipt'], ['shortages', `Shortages${openShort.length ? ` (${openShort.length})` : ''}`, 'alert-triangle'], ['taken', 'Taken (owner)', 'wallet'], ['comps', 'Owner allowances', 'gift'], ['expenses', 'Drawer expenses', 'banknote'], ['foreign', 'Foreign card payers', 'credit-card']].map(([k, l, i]) => (
          <Link key={k} href={`?tab=${k}&${range}`} aria-current={tab === k ? 'page' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${tab === k ? 'border-cocoa-800 bg-cocoa-800 text-white' : 'border-cocoa-200 bg-white text-cocoa-800 hover:border-cocoa-600'}`}><Icon name={i} size={15} /> {l}</Link>
        ))}
      </nav>

      {tab === 'shifts' && (
        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {shifts.map((s) => {
            const z = s.z_report ?? (live && s.id === open?.id ? { opening_float: live.opening, cash_sales: live.cashSales, room_cash_payments: live.roomCashPayments, event_cash: live.eventCash, approved_expenses: live.expenses, expected_cash: live.expectedCash, currencies: live.currencies, card_sales: live.cardSales, room_card_payments: live.roomCardPayments, room_charges: live.roomCharges, owner_comps: live.comps, tour_profit: live.tourProfit, sales_count: live.salesCount } : null);
            const v = Number(s.variance_cents ?? 0);
            return (
              <Card key={s.id}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div><h3 className="text-lg font-bold text-cocoa-800">Shift #{s.shift_no}</h3>
                    <p className="text-xs text-slate-500">{s.cashier ?? '—'} · {dt(s.opened_at ?? s.created_at)}{s.closed_at && ` → ${dt(s.closed_at)}`}</p></div>
                  {s.status === 'open' ? <Pill tone="green">Open</Pill> : v === 0 ? <Pill tone="green">Balanced</Pill> : <Pill tone="red">{v > 0 ? 'Over' : 'Short'} {fmt(Math.abs(v))}</Pill>}
                </div>
                {z?.currencies ? (
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-slate-500"><th /><th className="text-right">EGP</th><th className="text-right">USD</th><th className="text-right">EUR</th></tr></thead>
                    <tbody>
                      {([['opening', 'Received'], ['sales', '+ Cash sales'], ['payments', '+ Guest cash'], ['events', '+ Events cash'], ['expenses', '− Expenses'], ['taken', '− Taken'], ['expected', 'Expected'], ['counted', 'Counted']] as const).map(([k, l]) => (
                        <tr key={k} className={k === 'expected' || k === 'counted' ? 'border-t border-slate-200 font-bold' : ''}><td className="py-1">{l}</td>
                          {['EGP', 'USD', 'EUR'].map((c) => <td key={c} className="text-right tabular-nums">{z.currencies[c]?.[k] != null ? (Number(z.currencies[c][k]) / 100).toLocaleString('en-US') : '—'}</td>)}</tr>
                      ))}
                      {s.status !== 'open' && <tr className="font-bold"><td className="py-1">Difference</td>{['EGP', 'USD', 'EUR'].map((c) => { const v = Number(z.currencies[c]?.variance ?? 0); return <td key={c} className={`text-right tabular-nums ${v === 0 ? 'text-emerald-700' : 'text-red-700'}`}>{v > 0 ? '+' : ''}{(v / 100).toLocaleString('en-US')}</td>; })}</tr>}
                      <tr><td colSpan={4} className="pt-2 text-xs text-slate-500">Card {fmt(Number(z.card_sales ?? 0) + Number(z.room_card_payments ?? 0))} · Charged to rooms {fmt(Number(z.room_charges ?? 0))} · Comps {fmt(Number(z.owner_comps ?? 0))} · Tour profit {fmt(Number(z.tour_profit ?? 0))} · {z.sales_count ?? 0} sales</td></tr>
                    </tbody>
                  </table>
                ) : z ? (
                  <table className="w-full text-sm">
                    <tbody>
                      {Z_ROWS.filter(([k]) => z[k] != null && !(k === 'event_cash' && !Number(z[k]))).map(([k, l, b]) => (
                        <tr key={k} className={b ? 'border-t border-slate-200 font-bold' : ''}><td className="py-1">{l}</td><td className="text-right tabular-nums">{fmt(Number(z[k]))}</td></tr>
                      ))}
                      {s.status !== 'open' && <tr className={`font-bold ${v === 0 ? 'text-emerald-700' : 'text-red-700'}`}><td className="py-1">Variance</td><td className="text-right tabular-nums">{v > 0 ? '+' : ''}{fmt(v)}</td></tr>}
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

      {tab === 'foreign' && await (async () => {
        const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : addDays(todayLocal(), -1);
        const rows = await cardPayersFor(day);
        const total = rows.reduce((a: number, r: any) => a + Number(r.amount_cents), 0);
        return (
          <Card title="Foreign guests who paid by card (venue POS machine)">
            <p className="mb-3 text-sm text-slate-600">The cashier records passport number, name and nationality on the POS for every card payment by a foreign guest. Each night at 00:00 the previous day's Excel is sent to the owner on Telegram; any day can be downloaded here.</p>
            <form className="mb-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="tab" value="foreign" />
              <div><Lbl htmlFor="fd">Day</Lbl><input id="fd" type="date" name="day" defaultValue={day} className={Input + ' w-44'} /></div>
              <button className={BtnGhost}>Show</button>
              <a className={Btn} href={`/api/dashboard/foreign-card-report?date=${day}`}><Icon name="download" size={16} /> Download Excel</a>
            </form>
            {rows.length === 0 ? <p className="text-sm text-slate-500">No card payments by foreign guests on {day}.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-600"><tr><th className="py-2">Time</th><th>Name</th><th>Nationality</th><th>Passport No.</th><th className="text-right">Amount</th><th>Paid for</th><th>Booking</th><th>Cashier</th></tr></thead>
                  <tbody>{rows.map((r: any) => (
                    <tr key={r.id} className="border-t border-slate-100"><td className="py-2 tabular-nums">{r.time}</td><td className="font-medium">{r.full_name}</td><td>{r.nationality}</td><td className="font-mono">{r.passport_no}</td>
                      <td className="text-right font-semibold tabular-nums">{fmt(Number(r.amount_cents))}</td><td className="text-xs">{r.paid_for}</td><td className="text-xs">{r.reference ?? 'Walk-in'}</td><td className="text-xs">{r.staff_name}{r.shift_no ? ` · #${r.shift_no}` : ''}</td></tr>))}</tbody>
                  <tfoot><tr className="border-t-2 border-cocoa-200 font-semibold"><td className="py-2" colSpan={4}>{rows.length} payment(s)</td><td className="text-right tabular-nums">{fmt(total)}</td><td colSpan={3} /></tr></tfoot>
                </table>
              </div>
            )}
          </Card>
        );
      })()}

      {tab === 'shortages' && (
        <Card title="Cash shortages">
          <p className="mb-3 text-sm text-slate-600">Recorded on the person who handed the drawer over. They pay it now in cash, or it is deducted from salary.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">Shift</th><th>Staff</th><th className="text-right">Missing</th><th>Status</th><th /></tr></thead>
              <tbody>{shortages.map((x) => (
                <tr key={x.id} className="border-t border-slate-100 align-top">
                  <td className="py-2">#{x.shift_no}<div className="text-xs text-slate-500">{dt(x.closed_at ?? x.created_at)}</div></td>
                  <td>{x.staff ?? '—'}</td>
                  <td className="text-right font-semibold tabular-nums text-red-700">{x.currency} {(Number(x.amount_minor) / 100).toLocaleString('en-US')}</td>
                  <td>{x.status === 'open' ? <Pill tone="red">Open</Pill> : <Pill tone={x.status === 'waived' ? 'slate' : 'green'}>{x.status === 'paid_cash' ? 'Paid in cash' : x.status === 'salary' ? 'Deduct from salary' : 'Waived'}</Pill>}
                    {x.note && <div className="text-xs text-slate-500">{x.note}</div>}{x.resolved_name && <div className="text-xs text-slate-400">by {x.resolved_name}</div>}</td>
                  <td>
                    <form action={shortageResolve} className="flex flex-wrap items-center gap-1">
                      <input type="hidden" name="id" value={x.id} />
                      <input name="note" placeholder="Note" className="w-32 rounded-md border border-cocoa-200 px-2 py-1 text-xs" />
                      <button name="status" value="paid_cash" className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white">Paid cash</button>
                      <button name="status" value="salary" className="rounded-md bg-cocoa-800 px-2 py-1 text-xs font-semibold text-white">Salary</button>
                      <button name="status" value="waived" className="rounded-md border border-cocoa-200 px-2 py-1 text-xs font-semibold">Waive</button>
                    </form>
                  </td>
                </tr>))}
                {shortages.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-500">No shortages.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'taken' && (
        <Card title="Cash taken by the owner">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>By</th><th>Shift</th><th className="text-right">EGP</th><th className="text-right">USD</th><th className="text-right">EUR</th><th>Note</th></tr></thead>
            <tbody>{taken.map((t) => (
              <tr key={t.id} className="border-t border-slate-100"><td className="py-2">{dt(t.created_at)}</td><td>{t.full_name}</td><td>#{t.shift_no}</td>
                <td className="text-right tabular-nums">{(Number(t.egp_cents) / 100).toLocaleString('en-US')}</td><td className="text-right tabular-nums">{(Number(t.usd_cents) / 100).toLocaleString('en-US')}</td>
                <td className="text-right tabular-nums">{(Number(t.eur_cents) / 100).toLocaleString('en-US')}</td><td className="text-xs text-slate-500">{t.note}</td></tr>))}
              {taken.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">Nothing taken in this period.</td></tr>}
            </tbody>
          </table>
        </Card>
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
                  <td>{c.reservation_id ? <Link href={`/dashboard/reservations/${c.reservation_id}`} className="underline">{c.guest}</Link> : 'Walk-in'}{c.reference && <div className="font-mono text-xs text-slate-500">{c.reference}</div>}</td>
                  <td className="text-xs">{c.items || 'Bill balance'}</td>
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
