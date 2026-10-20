import { requireUser } from '@/lib/auth';
import { PageHeader, Flash, Stat, Pill, HK_LABEL, dt } from '@/components/dash';
import { Icon } from '@/components/icons';
import { roomBoard } from '@/services/pms/frontdesk';
import { fdHousekeeping } from '../pms-actions';

export const dynamic = 'force-dynamic';

const nameOf = (n: any, code: string) => (n && typeof n === 'object' ? n.en || n.ar : n) || code;
const NEXT: Record<string, { to: string; label: string; icon: string }[]> = {
  dirty: [{ to: 'clean', label: 'Mark clean', icon: 'brush' }],
  clean: [{ to: 'inspected', label: 'Inspected', icon: 'check-circle' }, { to: 'dirty', label: 'Dirty', icon: 'alert-triangle' }],
  inspected: [{ to: 'dirty', label: 'Dirty', icon: 'alert-triangle' }],
  out_of_order: [{ to: 'dirty', label: 'Back in service', icon: 'refresh' }],
};

export default async function Housekeeping({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('frontdesk.use');
  const sp = await searchParams;
  const rooms = await roomBoard();
  const filter = sp.show || 'all';
  const shown = rooms.filter((r) => filter === 'all' || (filter === 'occupied' ? r.occupied > 0 : r.hk_status === filter));
  const count = (s: string) => rooms.filter((r) => r.hk_status === s).length;
  const tabs = [['all', 'All rooms', rooms.length], ['dirty', 'Dirty', count('dirty')], ['clean', 'Clean', count('clean')], ['inspected', 'Inspected', count('inspected')], ['occupied', 'Occupied', rooms.filter((r) => r.occupied > 0).length], ['out_of_order', 'Out of order', count('out_of_order')]] as const;

  return (
    <>
      <PageHeader title="Rooms & housekeeping" sub="Checkout and room moves mark rooms dirty automatically. Tap a button when a room is ready." />
      <Flash sp={sp} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="To clean" value={count('dirty')} tone={count('dirty') ? 'due' : 'ok'} />
        <Stat label="Ready" value={count('clean') + count('inspected')} tone="ok" />
        <Stat label="Occupied" value={rooms.filter((r) => r.occupied > 0).length} />
        <Stat label="Out of order" value={count('out_of_order')} tone={count('out_of_order') ? 'warn' : 'default'} />
      </div>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filter rooms">
        {tabs.map(([k, l, n]) => (
          <a key={k} href={`?show=${k}`} aria-current={filter === k ? 'page' : undefined}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === k ? 'border-cocoa-800 bg-cocoa-800 text-white' : 'border-cocoa-200 bg-white text-cocoa-800 hover:border-cocoa-600'}`}>{l} · {n}</a>
        ))}
      </nav>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((r) => {
          const [label, tone] = HK_LABEL[r.hk_status] ?? [r.hk_status, 'slate'];
          const border = r.hk_status === 'dirty' ? 'border-red-300' : r.hk_status === 'out_of_order' ? 'border-slate-300' : 'border-cocoa-200';
          return (
            <article key={r.id} className={`rounded-2xl border-2 ${border} bg-white p-4`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold text-cocoa-800">{r.name}</h3>
                  <p className="text-xs text-slate-500">{nameOf(r.type_name, r.code)}{r.kind === 'dorm' ? ` · ${r.units} beds` : ''}</p>
                </div>
                <Pill tone={tone}>{label}</Pill>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-slate-700">
                <Icon name={r.occupied ? 'user' : 'door-open'} size={16} />
                {r.occupied ? (r.kind === 'dorm' ? `${r.occupied}/${r.units} beds occupied` : 'Occupied') : 'Vacant'}
                {r.blocked && <Pill tone="amber">Blocked</Pill>}
              </p>
              {r.guests && <p className="truncate text-xs text-slate-500">{r.guests}</p>}
              {r.hk_updated_at && <p className="mt-1 text-[11px] text-slate-400">Updated {dt(r.hk_updated_at)}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(NEXT[r.hk_status] ?? []).map((n) => (
                  <form key={n.to} action={fdHousekeeping}>
                    <input type="hidden" name="roomId" value={r.id} /><input type="hidden" name="status" value={n.to} /><input type="hidden" name="back" value={`/dashboard/housekeeping?show=${filter}`} />
                    <button className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold ${n.to === 'clean' || n.to === 'inspected' ? 'bg-emerald-700 text-white hover:bg-emerald-800' : 'border border-cocoa-200 bg-white text-cocoa-800 hover:border-cocoa-600'}`}>
                      <Icon name={n.icon} size={16} /> {n.label}</button>
                  </form>
                ))}
                {r.hk_status !== 'out_of_order' && (
                  <form action={fdHousekeeping}>
                    <input type="hidden" name="roomId" value={r.id} /><input type="hidden" name="status" value="out_of_order" /><input type="hidden" name="back" value={`/dashboard/housekeeping?show=${filter}`} />
                    <button className="min-h-10 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:text-slate-800">Out of order</button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
