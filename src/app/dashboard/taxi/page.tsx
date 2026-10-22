import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, Flash, Btn, BtnGhost, Input, Lbl, Pill, Stat } from '@/components/dash';
import { Icon } from '@/components/icons';
import { listTaxis, taxiPrices, taxiMessage, waLink, reminderShift } from '@/services/pms/taxi';
import { taxiCreate, taxiStatus, taxiPricesSave } from '../pms-actions';

export const dynamic = 'force-dynamic';
const when = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));

export default async function TaxiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('frontdesk.use');
  const sp = await searchParams;
  const today = todayLocal();
  const [list, prices, guests] = await Promise.all([
    listTaxis(addDays(today, -1), addDays(today, 14)), taxiPrices(),
    q<any>(`SELECT r.id, r.reference, r.check_in, r.check_out, r.status, g.full_name FROM reservations r JOIN guests g ON g.id=r.guest_id
            WHERE r.status IN ('confirmed','checked_in','pending') AND r.check_out >= $1 AND r.check_in <= $1::date + 14 ORDER BY r.check_in, g.full_name`, [today]),
  ]);
  const upcoming = list.filter((t) => t.status === 'booked');
  const notInformed = upcoming.filter((t) => !t.confirmed_at).length;
  const rows = await Promise.all(list.map(async (t) => ({ ...t, sh: await reminderShift(new Date(t.scheduled_at)), wa: waLink(t.phone, taxiMessage(t)) })));

  return (
    <>
      <PageHeader title="Airport taxi" sub={`Pick-ups and drop-offs. Cairo airport USD ${prices.cairo / 100}, Sphinx airport USD ${prices.sphinx / 100}, collected at the hostel.`} />
      <Flash sp={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Upcoming" value={upcoming.length} />
        <Stat label="Guest not informed" value={notInformed} tone={notInformed ? 'warn' : 'ok'} />
        <Stat label="Today" value={upcoming.filter((t) => todayLocal(new Date(t.scheduled_at)) === today).length} />
        <Stat label="Tomorrow" value={upcoming.filter((t) => todayLocal(new Date(t.scheduled_at)) === addDays(today, 1)).length} />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Bookings" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>Guest</th><th>Trip</th><th>Guest informed</th><th /></tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id} className={`border-t border-slate-100 align-top ${t.status !== 'booked' ? 'opacity-50' : ''}`}>
                  <td className="whitespace-nowrap py-2 font-semibold">{when(t.scheduled_at)}</td>
                  <td>{t.guest_name}{t.room_label && <div className="text-xs text-slate-500">{t.room_label}</div>}{t.reference && <div className="font-mono text-xs text-slate-400">{t.reference}</div>}</td>
                  <td>{t.direction === 'pickup' ? 'Pick-up' : 'Drop-off'} · {t.airport === 'sphinx' ? 'Sphinx' : 'Cairo'}<div className="text-xs text-slate-500">USD {Number(t.price_minor) / 100}{t.status !== 'booked' && ` · ${t.status}`}</div></td>
                  <td>{t.confirmed_at ? <Pill tone="green">Informed{t.confirmed_by_name ? ` · ${t.confirmed_by_name}` : ''}</Pill> : <Pill tone="amber">Not yet</Pill>}
                    <div className="text-xs text-slate-500">{t.sh.code === 'EVENING' ? 'Afternoon shift' : 'Morning shift'} of {t.sh.workDate}</div></td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {t.wa && t.status === 'booked' && <a href={t.wa} target="_blank" rel="noopener noreferrer" className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white">WhatsApp</a>}
                      {t.status === 'booked' && (
                        <form action={taxiStatus} className="flex gap-1"><input type="hidden" name="id" value={t.id} />
                          <button name="status" value={t.confirmed_at ? 'uninformed' : 'informed'} className="rounded-md border border-cocoa-200 px-2 py-1 text-xs font-semibold">{t.confirmed_at ? 'Undo informed' : 'Mark informed'}</button>
                          <button name="status" value="done" className="rounded-md border border-cocoa-200 px-2 py-1 text-xs font-semibold">Done</button>
                          {can(u.role, 'reservation.cancel') && <button name="status" value="cancelled" className="rounded-md px-2 py-1 text-xs font-semibold text-red-700">Cancel</button>}
                        </form>
                      )}
                    </div>
                  </td>
                </tr>))}
                {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-500">No taxis booked.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-5">
          <Card title="Book a taxi">
            <form action={taxiCreate} className="space-y-3">
              <div><Lbl htmlFor="tx-r">Guest (booking)</Lbl>
                <select id="tx-r" name="reservationId" className={Input}>
                  <option value="">Not in the system: type the name below</option>
                  {guests.map((g) => <option key={g.id} value={g.id}>{g.full_name} · {g.reference} · {g.check_in} → {g.check_out}</option>)}
                </select></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Lbl htmlFor="tx-n">Name (if no booking)</Lbl><input id="tx-n" name="guestName" className={Input} /></div>
                <div><Lbl htmlFor="tx-p">WhatsApp number</Lbl><input id="tx-p" name="phone" dir="ltr" placeholder="+49…" className={Input} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Lbl htmlFor="tx-d">Direction</Lbl><select id="tx-d" name="direction" className={Input}><option value="pickup">Pick-up (arrival)</option><option value="dropoff">Drop-off (departure)</option></select></div>
                <div><Lbl htmlFor="tx-a">Airport</Lbl><select id="tx-a" name="airport" className={Input}><option value="cairo">Cairo · USD {prices.cairo / 100}</option><option value="sphinx">Sphinx · USD {prices.sphinx / 100}</option></select></div>
                <div><Lbl htmlFor="tx-dt">Date</Lbl><input id="tx-dt" name="date" type="date" required min={today} defaultValue={addDays(today, 1)} className={Input} /></div>
                <div><Lbl htmlFor="tx-t">Time (flight / pick-up)</Lbl><input id="tx-t" name="time" type="time" required className={Input} /></div>
              </div>
              <div><Lbl htmlFor="tx-note">Note</Lbl><input id="tx-note" name="note" placeholder="Flight number, luggage…" className={Input} /></div>
              <button className={Btn + ' w-full'}><Icon name="plus" size={16} /> Book taxi</button>
              <p className="text-xs text-slate-500">With a booking, the price is added to the guest’s folio at today’s rate. Before 10:00 the afternoon shift the evening before messages the guest; otherwise the morning shift that day.</p>
            </form>
          </Card>
          {can(u.role, 'staff.manage') && (
            <Card title="Prices (USD)">
              <form action={taxiPricesSave} className="flex items-end gap-2">
                <div><Lbl htmlFor="pc">Cairo</Lbl><input id="pc" name="cairo" type="number" min={1} step="1" defaultValue={prices.cairo / 100} className={Input + ' w-24'} /></div>
                <div><Lbl htmlFor="ps">Sphinx</Lbl><input id="ps" name="sphinx" type="number" min={1} step="1" defaultValue={prices.sphinx / 100} className={Input + ' w-24'} /></div>
                <button className={BtnGhost}>Save</button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
