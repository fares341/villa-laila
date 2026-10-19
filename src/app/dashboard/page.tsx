import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { overview, houseView } from '@/services/queries';
import { Card, PageHeader, Flash, fmt, dt, Btn, BtnGhost, Badge } from '@/components/dash';
import { getSetting } from '@/services/settings';
import { completeTaskAction } from './actions';

const nm = (o: any) => o?.en ?? '';
const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(new Date(iso + 'T12:00:00Z'));

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('dashboard.view');
  const sp = await searchParams;
  const [o, hv, cur] = [await overview(), await houseView(), await getSetting<string>('currency')];
  const todos = [
    { n: o.pending, label: 'booking requests to confirm or reject', href: '/dashboard/reservations?status=pending' },
    { n: o.review.b, label: 'guests waiting for reception in the inbox', href: '/dashboard/inbox' },
    { n: o.review.d, label: 'payments to verify', href: '/dashboard/payments' },
    { n: o.review.c, label: 'stay extensions to decide', href: '/dashboard/extensions' },
    { n: o.review.a, label: 'requests flagged by a guest rule', href: '/dashboard/reservations?status=pending' },
  ].filter((t) => t.n > 0);
  const free = o.inv.bookable - o.inv.occupied;

  return (
    <>
      <PageHeader title="Today" sub={new Intl.DateTimeFormat('en-GB', { dateStyle: 'full' }).format(new Date(o.today + 'T12:00:00Z'))}>
        <Link href="/dashboard/calendar" className={BtnGhost}>Calendar</Link>
        <Link href="/dashboard/reservations/new" className={Btn}>New reservation</Link>
      </PageHeader>
      <Flash sp={sp} />

      {/* What needs a person, first */}
      <section className={`mb-6 rounded-2xl p-5 ${todos.length ? 'bg-bloom-50' : 'bg-pool-50'}`}>
        {todos.length ? (
          <>
            <h2 className="text-lg font-semibold text-lapis-800">Needs you now</h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {todos.map((t) => <li key={t.label}><Link href={t.href} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-sm text-lapis-800 hover:ring-2 hover:ring-bloom-600"><b className="text-bloom-700">{t.n}</b>{t.label}</Link></li>)}
            </ul>
          </>
        ) : <p className="font-medium text-pool-800">Nothing is waiting for a person right now.</p>}
      </section>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Arriving today', o.arrivals.length, `${o.arrivals.reduce((s: number, r: any) => s + r.guests_count, 0)} guests`],
          ['Leaving today', o.departures.length, 'check-out by 11:00'],
          ['In the house', o.inHouse.n, `${o.inHouse.res} checked-in booking(s)`],
          ['Free tonight', free, `of ${o.inv.bookable} beds and rooms · ${o.occupancy}% full`],
        ].map(([label, n, hint]) => (
          <div key={label as string} className="rounded-2xl border border-lapis-100 bg-white p-4">
            <p className="text-sm text-lapis-600">{label}</p>
            <p className="mt-1 text-4xl font-semibold text-lapis-800">{n}</p>
            <p className="mt-1 text-xs text-lapis-400">{hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        {/* Tonight, room by room */}
        <Card title="Tonight, room by room">
          <ul className="space-y-2.5">
            {hv.byType.map((t: any) => {
              const pct = t.total ? Math.round((t.booked / t.total) * 100) : 0;
              return (
                <li key={t.id} className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-3 text-sm" title={`${nm(t.name)}: ${t.booked} of ${t.total} ${t.kind === 'dorm' ? 'beds' : 'rooms'} booked`}>
                  <span className="truncate text-lapis-800">{nm(t.name)}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-lapis-50"><span className="block h-full rounded-full bg-lapis-600" style={{ width: `${pct}%` }} /></span>
                  <span className="text-end tabular-nums text-lapis-600">{t.booked}/{t.total} {t.kind === 'dorm' ? 'beds' : ''}</span>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Next 7 nights */}
        <Card title="Next 7 nights">
          <div className="flex h-40 items-end gap-2" role="img" aria-label={`Occupancy next 7 nights: ${hv.week.map((w: any) => `${day(w.day)} ${w.total ? Math.round((w.booked / w.total) * 100) : 0}%`).join(', ')}`}>
            {hv.week.map((w: any) => {
              const pct = w.total ? Math.round((w.booked / w.total) * 100) : 0;
              return (
                <div key={w.day} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${day(w.day)}: ${w.booked} of ${w.total} booked (${pct}%)`}>
                  <span className="text-xs tabular-nums text-lapis-600">{pct}%</span>
                  <span className="w-full rounded-t-[4px] bg-pool-600 group-hover:bg-pool-700" style={{ height: `${Math.max(pct, 2)}%` }} />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2 border-t border-lapis-100 pt-2">{hv.week.map((w: any) => <span key={w.day} className="flex-1 text-center text-xs text-lapis-600">{day(w.day)}</span>)}</div>
          <table className="sr-only"><caption>Occupancy next 7 nights</caption><tbody>{hv.week.map((w: any) => <tr key={w.day}><td>{w.day}</td><td>{w.booked}/{w.total}</td></tr>)}</tbody></table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="New requests" className="lg:col-span-2">
          {hv.recent.length === 0 ? <p className="text-sm text-lapis-400">No pending requests.</p> : (
            <ul className="divide-y divide-lapis-50">
              {hv.recent.map((r: any) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <Link href={`/dashboard/reservations/${r.id}`} className="font-medium text-lapis-800 underline-offset-4 hover:underline">{r.full_name}</Link>
                    <span className="ms-2 text-lapis-400">{r.reference}</span>
                    <p className="text-xs text-lapis-600">{nm(r.tname)}, {r.check_in} → {r.check_out}, {r.guests_count} guest(s), via {r.source}{r.needs_review ? ' · needs a rule check' : ''}</p>
                  </div>
                  <div className="flex items-center gap-2"><Badge status={r.status} /><Link href={`/dashboard/reservations/${r.id}`} className={BtnGhost}>Review</Link></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Arrivals and departures">
          <h3 className="text-sm font-semibold text-lapis-600">Arriving</h3>
          {o.arrivals.length ? <ul className="mt-1 space-y-1 text-sm">{o.arrivals.map((r: any) => <li key={r.id}><Link className="underline" href={`/dashboard/reservations/${r.id}`}>{r.full_name}</Link> <span className="text-lapis-400">{r.guests_count} guest(s)</span></li>)}</ul> : <p className="mt-1 text-sm text-lapis-400">Nobody arriving today.</p>}
          <h3 className="mt-4 text-sm font-semibold text-lapis-600">Leaving</h3>
          {o.departures.length ? <ul className="mt-1 space-y-1 text-sm">{o.departures.map((r: any) => <li key={r.id}><Link className="underline" href={`/dashboard/reservations/${r.id}`}>{r.full_name}</Link></li>)}</ul> : <p className="mt-1 text-sm text-lapis-400">Nobody leaving today.</p>}
          <p className="mt-4 border-t border-lapis-50 pt-3 text-sm text-lapis-600">Outstanding balances: <b className="text-lapis-800">{fmt(o.outstanding.n, cur)}</b> <span className="text-xs">({o.outstanding.c} booking(s), verified payments only)</span></p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Open tasks">
          {o.tasks.length === 0 ? <p className="text-sm text-lapis-400">All caught up.</p> : <ul className="divide-y divide-lapis-50 text-sm">{o.tasks.map((t: any) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-2"><div><p className="font-medium">{t.title}</p><p className="line-clamp-2 text-xs text-lapis-400">{t.detail}</p></div>
              <div className="flex shrink-0 gap-3">{t.reservation_id && <Link className="text-lapis-600 underline" href={`/dashboard/reservations/${t.reservation_id}`}>Open</Link>}{t.conversation_id && <Link className="text-lapis-600 underline" href={`/dashboard/inbox/${t.conversation_id}`}>Open</Link>}
                <form action={completeTaskAction}><input type="hidden" name="id" value={t.id} /><button className="text-lapis-600 underline">Done</button></form></div></li>))}</ul>}
        </Card>
        <Card title="Automatic follow-ups coming up">
          {o.followups.length === 0 ? <p className="text-sm text-lapis-400">None scheduled.</p> : <ul className="space-y-1 text-sm">{o.followups.map((f: any, i: number) => <li key={i} className="flex justify-between gap-3"><span className="capitalize">{f.kind.replace(/_/g, ' ')}</span><span className="text-lapis-400">{dt(f.run_at)}</span></li>)}</ul>}
          <Link href="/dashboard/automation" className="mt-3 inline-block text-sm text-lapis-600 underline">Manage automation</Link>
        </Card>
      </div>
    </>
  );
}
