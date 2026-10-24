import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q, pool } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, Flash, Input, Lbl, Btn, Badge, fmt, SubTabs, Stat } from '@/components/dash';
import { Icon } from '@/components/icons';
import { CHANNELS, listOta, otaCounts, type ChannelKey } from '@/services/ota-bookings';
import { otaCreate, siteLinkSave } from './actions';
import { BookingFields } from './booking-fields';
import { getLinks, latestPrices, type SiteKey } from '@/services/site-prices';
import { getSetting } from '@/services/settings';
import { dayRate } from '@/services/pricing';

export const dynamic = 'force-dynamic';
const ORDER: ChannelKey[] = ['booking_com', 'airbnb', 'hostelworld', 'expedia_collect', 'expedia_hotel', 'agoda', 'website', 'walk_in'];
const PARAMS: Partial<Record<ChannelKey, 'booking_com' | 'airbnb' | 'hostelworld' | 'expedia' | 'agoda'>> = { booking_com: 'booking_com', airbnb: 'airbnb', hostelworld: 'hostelworld', expedia_collect: 'expedia', expedia_hotel: 'expedia', agoda: 'agoda' };
const COLLECT: Record<string, string> = { property: 'Pays at the hostel', channel: 'Paid to the site', deposit: 'Deposit to the site, rest at the hostel' };

