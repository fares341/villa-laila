import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, Flash, Input, Lbl, Btn, Badge, fmt, SubTabs, Stat } from '@/components/dash';
import { Icon } from '@/components/icons';
import { CHANNELS, listOta, otaCounts, type ChannelKey } from '@/services/ota-bookings';
import { otaCreate } from './actions';

export const dynamic = 'force-dynamic';
const ORDER: ChannelKey[] = ['booking_com', 'airbnb', 'hostelworld', 'expedia_collect', 'expedia_hotel'];
const COLLECT: Record<string, string> = { property: 'Pays at the hostel', channel: 'Paid to the site', deposit: 'Deposit to the site, rest at the hostel' };

/** One section per booking site. Reception types each booking in; the money left to pay is collected on the POS. */
export default async function OtaBookings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('reservation.view');
  const sp = await searchParams;
  const ch: ChannelKey = ORDER.includes(sp.ch as ChannelKey) ? (sp.ch as ChannelKey) : 'booking_com';
  const c = CHANNELS[ch];
  const [rows, counts, types, units, lhLast, lhIssues] = await Promise.all([
    listOta(ch), otaCounts(),
    q<any>(`SELECT id, name, kind FROM room_types WHERE active ORDER BY sort_order`),
    q<any>(`SELECT u.id, u.label, rm.name room, rm.room_type_id, t.kind FROM units u JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id WHERE u.active AND rm.active ORDER BY rm.name, u.label`),
    q<any>(`SELECT at, ok, found, message FROM lh_runs ORDER BY at DESC LIMIT 1`).catch(() => []),
    q<any>(`SELECT data->>'ref' ref, data->>'guest' guest, data->>'channel' channel, data->>'checkIn' check_in, status, detail FROM lh_seen WHERE status IN ('error','dry_run') AND last_seen > now() - interval '1 day' ORDER BY last_seen DESC LIMIT 20`).catch(() => []),
  ]);
  const lh = lhLast[0];
  const t0 = todayLocal();
  const upcoming = rows.filter((r) => ['confirmed', 'checked_in'].includes(r.status) && r.check_out >= t0);
  const dueTotal = upcoming.reduce((a, r) => a + Math.max(0, Number(r.charges) - Number(r.paid)), 0);
  const value = upcoming.reduce((a, r) => a + Number(r.charges), 0);
  const tabs = ORDER.map((k) => ({ href: `/dashboard/ota?ch=${k}`, label: CHANNELS[k].label, count: counts[k] }));

  return (
    <>
      <PageHeader title="Bookings from sites" sub="Booking.com, Airbnb, Hostelworld and Expedia bookings, typed in here. Every amount still to pay is collected on the POS." />
      <SubTabs tabs={tabs} current={`/dashboard/ota?ch=${ch}`} />
      <Flash sp={sp} />
      {lh && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${lh.ok && Date.now() - new Date(lh.at).getTime() < 15 * 60_000 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          <b>Little Hotelier reader:</b>{' '}
          {lh.ok ? `last read ${new Date(lh.at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' })}, ${lh.found} bookings seen` : `last read failed: ${lh.message}`}
          {lh.message === 'test mode' && ' · test mode, nothing is saved yet'}
          {lhIssues.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {lhIssues.map((i: any, n: number) => <li key={n}>{i.status === 'error' ? 'Not copied' : 'Would copy'}: {i.channel} {i.ref} · {i.guest} · {i.check_in}{i.detail ? ` · ${i.detail}` : ''}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Upcoming & in house" value={upcoming.length} />
        <Stat label="Value" value={fmt(value)} />
        <Stat label="Still to collect at the hostel" value={fmt(dueTotal)} tone={dueTotal > 0 ? 'due' : 'ok'} />
        <Stat label="Who takes the money" value={COLLECT[c.collect].split(',')[0]} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card title={`${c.label} bookings`}>
          {rows.length === 0 ? <p className="text-sm text-slate-500">No {c.label} bookings yet. Add the first one with the form.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-600"><tr><th className="py-2">{c.label} no.</th><th>Guest</th><th>Stay</th><th>Room</th><th className="text-right">Total</th><th className="text-right">Paid</th><th className="whitespace-nowrap text-right">To collect</th><th className="pl-3">Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => { const due = Number(r.charges) - Number(r.paid); return (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="py-2 font-mono"><Link className="underline" href={`/dashboard/folio/${r.id}`}>{r.channel_ref}</Link><div className="font-sans text-[11px] text-slate-400">{r.reference}</div></td>
                      <td className="font-medium">{r.full_name}{r.nationality && <div className="text-xs font-normal text-slate-500">{r.nationality}</div>}</td>
                      <td className="whitespace-nowrap text-xs">{r.check_in}<div>→ {r.check_out}</div><div className="text-slate-500">{r.guests_count} guest(s)</div></td>
                      <td className="text-xs">{r.tname?.en}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{fmt(Number(r.charges))}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{fmt(Number(r.paid))}{Number(r.channel_prepaid_cents) > 0 && <div className="text-[11px] text-slate-500">site {fmt(Number(r.channel_prepaid_cents))}</div>}</td>
                      <td className={`whitespace-nowrap text-right font-semibold tabular-nums ${due > 0 ? 'text-red-800' : 'text-emerald-700'}`}>{due > 0 ? fmt(due) : 'Paid'}</td>
                      <td className="pl-3"><Badge status={r.status} /></td>
                    </tr>); })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={`Add a ${c.label} booking`} id="add">
          <p className="mb-3 rounded-lg bg-cocoa-50 px-3 py-2 text-xs text-cocoa-800">{c.help}</p>
          <form action={otaCreate} className="grid gap-3">
            <input type="hidden" name="channel" value={ch} />
            <div><Lbl htmlFor="o-ref">{c.label} confirmation number *</Lbl><input id="o-ref" name="ref" required dir="ltr" className={Input} /></div>
            <div><Lbl htmlFor="o-name">Guest name *</Lbl><input id="o-name" name="fullName" required className={Input} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Lbl htmlFor="o-nat">Nationality</Lbl><input id="o-nat" name="nationality" className={Input} /></div>
              <div><Lbl htmlFor="o-ph">Phone</Lbl><input id="o-ph" name="phone" dir="ltr" className={Input} /></div>
            </div>
            <div><Lbl htmlFor="o-em">Email</Lbl><input id="o-em" name="email" type="email" dir="ltr" className={Input} /></div>
            <div><Lbl htmlFor="o-rt">Room type *</Lbl>
              <select id="o-rt" name="roomTypeId" required className={Input}>{types.map((t) => <option key={t.id} value={t.id}>{t.name.en} ({t.kind === 'dorm' ? 'per bed' : 'private'})</option>)}</select></div>
            <div><Lbl htmlFor="o-unit">Bed / room (optional, must match the type)</Lbl>
              <select id="o-unit" name="unitId" className={Input} defaultValue=""><option value="">Pick automatically</option>{units.map((x) => <option key={x.id} value={x.id}>{x.kind === 'dorm' ? `${x.room} · ${x.label}` : x.room}</option>)}</select></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Lbl htmlFor="o-ci">Check-in *</Lbl><input id="o-ci" name="checkIn" type="date" required defaultValue={t0} className={Input} /></div>
              <div><Lbl htmlFor="o-co">Check-out *</Lbl><input id="o-co" name="checkOut" type="date" required defaultValue={addDays(t0, 1)} className={Input} /></div>
              <div><Lbl htmlFor="o-g">Guests *</Lbl><input id="o-g" name="guests" type="number" min={1} max={40} defaultValue={1} required className={Input} /></div>
            </div>
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <div><Lbl htmlFor="o-tot">Total price of the stay *</Lbl><input id="o-tot" name="total" required inputMode="decimal" className={Input} /></div>
              <div><Lbl htmlFor="o-cur">Currency</Lbl><select id="o-cur" name="currency" className={Input}><option>EGP</option><option>USD</option><option>EUR</option></select></div>
            </div>
            {c.canPrepay && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="prepaid" /> Paid via {c.label} (the site already charged the guest)</label>}
            {c.collect === 'deposit' && <div><Lbl htmlFor="o-dep">Deposit paid to {c.label} *</Lbl><input id="o-dep" name="deposit" required inputMode="decimal" className={Input} /></div>}
            <div><Lbl htmlFor="o-com">Commission to {c.label} (optional, for reports)</Lbl><input id="o-com" name="commission" inputMode="decimal" className={Input} /></div>
            <div><Lbl htmlFor="o-no">Notes</Lbl><textarea id="o-no" name="notes" rows={2} className={Input} /></div>
            <p className="text-xs text-slate-500">A USD / EUR price is converted to EGP at today's rate. The system checks the bed is free; what is left to pay shows on the guest's account and is taken on the POS.</p>
            <button className={Btn}><Icon name="plus" size={16} /> Save booking</button>
          </form>
        </Card>
      </div>
    </>
  );
}
