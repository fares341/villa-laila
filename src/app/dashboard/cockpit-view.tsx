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
import { fdCheckIn, fdCheckOut } from './pms-actions';

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
          <Link href={`/dashboard/reservations/${r.id}`} className="block truncate font-bold text-cocoa-800 hover:underline">{r.full_name}</Link>
          <p className="text-xs text-slate-600">
            <span className="font-mono">{r.reference}</span> · {r.rooms || nameOf(r.type_name, '')} · {r.guests_count} guest{r.guests_count === 1 ? '' : 's'} · {nights} night{nights === 1 ? '' : 's'}
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
            <a href={`/pos?guest=${r.id}`} target="_blank" rel="noopener" className={SB}><Icon name="wallet" size={15} /> Pay on POS · {fmt(r.balance, r.currency)}</a>
            {kind === 'departure' && canForce && (
              <form action={fdCheckOut}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="force" value="1" /><input type="hidden" name="back" value={back} />
                <button className={SD} title="Manager: check out with an open balance">Check out unpaid</button></form>
            )}
          </>
        ) : (
          <form action={fdCheckOut}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="back" value={back} />
            <button className={kind === 'departure' ? SB : SG}><Icon name="log-out" size={15} /> Check out{kind === 'inhouse' ? ' early' : ''}</button></form>
        ))}
        <Link href={`/dashboard/reservations/${r.id}`} className={SG}><Icon name="receipt" size={15} /> Open</Link>
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

  // Free rooms / beds tonight with tonight's price, for walk-ins.
  const c = pool() as unknown as Q;
  const types = await q<any>(`SELECT id, code, kind, name FROM room_types WHERE active ORDER BY sort_order, code`);
  const walk = [] as { t: any; rate: any; free: any[] }[];
  for (const t of types) {
    const [rate, free] = await Promise.all([dayRate(c, t.id, today), freeUnits(c, t.id, today, addDays(today, 1))]);
    walk.push({ t, rate, free });
  }
  const dueTotal = [...data.departures, ...data.inhouse].reduce((s, r) => s + Math.max(0, r.balance), 0);

  return (
    <>
      <PageHeader title={date === today ? 'Today' : new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'))}
        sub={date === today ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(today + 'T12:00:00Z')) + ' · arrivals, departures and guests in house, with live balances' : 'Arrivals, departures and guests in house for this day'}>
        <form className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={date} className={Input + ' w-40'} aria-label="Date" />
          <button className={BtnGhost}>Go</button>
          {date !== today && <Link href="/dashboard" className={BtnGhost}>Today</Link>}
        </form>
        <Link href="/dashboard/ota?ch=website#add" className={BtnGhost}><Icon name="plus" size={16} /> New booking</Link>
        <Link href="/dashboard/ota?ch=walk_in#add" className={Btn}><Icon name="user-plus" size={16} /> Walk-in</Link>
        <a href="/pos" target="_blank" rel="noopener" className={BtnGhost}><Icon name="shopping-cart" size={16} /> Open POS</a>
      </PageHeader>
      <Flash sp={sp} />
      {alerts}

      {/* Counts live in the column headers; one slim line for money and rooms instead of four big tiles. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-cocoa-200 bg-white px-4 py-3 text-sm text-cocoa-700">
        <span>Open balances <b className={`ms-1 text-base tabular-nums ${dueTotal > 0 ? 'text-red-800' : 'text-emerald-700'}`}>{fmt(dueTotal)}</b></span>
        <Link className="inline-flex items-center gap-1.5 hover:underline" href="/print/housekeeping" target="_blank"><Icon name="printer" size={15} /> Print cleaning sheet (Arabic)</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Column title="Arrivals" icon="log-in" rows={data.arrivals} kind="arrival" empty="No arrivals for this day." canForce={canForce} back={back} />
        <Column title="Departures" icon="log-out" rows={data.departures} kind="departure" empty="Nobody is due to leave." canForce={canForce} back={back} />
        <Column title="In house" icon="bed" rows={data.inhouse} kind="inhouse" empty="No guests in house." canForce={canForce} back={back} />
      </div>

      <Card title="Free tonight" className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          {walk.map(({ t, rate, free }) => (
            <Pill key={t.id} tone={free.length ? 'green' : 'slate'}>{nameOf(t.name, t.code)}: {free.length} free{rate ? ` · ${fmt(rate.cents)}` : ''}</Pill>
          ))}
          <Link href="/dashboard/ota?ch=walk_in#add" className={Btn + ' ms-auto'}><Icon name="user-plus" size={16} /> Walk-in: book & check in</Link>
        </div>
      </Card>
    </>
  );
}