/** One section per booking site. Reception types each booking in; the money left to pay is collected on the POS. */
export default async function OtaBookings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('reservation.view');
  const sp = await searchParams;
  const ch: ChannelKey = ORDER.includes(sp.ch as ChannelKey) ? (sp.ch as ChannelKey) : 'booking_com';
  const c = CHANNELS[ch];
  const site = !c.direct;
  const [rows, counts, types, units, lhLast, lhIssues, busy, links, prices, priceStatus] = await Promise.all([
    listOta(ch), otaCounts(),
    q<any>(`SELECT id, name, kind FROM room_types WHERE active ORDER BY sort_order`),
    q<any>(`SELECT u.id, u.label, u.capacity, rm.name room, rm.room_type_id, t.kind FROM units u JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id WHERE u.active AND rm.active ORDER BY rm.name, u.label`),
    q<any>(`SELECT at, ok, found, message FROM lh_runs ORDER BY at DESC LIMIT 1`).catch(() => []),
    q<any>(`SELECT data->>'ref' ref, data->>'guest' guest, data->>'channel' channel, data->>'checkIn' check_in, status, detail FROM lh_seen WHERE status IN ('error','dry_run') AND last_seen > now() - interval '1 day' ORDER BY last_seen DESC LIMIT 20`).catch(() => []),
    // Who sits on each bed (next 400 days), so the form shows which beds are free for the chosen nights.
    q<any>(`SELECT ru.unit_id, lower(ru.during)::text s, upper(ru.during)::text e, g.full_name || ' · ' || r.reference who FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id JOIN guests g ON g.id=r.guest_id
            WHERE ru.active AND r.status IN ('hold','pending','confirmed','checked_in') AND upper(ru.during) > current_date AND lower(ru.during) < current_date + 400
            UNION ALL SELECT unit_id, lower(during)::text, upper(during)::text, 'Blocked: ' || COALESCE(reason,'maintenance') FROM unit_blocks WHERE upper(during) > current_date`),
    getLinks(), site ? latestPrices(ch) : Promise.resolve([]), getSetting<any>('site_prices_status').catch(() => null),
  ]);
  const link = site ? links[ch as SiteKey] : undefined;
  // Our own rate tonight per room type, next to the site's price.
  const ours = site ? await Promise.all(types.map(async (t: any) => ({ name: t.name.en, kind: t.kind, cents: (await dayRate(pool() as any, t.id, todayLocal()).catch(() => null))?.cents ?? null }))) : [];
  const lh = lhLast[0];
  const t0 = todayLocal();
  const upcoming = rows.filter((r) => ['pending', 'confirmed', 'checked_in'].includes(r.status) && r.check_out >= t0);
  const dueTotal = upcoming.reduce((a, r) => a + Math.max(0, Number(r.charges) - Number(r.paid)), 0);
  const value = upcoming.reduce((a, r) => a + Number(r.charges), 0);
  const tabs = ORDER.map((k) => ({ href: `/dashboard/ota?ch=${k}`, label: CHANNELS[k].label, count: counts[k] }));

  return (
    <>
      <PageHeader title="Bookings by source" sub="Each booking goes in the section it came from: a booking site, our website or a walk-in. It lands on the calendar on the bed you pick, and in Reservations. Every amount still to pay is collected on the POS." />
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
          {rows.length === 0 ? <p className="text-sm text-slate-500">No {c.label} bookings yet.{ch === 'website' ? ' Bookings made on the website show here by themselves.' : ' Add the first one with the form.'}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-600"><tr><th className="py-2">{c.direct ? 'Booking' : `${c.label} no.`}</th><th>Guest</th><th>Stay</th><th>Room / bed</th><th className="text-right">Total</th><th className="text-right">Paid</th><th className="whitespace-nowrap text-right">To collect</th><th className="pl-3">Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => { const due = Number(r.charges) - Number(r.paid); return (
                    <tr key={r.id} className="border-t border-slate-100 align-top">
                      <td className="py-2 font-mono"><Link className="underline" href={`/dashboard/reservations/${r.id}`}>{r.channel_ref || r.reference}</Link>{r.channel_ref && <div className="font-sans text-[11px] text-slate-400">{r.reference}</div>}<div className="font-sans text-[11px]"><Link className="text-lapis-700 underline" href={`/dashboard/folio/${r.id}`}>Account</Link></div></td>
                      <td className="font-medium">{r.full_name}{r.nationality && <div className="text-xs font-normal text-slate-500">{r.nationality}</div>}</td>
                      <td className="whitespace-nowrap text-xs">{r.check_in}<div>→ {r.check_out}</div><div className="text-slate-500">{r.guests_count} guest(s)</div></td>
                      <td className="text-xs">{r.beds ?? r.tname?.en}</td>
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

        <div className="space-y-5">
        {site && (
          <Card title={`Price now on ${c.label.replace(/ (Hotel )?Collect$/, '')}`}>
            {prices.length > 0 ? (
              <table className="mb-3 w-full text-sm">
                <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Night</th><th>Room on the site</th><th className="text-right">Price</th></tr></thead>
                <tbody>{prices.map((p: any, i: number) => <tr key={i} className="border-t border-slate-100"><td className="py-1 text-xs">{p.stay_date === t0 ? 'Tonight' : p.stay_date}</td><td className="text-xs">{p.room}</td><td className="whitespace-nowrap text-right tabular-nums">{fmt(Number(p.price_cents), p.currency)}</td></tr>)}</tbody>
              </table>
            ) : <p className="mb-3 text-sm text-slate-500">{link ? 'Prices are read from the link once an hour by the reader service. None read yet.' : `Save the link of our ${c.label.replace(/ (Hotel )?Collect$/, '')} page to see its current price here.`}</p>}
            {prices[0] && <p className="mb-3 text-[11px] text-slate-400">Read {new Date(prices[0].checked_at).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' })}. Prices for 1 guest, 1 night.{priceStatus?.results?.some((r: string) => r.startsWith(ch === 'expedia_hotel' ? 'expedia_collect' : ch) && !/rooms$/.test(r)) ? ' The last read had a problem; open the link to check.' : ''}</p>}
            <details className="mb-3 text-sm"><summary className="cursor-pointer font-semibold text-slate-700">Our rates tonight</summary>
              <ul className="mt-1 space-y-0.5 text-xs">{ours.map((o, i) => <li key={i} className="flex justify-between"><span>{o.name} ({o.kind === 'dorm' ? 'per bed' : 'room'})</span><span className="tabular-nums">{o.cents == null ? '—' : fmt(o.cents)}</span></li>)}</ul>
            </details>
            <form action={siteLinkSave} className="grid gap-2">
              <input type="hidden" name="channel" value={ch} />
              <Lbl htmlFor="o-link">Link to our page on {c.label.replace(/ (Hotel )?Collect$/, '')}</Lbl>
              <input id="o-link" name="url" type="url" dir="ltr" defaultValue={link ?? ''} placeholder="https://…" className={Input} />
              <div className="flex flex-wrap gap-2">
                <button className={Btn}>Save link</button>
                {link && <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-lapis-700 underline"><Icon name="external-link" size={14} /> Open</a>}
              </div>
            </form>
          </Card>
        )}
        <Card title={c.direct ? (ch === 'walk_in' ? 'New walk-in' : 'Add a direct booking') : `Add a ${c.label} booking`} id="add">
          <p className="mb-3 rounded-lg bg-cocoa-50 px-3 py-2 text-xs text-cocoa-800">{c.help}</p>
          <form action={otaCreate} className="grid gap-3">
            <input type="hidden" name="channel" value={ch} />
            {!c.direct && <div><Lbl htmlFor="o-ref">{c.label} confirmation number *</Lbl><input id="o-ref" name="ref" required dir="ltr" className={Input} /></div>}
            <div><Lbl htmlFor="o-name">Guest name *</Lbl><input id="o-name" name="fullName" required className={Input} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Lbl htmlFor="o-nat">Nationality</Lbl><input id="o-nat" name="nationality" className={Input} /></div>
              <div><Lbl htmlFor="o-ph">Phone{c.direct ? ' *' : ''}</Lbl><input id="o-ph" name="phone" dir="ltr" required={c.direct} className={Input} /></div>
            </div>
            <div><Lbl htmlFor="o-em">Email</Lbl><input id="o-em" name="email" type="email" dir="ltr" className={Input} /></div>
            <BookingFields types={types.map((t: any) => ({ id: t.id, name: t.name.en, kind: t.kind }))} units={units} busy={busy} today={t0}
              siteLabel={site ? c.label.replace(/ (Hotel )?Collect$/, '') : undefined} siteLink={link ?? null} siteParams={PARAMS[ch] ?? null} />
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <div><Lbl htmlFor="o-tot">{c.direct ? 'Agreed price for the whole stay (empty = our rates)' : `Price of the stay on ${c.label} *`}</Lbl><input id="o-tot" name="total" required={!c.direct} inputMode="decimal" className={Input} /></div>
              <div><Lbl htmlFor="o-cur">Currency</Lbl><select id="o-cur" name="currency" className={Input}><option>EGP</option><option>USD</option><option>EUR</option></select></div>
            </div>
            {c.canPayAtHostel && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="payAtHostel" /> Guest pays at the hostel (not paid to {c.label})</label>}
            {c.canPrepay && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="prepaid" /> Paid via {c.label} (the site already charged the guest)</label>}
            {c.collect === 'deposit' && <div><Lbl htmlFor="o-dep">Deposit paid to {c.label} *</Lbl><input id="o-dep" name="deposit" required inputMode="decimal" className={Input} /></div>}
            {!c.direct && <div><Lbl htmlFor="o-com">Commission to {c.label} (optional, for reports)</Lbl><input id="o-com" name="commission" inputMode="decimal" className={Input} /></div>}
            <div><Lbl htmlFor="o-no">Notes</Lbl><textarea id="o-no" name="notes" rows={2} className={Input} /></div>
            <p className="text-xs text-slate-500">A USD / EUR price is converted to EGP at today&apos;s rate. What is left to pay shows on the guest&apos;s account and is taken on the POS.{ch === 'walk_in' ? ' Arriving today = checked in at once.' : ''}</p>
            <button className={Btn}><Icon name="plus" size={16} /> {ch === 'walk_in' ? 'Save and check in' : 'Save booking'}</button>
          </form>
        </Card>

        </div>
      </div>
    </>
  );
}
