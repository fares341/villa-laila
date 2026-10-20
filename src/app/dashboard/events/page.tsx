import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, Flash, fmt, dt, Btn, BtnGhost, BtnDanger, Input, Empty } from '@/components/dash';
import { listInstapaySubmissions } from '@/services/online-payments';
import { paymobEnabled } from '@/services/paymob';
import { instapayEnabled } from '@/services/instapay';
import { tr, eventProfit, listPublicEvents } from '@/services/events';
import { Icon } from '@/components/icons';
import { Pill } from '@/components/dash';
import { decideInstapayAction, markEventPaidAction, checkInEventAction, cancelEventBookingAction, findTicketAction } from './actions';

export const dynamic = 'force-dynamic';

const ST: Record<string, [string, string]> = {
  paid: ['Paid', 'bg-emerald-100 text-emerald-900'],
  pay_on_site: ['Pay at door', 'bg-sky-100 text-sky-900'],
  pending_verification: ['InstaPay to check', 'bg-amber-100 text-amber-900'],
  awaiting_payment: ['Awaiting payment', 'bg-slate-100 text-slate-800'],
  expired: ['Expired', 'bg-slate-200 text-slate-600'],
  cancelled: ['Cancelled', 'bg-red-100 text-red-900'],
};

export default async function EventsDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('tours.manage');
  const sp = await searchParams;
  const today = todayLocal();
  const from = sp.from || today;
  const to = sp.to || addDays(today, 13);
  const canVerify = can(user.role, 'frontdesk.use');
  const canEdit = can(user.role, 'events.manage');

  const [instapay, bookings, events] = await Promise.all([
    listInstapaySubmissions(),
    q<any>(`
      SELECT b.*, e.title, e.slug, e.start_time, e.options
      FROM event_bookings b JOIN events e ON e.id=b.event_id
      WHERE b.event_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR b.status=$3)
        AND NOT (b.status='awaiting_payment' AND b.hold_expires_at < now())
      ORDER BY b.event_date, e.start_time, b.created_at`, [from, to, sp.status || null]),
    q<any>(`SELECT id, slug, title, kind, active, recurrence, weekdays, once_date, start_time, end_time, price_cents, guest_price_cents, cost_per_attendee_cents, capacity FROM events ORDER BY active DESC, sort_order, slug`),
  ]);
  const [profit, pubEvents] = await Promise.all([eventProfit(from, to), listPublicEvents()]);
  const liveById = new Map(pubEvents.map((e) => [e.id, e]));
  const profitById = new Map(profit.map((p: any) => [p.id, p]));

  const byDay = new Map<string, any[]>();
  for (const b of bookings) byDay.set(b.event_date, [...(byDay.get(b.event_date) ?? []), b]);
  const live = bookings.filter((b) => ['paid', 'pay_on_site', 'pending_verification'].includes(b.status));
  const people = live.reduce((s, b) => s + b.quantity, 0);
  const paidEgp = bookings.filter((b) => b.status === 'paid').reduce((s, b) => s + Number(b.total_cents), 0);
  const todayCount = live.filter((b) => b.event_date === today).reduce((s, b) => s + b.quantity, 0);

  return (
    <>
      <PageHeader title="Events & online payments" sub="Event tickets, InstaPay transfers to check, and door check-in.">
        <form action={findTicketAction} className="flex gap-2">
          <input name="code" placeholder="Ticket code EV-…" className={Input + ' w-44'} aria-label="Ticket code" />
          <button className={Btn}>Find ticket</button>
        </form>
        {canEdit && <Link href="/dashboard/events/edit/new" className={Btn}><Icon name="plus" size={16} /> New event</Link>}
        {canEdit && <Link href="/dashboard/events/edit/new?kind=day_use" className={BtnGhost}><Icon name="plus" size={16} /> New day-use</Link>}
      </PageHeader>
      <Flash sp={sp} />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Guests today', String(todayCount)],
          ['Booked (period)', String(people)],
          ['Paid online (period)', fmt(paidEgp)],
          ['InstaPay to check', String(instapay.length)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-cocoa-200 bg-white p-4"><p className="text-xs text-slate-600">{k}</p><p className="mt-1 text-2xl font-semibold text-cocoa-800">{v}</p></div>
        ))}
      </div>

      {(!paymobEnabled() || !instapayEnabled()) && (
        <p className="mb-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {!paymobEnabled() && <>Paymob is off: set <code>PAYMOB_SECRET_KEY</code>, <code>PAYMOB_PUBLIC_KEY</code>, <code>PAYMOB_HMAC_SECRET</code> and <code>PAYMOB_INTEGRATION_IDS</code> in <code>.env</code>. </>}
          {!instapayEnabled() && <>InstaPay is off: set <code>INSTAPAY_ADDRESS</code> (and optionally <code>INSTAPAY_PHONE</code>, <code>INSTAPAY_NAME</code>).</>}
        </p>
      )}

      <Card title={`InstaPay transfers to check (${instapay.length})`} className="mb-6">
        {instapay.length === 0 ? <p className="text-sm text-slate-600">Nothing waiting. InstaPay bookings with their screenshot wait here as Pending Approval. Approving makes the ticket valid; rejecting lets the guest send it again.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-600"><tr><th className="py-2">For</th><th>Guest</th><th>Sender</th><th>Reference</th><th>Amount</th><th>Sent</th><th>Screenshot</th><th /></tr></thead>
              <tbody>
                {instapay.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 align-top">
                    <td className="py-2">{p.kind === 'event'
                      ? <Link className="underline" href={`/en/tickets/${p.ticket_code}`}>{tr(p.event_title, 'en')} · {p.event_date} · {p.ticket_code}</Link>
                      : <span>Room booking {p.res_ref}</span>}</td>
                    <td>{p.event_guest || p.res_guest}</td>
                    <td>{p.payer_name}</td>
                    <td className="font-mono">{p.payer_reference}</td>
                    <td className="whitespace-nowrap font-semibold">{fmt(Number(p.amount_cents), p.currency)}</td>
                    <td className="whitespace-nowrap">{dt(p.created_at)}</td>
                    <td>{p.has_proof ? (
                      <a href={`/api/media/instapay/${p.id}`} target="_blank" rel="noopener" className="block w-20" title="Open full size">
                        {String(p.proof_mime).startsWith('image/') ? <img src={`/api/media/instapay/${p.id}`} alt="InstaPay screenshot" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                          : <span className="inline-flex items-center gap-1 text-sm underline"><Icon name="file-text" size={16} /> PDF</span>}
                      </a>) : <Pill tone="red">Missing</Pill>}</td>
                    <td className="whitespace-nowrap">
                      {canVerify ? (
                        <form action={decideInstapayAction} className="flex gap-1">
                          <input type="hidden" name="id" value={p.id} />
                          <button name="decision" value="verify" className={Btn}><Icon name="check" size={16} /> Approve</button>
                          <button name="decision" value="reject" className={BtnDanger}><Icon name="x" size={16} /> Reject</button>
                        </form>
                      ) : <span className="text-xs text-slate-500">Manager verifies</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Event bookings" className="mb-6">
        <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
          <label>From <input type="date" name="from" defaultValue={from} className={Input + ' w-40'} /></label>
          <label>To <input type="date" name="to" defaultValue={to} className={Input + ' w-40'} /></label>
          <label>Status
            <select name="status" defaultValue={sp.status || ''} className={Input + ' w-48'}>
              <option value="">All</option>
              {Object.entries(ST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <button className={BtnGhost}>Filter</button>
        </form>
        {bookings.length === 0 ? <Empty>No event bookings in this period.</Empty> : (
          [...byDay.entries()].map(([day, rows]) => (
            <div key={day} className="mb-5">
              <h3 className="mb-2 font-semibold text-cocoa-800">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))}{day === today && ' · today'}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-600"><tr><th className="py-1.5">Ticket</th><th>Event</th><th>Guest</th><th>Qty</th><th>Total</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {rows.map((b) => {
                      const [label, cls] = ST[b.status] ?? [b.status, 'bg-slate-100'];
                      const opt = b.option_key ? (b.options as any[]).find((o) => o.key === b.option_key)?.en : null;
                      return (
                        <tr key={b.id} className="border-t border-slate-100 align-top">
                          <td className="py-2 font-mono"><Link className="underline" href={`/${b.language || 'en'}/tickets/${b.ticket_code}`}>{b.ticket_code}</Link></td>
                          <td>{tr(b.title, 'en')} <span className="text-slate-500">{b.start_time}</span>{opt && <div className="text-xs text-slate-600">{opt}</div>}</td>
                          <td>{b.full_name}<div className="text-xs text-slate-600">{b.phone || b.email}</div>{b.is_hotel_guest && <div className="text-xs text-emerald-800">Hotel guest {b.stay_reference}</div>}</td>
                          <td className="num">{b.quantity}</td>
                          <td className="whitespace-nowrap">{fmt(Number(b.total_cents), b.currency)}<div className="text-xs text-slate-500">{b.pay_method}</div></td>
                          <td><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>{b.checked_in_at && <div className="mt-1 text-xs text-emerald-800">Checked in {dt(b.checked_in_at)}</div>}</td>
                          <td className="whitespace-nowrap">
                            <div className="flex flex-wrap gap-1">
                              {['paid', 'pay_on_site'].includes(b.status) && !b.checked_in_at && (
                                <form action={checkInEventAction}><input type="hidden" name="id" value={b.id} /><button className={Btn}>Check in</button></form>
                              )}
                              {['pay_on_site', 'awaiting_payment'].includes(b.status) && (
                                <form action={markEventPaidAction}><input type="hidden" name="id" value={b.id} /><button className={BtnGhost}>Paid cash</button></form>
                              )}
                              {b.status !== 'cancelled' && !b.checked_in_at && (
                                <form action={cancelEventBookingAction}><input type="hidden" name="id" value={b.id} /><button className={BtnGhost}>Cancel</button></form>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </Card>

      <Card title="Events & day-use">
        <p className="mb-3 text-sm text-slate-600">Profit = (ticket price − cost per attendee) × tickets sold, for the period above. Events sell out automatically at capacity.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600"><tr><th className="py-2">Event</th><th>Schedule</th><th className="text-right">Price</th><th className="text-right">Cost</th><th>Next date</th><th className="text-right">Sold</th><th className="text-right">Revenue</th><th className="text-right">Profit</th><th /></tr></thead>
            <tbody>
              {events.map((e) => {
                const pe = liveById.get(e.id); const pr: any = profitById.get(e.id) ?? { tickets: 0, revenue: 0 };
                const profitCents = Number(pr.revenue) - Number(e.cost_per_attendee_cents) * pr.tickets;
                return (
                  <tr key={e.id} className={`border-t border-slate-100 ${e.active ? '' : 'opacity-50'}`}>
                    <td className="py-2"><b>{tr(e.title, 'en')}</b><div className="text-xs text-slate-500">{e.kind === 'day_use' ? 'Day-use' : 'Event'}{!e.active && ' · not published'}</div></td>
                    <td className="text-xs">{e.recurrence === 'once' ? e.once_date : e.recurrence === 'daily' ? 'Daily' : 'Weekly ' + (e.weekdays as number[]).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}<br />{e.start_time}–{e.end_time}</td>
                    <td className="text-right tabular-nums">{fmt(Number(e.price_cents))}</td>
                    <td className="text-right tabular-nums">{fmt(Number(e.cost_per_attendee_cents))}</td>
                    <td className="text-xs">{!e.active ? '—' : pe?.soldOut ? <Pill tone="red">Sold out</Pill> : pe?.nextDate ? <>{pe.nextDate}{e.capacity != null && <div className="text-slate-500">{pe.seatsLeftNext} of {e.capacity} left</div>}</> : <span className="text-slate-400">No upcoming date</span>}</td>
                    <td className="text-right tabular-nums">{pr.tickets}{pr.pending ? <div className="text-xs text-amber-700">+{pr.pending} pending</div> : null}</td>
                    <td className="text-right tabular-nums">{fmt(Number(pr.revenue))}</td>
                    <td className="text-right font-semibold tabular-nums text-emerald-700">{fmt(profitCents)}</td>
                    <td className="text-right">{canEdit && <Link href={`/dashboard/events/edit/${e.id}`} className="text-sm font-semibold text-cocoa-600 underline">Edit</Link>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
