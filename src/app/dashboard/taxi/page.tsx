import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, Flash, Btn, BtnGhost, Input, Lbl, Pill, Stat } from '@/components/dash';
import { Icon } from '@/components/icons';
import { listTaxis, taxiPrices, taxiMessage, waLink, reminderShift, listDrivers, driverJobText, driverWaLink } from '@/services/pms/taxi';
import { getWhatsAppConfig } from '@/services/whatsapp';
import { taxiCreate, taxiStatus, taxiPricesSave, taxiDriverAssign, taxiDriverSave, taxiDriverActive, taxiTemplatesSave } from '../pms-actions';
import { META_DRIVER_JOB, META_DRIVER_REMINDER } from '@/content/wa-templates';

export const dynamic = 'force-dynamic';
const when = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));

export default async function TaxiPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('frontdesk.use');
  const sp = await searchParams;
  const today = todayLocal();
  const [list, prices, guests, drivers, allDrivers, wa] = await Promise.all([
    listTaxis(addDays(today, -1), addDays(today, 14)), taxiPrices(),
    q<any>(`SELECT r.id, r.reference, r.check_in, r.check_out, r.status, g.full_name FROM reservations r JOIN guests g ON g.id=r.guest_id
            WHERE r.status IN ('confirmed','checked_in','pending') AND r.check_out >= $1 AND r.check_in <= $1::date + 14 ORDER BY r.check_in, g.full_name`, [today]),
    listDrivers(), listDrivers(true), getWhatsAppConfig(),
  ]);
  const waOn = !!(wa.token && wa.phone_number_id);
  const noDriver = list.filter((t) => t.status === 'booked' && !t.driver_id).length;
  const upcoming = list.filter((t) => t.status === 'booked');
  const notInformed = upcoming.filter((t) => !t.confirmed_at).length;
  const rows = await Promise.all(list.map(async (t) => ({ ...t, sh: await reminderShift(new Date(t.scheduled_at)), wa: waLink(t.phone, taxiMessage(t)), dwa: t.driver_id ? driverWaLink(t.driver_phone, driverJobText(t)) : null })));

  return (
    <>
      <PageHeader title="Airport taxi" sub={`Pick-ups and drop-offs. Cairo airport USD ${prices.cairo / 100}, Sphinx airport USD ${prices.sphinx / 100}, collected at the hostel.`} />
      <Flash sp={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Upcoming" value={upcoming.length} />
        <Stat label="Guest not informed" value={notInformed} tone={notInformed ? 'warn' : 'ok'} />
        <Stat label="Today" value={upcoming.filter((t) => todayLocal(new Date(t.scheduled_at)) === today).length} />
        <Stat label="No driver yet" value={noDriver} tone={noDriver ? 'warn' : 'ok'} />
      </div>
      {!waOn && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">WhatsApp isn’t connected yet, so drivers aren’t messaged automatically. When you pick a driver, press <b>Send to driver</b> (the message is ready); the 30-minute reminder comes to your Telegram with a one-tap button. Once WhatsApp is connected (Events → Settings) both go out by themselves.</p>}
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Bookings" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>Guest</th><th>Trip</th><th>Driver</th><th>Guest informed</th><th /></tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id} className={`border-t border-slate-100 align-top ${t.status !== 'booked' ? 'opacity-50' : ''}`}>
                  <td className="whitespace-nowrap py-2 font-semibold">{when(t.scheduled_at)}</td>
                  <td>{t.guest_name}{t.room_label && <div className="text-xs text-slate-500">{t.room_label}</div>}{t.reference && <div className="font-mono text-xs text-slate-400">{t.reference}</div>}</td>
                  <td>{t.direction === 'pickup' ? 'Pick-up' : 'Drop-off'} · {t.airport === 'sphinx' ? 'Sphinx' : 'Cairo'}<div className="text-xs text-slate-500">USD {Number(t.price_minor) / 100}{t.status !== 'booked' && ` · ${t.status}`}</div></td>
                  <td className="min-w-[180px]">
                    {t.status === 'booked' ? (
                      <form action={taxiDriverAssign} className="flex gap-1"><input type="hidden" name="id" value={t.id} />
                        <select name="driverId" defaultValue={t.driver_id ?? ''} className="min-w-0 flex-1 rounded-md border border-cocoa-200 px-1.5 py-1 text-xs">
                          <option value="">— choose —</option>
                          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          {t.driver_id && !drivers.some((d) => d.id === t.driver_id) && <option value={t.driver_id}>{t.driver_name}</option>}
                        </select>
                        <button className="rounded-md bg-cocoa-800 px-2 py-1 text-xs font-semibold text-white">{t.driver_id ? 'Change' : 'Set'}</button>
                      </form>
                    ) : <span className="text-xs">{t.driver_name ?? '—'}</span>}
                    {t.driver_id && t.status === 'booked' && (
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                        {t.driver_notified_at ? <Pill tone="green">Driver has it</Pill> : t.dwa && <a href={t.dwa} target="_blank" rel="noopener noreferrer" className="rounded-md bg-emerald-700 px-2 py-0.5 font-semibold text-white">Send to driver</a>}
                        {t.driver_reminded_at ? <span className="text-slate-500">reminder done</span> : <span className="text-slate-500">reminder 30 min before</span>}
                      </div>
                    )}
                  </td>
                  <td>{t.confirmed_at ? <Pill tone="green">Informed{t.confirmed_by_name ? ` · ${t.confirmed_by_name}` : ''}</Pill> : <Pill tone="amber">Not yet</Pill>}
                    <div className="text-xs text-slate-500">{t.sh.code === 'EVENING' ? 'Afternoon shift' : 'Morning shift'} of {t.sh.workDate}</div></td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {t.wa && t.status === 'booked' && <a href={t.wa} target="_blank" rel="noopener noreferrer" className="rounded-md bg-emerald-700 px-2 py-1 text-xs font-semibold text-white">WhatsApp</a>}
                      {t.status === 'booked' && (
                        <form action={taxiStatus} className="flex gap-1"><input type="hidden" name="id" value={t.id} />
                          <button name="status" value={t.confirmed_at ? 'uninformed' : 'informed'} className="rounded-md border border-cocoa-200 px-2 py-1 text-xs font-semibold">{t.confirmed_at ? 'Undo informed' : 'Mark informed'}</button>
                          <button name="status" value="done" className="rounded-md border border-cocoa-200 px-2 py-1 text-xs font-semibold">Trip done</button>
                          {can(u.role, 'reservation.cancel') && <button name="status" value="cancelled" className="rounded-md px-2 py-1 text-xs font-semibold text-red-700">Cancel</button>}
                        </form>
                      )}
                    </div>
                  </td>
                </tr>))}
                {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No taxis booked.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="space-y-5">
          <Card title="Book a taxi">
            <form action={taxiCreate} className="space-y-3">
              <div><Lbl htmlFor="tx-r">Guest (booking)</Lbl>
                <select id="tx-r" name="reservationId" className={Input} defaultValue={sp.reservation ?? ''}>
                  <option value="">Choose the guest… (or leave and type a name below)</option>
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
              <div><Lbl htmlFor="tx-note">Note (goes to the driver)</Lbl><input id="tx-note" name="note" placeholder="Flight number, luggage…" className={Input} /></div>
              <div><Lbl htmlFor="tx-drv">Driver (optional · can be set later)</Lbl>
                <select id="tx-drv" name="driverId" className={Input} defaultValue="">
                  <option value="">Choose later</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}{d.car ? ` · ${d.car}` : ''}</option>)}
                </select></div>
              <button className={Btn + ' w-full'}><Icon name="plus" size={16} /> Book taxi</button>
              <p className="text-xs text-slate-500">With a booking, the price goes on the guest’s bill at today’s rate. Someone without a booking pays on the POS (Taxi). Before 10:00 the afternoon shift the evening before messages the guest; otherwise the morning shift that day.</p>
            </form>
          </Card>
          <Card title="Drivers" id="drivers">
            <ul className="mb-3 divide-y divide-slate-100 text-sm">
              {allDrivers.map((d) => (
                <li key={d.id} className={`flex items-center justify-between gap-2 py-2 ${d.active ? '' : 'opacity-50'}`}>
                  <span><b>{d.name}</b>{d.car && <span className="text-slate-500"> · {d.car}</span>}<span className="block font-mono text-xs text-slate-500" dir="ltr">+{d.phone}</span></span>
                  <form action={taxiDriverActive}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="active" value={d.active ? '0' : '1'} />
                    <button className="rounded-md border border-cocoa-200 px-2 py-1 text-xs font-semibold">{d.active ? 'Remove' : 'Bring back'}</button></form>
                </li>
              ))}
              {allDrivers.length === 0 && <li className="py-2 text-slate-500">No drivers yet. Add the drivers you work with below.</li>}
            </ul>
            <form action={taxiDriverSave} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div><Lbl htmlFor="dr-n">Name</Lbl><input id="dr-n" name="name" required className={Input} /></div>
                <div><Lbl htmlFor="dr-p">WhatsApp number</Lbl><input id="dr-p" name="phone" required dir="ltr" placeholder="010… / +20…" className={Input} /></div>
              </div>
              <div><Lbl htmlFor="dr-c">Car (optional)</Lbl><input id="dr-c" name="car" placeholder="e.g. Toyota Corolla white" className={Input} /></div>
              <button className={BtnGhost + ' w-full'}><Icon name="plus" size={15} /> Add driver</button>
            </form>
          </Card>
          {can(u.role, 'settings.manage') && (
            <Card title="WhatsApp templates for drivers (Meta)" id="templates">
              <p className="mb-2 text-xs text-slate-600">Create these two templates in Meta (WhatsApp Manager → Message templates · Category <b>Utility</b> · Language <b>Arabic</b>), then write their names here. Until then the same text is sent as a normal message or by the button.</p>
              <details className="mb-2"><summary className="cursor-pointer text-xs font-semibold text-cocoa-800">Template 1 · new trip (6 variables)</summary><pre dir="rtl" className="mt-1 whitespace-pre-wrap rounded-lg bg-cocoa-50 p-2 text-xs">{META_DRIVER_JOB}</pre></details>
              <details className="mb-3"><summary className="cursor-pointer text-xs font-semibold text-cocoa-800">Template 2 · reminder 30 min before (5 variables)</summary><pre dir="rtl" className="mt-1 whitespace-pre-wrap rounded-lg bg-cocoa-50 p-2 text-xs">{META_DRIVER_REMINDER}</pre></details>
              <form action={taxiTemplatesSave} className="space-y-2">
                <div><Lbl htmlFor="tp-j">Name of template 1</Lbl><input id="tp-j" name="tplJob" dir="ltr" placeholder="driver_new_trip" defaultValue={wa.template_driver_job} className={Input} /></div>
                <div><Lbl htmlFor="tp-r">Name of template 2</Lbl><input id="tp-r" name="tplReminder" dir="ltr" placeholder="driver_trip_reminder" defaultValue={wa.template_driver_reminder} className={Input} /></div>
                <button className={BtnGhost}>Save</button>
              </form>
            </Card>
          )}
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
