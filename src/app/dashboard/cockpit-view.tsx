import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q, pool } from '@/lib/db';
import type { Q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, Flash, fmt, Btn, BtnGhost, BtnDanger, Input, Lbl, Stat, Pill, BalancePill } from '@/components/dash';
import { Icon } from '@/components/icons';
import { cockpit } from '@/services/pms/frontdesk';
import { freeUnits } from '@/services/availability';
import { dayRate } from '@/services/pricing';
import { fdCheckIn, fdCheckOut, fdWalkIn } from './pms-actions';

const nameOf = (n: any, code: string) => (n && typeof n === 'object' ? n.en || n.ar : n) || code;

const SB = 'inline-flex items-center gap-1.5 rounded-lg bg-cocoa-800 px-2.5 py-1.5 text-[13px] font-semibold text-white hover:bg-cocoa-900';
const SG = 'inline-flex items-center gap-1.5 rounded-lg border border-cocoa-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-cocoa-800 hover:border-cocoa-600';
const SD = 'inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[13px] font-semibold text-red-800 hover:border-red-400';

function GuestRow({ r, kind, canForce, back }: { r: any; kind: 'arrival' | 'departure' | 'inhouse'; canForce: boolean; back: string }) {
  const nights = Math.round((Date.parse(r.check_out) - Date.parse(r.check_in)) / 864e5);
  return (
    <li className="rounded-xl border border-cocoa-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link href={`/dashboard/folio/${r.id}`} className="block truncate font-bold text-cocoa-800 hover:underline">{r.full_name}</Link>
          <p className="text-xs text-slate-600">
            <span className="font-mono">{r.reference}</span> · {r.rooms || nameOf(r.type_name, '')} · {r.guests_count} pax · {nights} night{nights === 1 ? '' : 's'}
          </p>
          <p className="text-xs text-slate-500">{r.check_in} → {r.check_out}{r.source === 'walk_in' && ' · walk-in'}{r.status === 'pending' && ' · not confirmed yet'}</p>
        </div>
        <BalancePill state={r.state} cents={r.balance} cur={r.currency} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {kind === 'arrival' && (
          <form action={fdCheckIn}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} />
            <button className={SB}><Icon name="log-in" size={15} /> Check in</button></form>
        )}
        {kind !== 'arrival' && (r.balance > 0 ? (
          <>
            <Link href={`/dashboard/folio/${r.id}#pay`} className={SB}><Icon name="wallet" size={15} /> Settle {fmt(r.balance, r.currency)}</Link>
            {kind === 'departure' && canForce && (
              <form action={fdCheckOut}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="force" value="1" /><input type="hidden" name="back" value={back} />
                <button className={SD} title="Manager: check out with an open balance">Check out unpaid</button></form>
            )}
          </>
        ) : (
          <form action={fdCheckOut}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} />
            <button className={kind === 'departure' ? SB : SG}><Icon name="log-out" size={15} /> Check out{kind === 'inhouse' ? ' early' : ''}</button></form>
        ))}
        <Link href={`/dashboard/folio/${r.id}`} className={SG}><Icon name="receipt" size={15} /> Folio</Link>
        {kind !== 'departure' && <Link href={`/dashboard/folio/${r.id}#move`} className={SG}><Icon name="arrow-left-right" size={15} /> Move</Link>}
      </div>
    </li>
  );
}

function Column({ title, icon, rows, kind, empty, canForce, back }: { title: string; icon: string; rows: any[]; kind: 'arrival' | 'departure' | 'inhouse'; empty: string; canForce: boolean; back: string }) {
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-cocoa-200 bg-cocoa-50 p-3">
      <h2 className="mb-2 flex items-center gap-2 px-1 text-base font-bold text-cocoa-800"><Icon name={icon} size={18} /> {title} <span className="ml-auto rounded-full bg-white px-2 text-sm">{rows.length}</span></h2>
      {rows.length ? <ul className="space-y-2">{rows.map((r) => <GuestRow key={r.id} r={r} kind={kind} canForce={canForce} back={back} />)}</ul>
        : <p className="rounded-xl border border-dashed border-cocoa-200 bg-white p-4 text-center text-sm text-slate-500">{empty}</p>}
    </section>
  );
}

