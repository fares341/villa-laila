import Link from 'next/link';
import { requireUser, currentUser } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { navCounts } from '@/services/queries';
import { Card, dt } from '@/components/dash';
import { Icon } from '@/components/icons';
import { CockpitView } from './cockpit-view';
import { completeTaskAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Today: everything waiting for a person (one line each, linking to where it is done),
 * then arrivals / departures / in house with their balances, then open tasks.
 */
export default async function Today({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  // Event managers only work on events: their home is the Events page.
  if ((await currentUser())?.role === 'event_manager') redirect('/dashboard/events');
  const u = await requireUser('dashboard.view');
  const sp = await searchParams;
  const c: Record<string, number> = await navCounts().catch(() => ({}) as any);
  const mgr = can(u.role, 'reports.view');
  const todos = [
    { n: c.pending, one: 'booking request to confirm or refuse', many: 'booking requests to confirm or refuse', href: '/dashboard/reservations?status=pending', icon: 'bed' },
    { n: c.inbox, one: 'guest waiting in the inbox', many: 'guests waiting in the inbox', href: '/dashboard/inbox', icon: 'message-square' },
    { n: c.payments, one: 'InstaPay / Vodafone Cash receipt to check', many: 'InstaPay / Vodafone Cash receipts to check', href: '/dashboard/payments', icon: 'wallet' },
    { n: c.extensions, one: 'stay extension to decide', many: 'stay extensions to decide', href: '/dashboard/extensions', icon: 'arrow-left-right' },
    { n: c.taxis, one: 'taxi guest not told yet', many: 'taxi guests not told yet', href: '/dashboard/taxi', icon: 'map' },
    { n: c.dirty, one: 'room to clean', many: 'rooms to clean', href: '/dashboard/housekeeping?show=dirty', icon: 'brush' },
    { n: c.keys, one: 'room with a key missing', many: 'rooms with a key missing', href: '/dashboard/housekeeping?show=keys', icon: 'key' },
    { n: c.lowstock, one: 'item low in stock', many: 'items low in stock', href: '/dashboard/catalog', icon: 'package' },
    ...(mgr ? [{ n: c.shortages, one: 'cash shortage to settle', many: 'cash shortages to settle', href: '/dashboard/shift-reports?tab=shortages', icon: 'banknote' }] : []),
  ].filter((t) => t.n > 0);
  // Drawer and staff-discipline follow-ups are for managers; reception sees the rest.
  const tasks = await q<any>(`SELECT * FROM tasks WHERE status='open' AND ($1 OR kind NOT IN ('payment','general') OR reservation_id IS NOT NULL) ORDER BY COALESCE(due_at, created_at) LIMIT 15`, [mgr]);

  const alerts = (
    <section className={`mb-5 rounded-2xl border p-4 ${todos.length ? 'border-gold-500/40 bg-[#FBF1E2]' : 'border-emerald-200 bg-emerald-50'}`}>
      {todos.length ? (
        <>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-cocoa-800">Needs you now</h2>
          <ul className="flex flex-wrap gap-2">
            {todos.map((t) => (
              <li key={t.one}><Link href={t.href} className="inline-flex items-center gap-2 rounded-full border border-cocoa-200 bg-white px-3 py-1.5 text-sm text-cocoa-800 hover:border-cocoa-600">
                <Icon name={t.icon} size={15} /><b className="text-[#9C4A1E]">{t.n}</b>{t.n === 1 ? t.one : t.many}</Link></li>
            ))}
          </ul>
        </>
      ) : <p className="flex items-center gap-2 font-medium text-emerald-800"><Icon name="check-circle" size={18} /> Nothing is waiting for a person right now.</p>}
    </section>
  );

  return (
    <>
      <CockpitView sp={sp} alerts={alerts} />
      {tasks.length > 0 && (
        <Card title={`Follow-ups (${tasks.length})`} className="mt-6">
          <p className="-mt-1 mb-3 text-xs text-cocoa-500">Things someone has to look at: drawer differences, refunds, missed shift tasks, bookings to check. The shift checklists are under Team → Shift tasks.</p>
          <ul className="divide-y divide-cocoa-100 text-sm">
            {tasks.map((t: any) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0"><p className="font-semibold text-cocoa-900">{t.title}</p><p className="line-clamp-2 text-xs text-cocoa-600">{t.detail}</p><p className="mt-0.5 text-[11px] text-cocoa-400">{dt(t.created_at)}</p></div>
                <div className="flex shrink-0 items-center gap-2">
                  {t.reservation_id && <Link className="rounded-lg border border-cocoa-200 px-2.5 py-1 text-xs font-semibold text-cocoa-700 hover:border-cocoa-600" href={`/dashboard/reservations/${t.reservation_id}`}>Open</Link>}
                  {t.conversation_id && <Link className="rounded-lg border border-cocoa-200 px-2.5 py-1 text-xs font-semibold text-cocoa-700 hover:border-cocoa-600" href={`/dashboard/inbox/${t.conversation_id}`}>Open</Link>}
                  <form action={completeTaskAction}><input type="hidden" name="id" value={t.id} /><button className="rounded-lg bg-cocoa-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-cocoa-900">Done</button></form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
