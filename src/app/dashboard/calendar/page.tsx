import { Fragment } from 'react';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { calendarData } from '@/services/queries';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, STATUS_LABEL, BtnGhost, Btn } from '@/components/dash';
import { Icon } from '@/components/icons';

const COLORS: Record<string, string> = { hold: 'bg-purple-200 text-purple-950', pending: 'bg-amber-200 text-amber-950', confirmed: 'bg-emerald-300 text-emerald-950', checked_in: 'bg-sky-300 text-sky-950', checked_out: 'bg-slate-300 text-slate-800' };
// Where the booking came from, shown at the start of each bar.
const SRC: Record<string, string> = { booking_com: 'B.com', airbnb: 'Airbnb', hostelworld: 'HW', expedia: 'Expedia', agoda: 'Agoda', website: 'Web', walk_in: 'Walk-in', staff: 'Desk', telegram: 'Bot', import: 'Import', channel: 'LH' };
const dow = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('reservation.view');
  const sp = await searchParams;
  const today = todayLocal();
  const view = sp.view === 'day' ? 'day' : sp.view === 'month' ? 'month' : 'week';
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : view === 'month' ? today.slice(0, 8) + '01' : today;
  const days = view === 'day' ? 1 : view === 'week' ? 7 : 31;
  const { units, alloc, blocks } = await calendarData(from, days);
  const cols = Array.from({ length: days }, (_, i) => addDays(from, i));
  const step = view === 'day' ? 1 : view === 'week' ? 7 : 30;
  const nav = (f: string, v = view) => `/dashboard/calendar?view=${v}&from=${f}`;

  // Group units into rooms
  const groups = new Map<string, any[]>();
  for (const u of units) { const key = u.kind === 'private' ? 'Private rooms' : u.tname.en; groups.set(key, [...(groups.get(key) ?? []), u]); }

  const arrivals = alloc.filter((a) => a.s >= from && a.s < addDays(from, days));
  return (
    <>
      <PageHeader title="Calendar" sub="Each column is a night. Click a booking to open it, or an empty cell to start a new one on that bed.">
        <Link className={view === 'day' ? Btn : BtnGhost} href={nav(today, 'day')}>Day</Link>
        <Link className={view === 'week' ? Btn : BtnGhost} href={nav(today, 'week')}>Week</Link>
        <Link className={view === 'month' ? Btn : BtnGhost} href={nav(today.slice(0, 8) + '01', 'month')}>Month</Link>
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link className={BtnGhost} href={nav(addDays(from, -step))}>← Earlier</Link>
        <Link className={BtnGhost} href={nav(view === 'month' ? today.slice(0, 8) + '01' : today)}>Today</Link>
        <Link className={BtnGhost} href={nav(addDays(from, step))}>Later →</Link>
        <span className="ms-2 font-medium">{from} → {addDays(from, days - 1)}</span>
        <span className="ms-auto flex flex-wrap gap-2 text-xs">{Object.entries(COLORS).map(([k, c]) => <span key={k} className={`rounded px-2 py-0.5 ${c}`}>{STATUS_LABEL[k]}</span>)}<span className="rounded bg-slate-500 px-2 py-0.5 text-white">Maintenance</span></span>
      </div>
      {units.length === 0 ? <p className="rounded-xl border border-dashed bg-white p-8 text-center text-slate-600">No rooms yet. Add rooms and beds in <Link className="underline" href="/dashboard/rooms">Rooms & rates</Link>.</p> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full table-fixed border-collapse text-xs" style={{ minWidth: view === 'day' ? 400 : 160 + days * (view === 'month' ? 34 : 90) }}>
            <thead><tr><th className="sticky left-0 z-10 w-40 min-w-40 border-b bg-slate-50 px-2 py-2 text-left">Bed / room</th>
              {cols.map((c) => <th key={c} className={`border-b border-l px-1 py-2 text-center font-medium ${c === today ? 'bg-lapis-100' : 'bg-slate-50'} ${['Fri', 'Sat'].includes(dow(c)) ? 'text-slate-500' : ''}`}><div>{view === 'month' ? c.slice(8) : c.slice(5)}</div><div className="text-[10px] font-normal text-slate-500">{dow(c)}</div></th>)}</tr></thead>
            <tbody>
              {[...groups.entries()].map(([g, us]) => (
                <Fragment key={g}>
                  <tr><td colSpan={days + 1} className="bg-slate-100 px-2 py-1 font-semibold text-slate-700">{g}</td></tr>
                  {us.map((u) => {
                    const mine = alloc.filter((a) => a.unit_id === u.id), blk = blocks.filter((b) => b.unit_id === u.id);
                    const cells: React.ReactNode[] = [];
                    for (let i = 0; i < days;) {
                      const day = cols[i];
                      const a = mine.find((x) => x.s <= day && day < x.e);
                      const b = blk.find((x) => x.s <= day && day < x.e);
                      if (a) {
                        const span = Math.min(days - i, Math.round((Date.parse(a.e) - Date.parse(day)) / 86400000));
                        cells.push(<td key={i} colSpan={span} className="border-l p-0.5"><Link href={`/dashboard/reservations/${a.rid}`} title={`${a.reference}${a.channel_ref ? ` (${SRC[a.source] ?? a.source} ${a.channel_ref})` : ''} · ${a.full_name} · ${STATUS_LABEL[a.status]} · ${SRC[a.source] ?? a.source}`} className={`block truncate rounded px-1.5 py-1.5 ${COLORS[a.status] ?? 'bg-slate-200'} hover:ring-2 hover:ring-lapis-600`}><span className="me-1 rounded bg-white/60 px-1 text-[10px] font-semibold">{SRC[a.source] ?? a.source}</span>{a.full_name} · {a.guests_count}</Link></td>);
                        i += span;
                      } else if (b) {
                        const span = Math.min(days - i, Math.round((Date.parse(b.e) - Date.parse(day)) / 86400000));
                        cells.push(<td key={i} colSpan={span} className="border-l p-0.5"><div title={b.reason ?? 'Maintenance'} className="truncate rounded bg-slate-500 px-1.5 py-1.5 text-white"><Icon name="lock" size={12} className="me-1 inline-block align-[-1px]" />{b.reason ?? 'Blocked'}</div></td>);
                        i += span;
                      } else {
                        cells.push(<td key={i} className={`border-l p-0 ${day === today ? 'bg-lapis-50' : ''}`}><Link aria-label={`New booking on ${u.label} from ${day}`} href={`/dashboard/reservations/new?unit=${u.id}&checkIn=${day}&checkOut=${addDays(day, 1)}`} className="block h-8 hover:bg-emerald-50" /></td>);
                        i += 1;
                      }
                    }
                    return <tr key={u.id} className="border-t"><th scope="row" className="sticky left-0 z-10 border-r bg-white px-2 py-1 text-left font-medium">{u.label}{u.capacity > 1 ? <span className="text-slate-400"> ·{u.capacity}p</span> : null}</th>{cells}</tr>;
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>)}
      {view === 'day' && (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Arriving {from}</h2>{arrivals.length ? <ul className="mt-2 text-sm">{arrivals.map((a) => <li key={a.rid + a.unit_id}><Link className="underline" href={`/dashboard/reservations/${a.rid}`}>{a.full_name}</Link> · {a.reference}</li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No arrivals.</p>}</div>
          <div className="rounded-xl border bg-white p-4"><h2 className="font-semibold">Leaving {from}</h2>{(await calendarData(addDays(from, -30), 31)).alloc.filter((a: any) => a.e === from).length ? <ul className="mt-2 text-sm">{(await calendarData(addDays(from, -30), 31)).alloc.filter((a: any) => a.e === from).map((a: any) => <li key={a.rid + a.unit_id}><Link className="underline" href={`/dashboard/reservations/${a.rid}`}>{a.full_name}</Link> · {a.reference}</li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No departures.</p>}</div>
        </div>)}
    </>
  );
}