/** Arrivals / departures / in house with balances and actions, plus walk-in. Shown on the Today page. */
export async function CockpitView({ sp, alerts }: { sp: Record<string, string | undefined>; alerts?: React.ReactNode }) {
  const u = await requireUser('frontdesk.use');
  const today = todayLocal();
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const back = `/dashboard${date !== today ? `?date=${date}` : ''}`;
  const data = await cockpit(date);
  const canForce = can(u.role, 'reservation.cancel');

  // Walk-in: free rooms/beds tonight, with tonight's Little Hotelier (or local) rate.
  const c = pool() as unknown as Q;
  const types = await q<any>(`SELECT id, code, kind, name FROM room_types WHERE active ORDER BY sort_order, code`);
  const walk = [] as { t: any; rate: any; free: any[] }[];
  for (const t of types) {
    const [rate, free] = await Promise.all([dayRate(c, t.id, today), freeUnits(c, t.id, today, addDays(today, 1))]);
    walk.push({ t, rate, free });
  }
  const dueTotal = [...data.departures, ...data.inhouse].reduce((s, r) => s + Math.max(0, r.balance), 0);
  const dirty = (await q<any>(`SELECT count(*)::int n FROM rooms WHERE active AND hk_status='dirty'`))[0].n;

  return (
    <>
      <PageHeader title={date === today ? 'Today' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))}
        sub={date === today ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(today + 'T12:00:00Z')) + ' · arrivals, departures and guests in house, with live balances' : 'Arrivals, departures and guests in house for this day'}>
        <form className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} className={Input + ' w-40'} aria-label="Date" />
          <button className={BtnGhost}>Go</button>
          {date !== today && <Link href="/dashboard" className={BtnGhost}>Today</Link>}
        </form>
        <Link href="/dashboard/reservations/new" className={BtnGhost}><Icon name="plus" size={16} /> New reservation</Link>
        <a href="#walkin" className={Btn}><Icon name="user-plus" size={16} /> Walk-in</a>
        <a href="/pos" target="_blank" rel="noopener" className={BtnGhost}><Icon name="shopping-cart" size={16} /> Open POS</a>
      </PageHeader>
      <Flash sp={sp} />
      {alerts}

      {/* Counts live in the column headers; one slim line for money and rooms instead of four big tiles. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-cocoa-200 bg-white px-4 py-3 text-sm text-cocoa-700">
        <span>Open balances <b className={`ms-1 text-base tabular-nums ${dueTotal > 0 ? 'text-red-800' : 'text-emerald-700'}`}>{fmt(dueTotal)}</b></span>
        <Link className="inline-flex items-center gap-1.5 hover:underline" href="/dashboard/housekeeping"><Icon name="brush" size={15} /> <b>{dirty}</b> room{dirty === 1 ? '' : 's'} to clean</Link>
        <Link className="inline-flex items-center gap-1.5 hover:underline" href="/print/housekeeping" target="_blank"><Icon name="printer" size={15} /> Housekeeping sheet</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Column title="Arrivals" icon="log-in" rows={data.arrivals} kind="arrival" empty="No arrivals for this day." canForce={canForce} back={back} />
        <Column title="Departures" icon="log-out" rows={data.departures} kind="departure" empty="Nobody is due to leave." canForce={canForce} back={back} />
        <Column title="In house" icon="bed" rows={data.inhouse} kind="inhouse" empty="No guests in house." canForce={canForce} back={back} />
      </div>

      <Card title="Walk-in: check in now" className="mt-6">
        <div id="walkin" className="scroll-mt-24" />
        <p className="mb-4 text-sm text-slate-600">Creates the stay, checks the guest in, marks the room occupied and tells Little Hotelier to stop selling it. Each night is priced at that date’s rate.</p>
        <form action={fdWalkIn} className="grid gap-4 md:grid-cols-6">
          <div className="md:col-span-2"><Lbl htmlFor="w-name">Guest name</Lbl><input id="w-name" name="fullName" required minLength={2} className={Input} /></div>
          <div className="md:col-span-2"><Lbl htmlFor="w-phone">Phone</Lbl><input id="w-phone" name="phone" className={Input} dir="ltr" /></div>
          <div className="md:col-span-2"><Lbl htmlFor="w-nat">Nationality</Lbl><input id="w-nat" name="nationality" className={Input} /></div>
          <div className="md:col-span-4"><Lbl htmlFor="w-unit">Room or bed (free tonight)</Lbl>
            <select id="w-unit" name="unitId" required className={Input}>
              <option value="">Choose…</option>
              {walk.map(({ t, rate, free }) => (
                <optgroup key={t.id} label={`${nameOf(t.name, t.code)} · ${rate ? fmt(rate.cents) + ' tonight' + (rate.source === 'little_hotelier' ? ' (Little Hotelier)' : '') : 'no rate set'}`}>
                  {free.length === 0 ? <option disabled>Full tonight</option> : free.map((f: any) => (
                    <option key={f.id} value={f.id}>{t.kind === 'dorm' ? `${f.room_name} · ${f.label}` : f.room_name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div><Lbl htmlFor="w-n">Nights</Lbl><input id="w-n" name="nights" type="number" min={1} max={60} defaultValue={1} className={Input} /></div>
          <div><Lbl htmlFor="w-g">Guests</Lbl><input id="w-g" name="guests" type="number" min={1} max={12} defaultValue={1} className={Input} /></div>
          <div className="flex items-end md:col-span-6"><button className={Btn}><Icon name="log-in" size={16} /> Check in walk-in</button>
            <span className="ml-3 text-xs text-slate-500">The guest folio opens next so you can take payment.</span></div>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {walk.map(({ t, rate, free }) => (
            <Pill key={t.id} tone={free.length ? 'green' : 'slate'}>{nameOf(t.name, t.code)}: {free.length} free{rate ? ` · ${fmt(rate.cents)}` : ''}</Pill>
          ))}
        </div>
      </Card>
    </>
  );
}
