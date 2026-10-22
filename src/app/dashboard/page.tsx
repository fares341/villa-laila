import Link from 'next/link';
import { requireUser } from '@/lib/auth';
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
  const u = await requireUser('dashboard.view');
  const sp = await searchParams;
  const c: Record<string, number> = await navCounts().catch(() => ({}) as any);
  const mgr = can(u.role, 'reports.view');
  const todos = [
    { n: c.pending, label: 'booking requests to confirm or reject', href: '/dashboard/reservations?status=pending', icon: 'bed' },
    { n: c.flagged, label: 'requests flagged by a guest rule', href: '/dashboard/reservations?status=pending', icon: 'alert-triangle' },
    { n: c.inbox, label: 'guests waiting in the inbox', href: '/dashboard/inbox', icon: 'message-square' },
    { n: c.instapay, label: 'InstaPay transfers to approve', href: '/dashboard/events', icon: 'ticket' },
    { n: c.payments, label: 'payments to verify', href: '/dashboard/payments', icon: 'wallet' },
    { n: c.extensions, label: 'stay extensions to decide', href: '/dashboard/extensions', icon: 'arrow-left-right' },
    { n: c.taxis, label: 'taxi guests not informed yet', href: '/dashboard/taxi', icon: 'map' },
    { n: c.dirty, label: 'rooms to clean', href: '/dashboard/housekeeping?show=dirty', icon: 'brush' },
    { n: c.lowstock, label: 'items low in stock', href: '/dashboard/catalog', icon: 'package' },
    ...(mgr ? [{ n: c.shortages, label: 'cash shortages to settle', href: '/dashboard/shift-reports?tab=shortages', icon: 'banknote' }] : []),
  ].filter((t) => t.n > 0);
  const tasks = await q<any>(`SELECT * FROM tasks WHERE status='open' ORDER BY COALESCE(due_at, created_at) LIMIT 15`);

  const alerts = (
    <section className={`mb-5 rounded-2xl border p-4 ${todos.length ? 'border-gold-500/40 bg-[#FBF1E2]' : 'border-emerald-200 bg-emerald-50'}`}>
      {todos.length ? (
        <>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-cocoa-800">Needs you now</h2>
          <ul className="flex flex-wrap gap-2">
            {todos.map((t) => (
              <li key={t.label}><Link href={t.href} className="inline-flex items-center gap-2 rounded-full border border-cocoa-200 bg-white px-3 py-1.5 text-sm text-cocoa-800 hover:border-cocoa-600">
                <Icon name={t.icon} size={15} /><b className="text-[#9C4A1E]">{t.n}</b>{t.label}</Link></li>
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
        <Card title={`Alerts & follow-ups (${tasks.length})`} className="mt-6">
          <p className="-mt-1 mb-3 text-xs text-cocoa-500">Drawer differences, refunds, missed shift tasks and channel bookings. The shift checklists themselves are under Team → Shift tasks.</p>
          <ul className="divide-y divide-cocoa-100 text-sm">
            {tasks.map((t: any) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0"><p className="font-semibold text-cocoa-900">{t.title}</p><p className="line-clamp-2 text-xs text-cocoa-600">{t.detail}</p><p className="mt-0.5 text-[11px] text-cocoa-400">{dt(t.created_at)}</p></div>
                <div className="flex shrink-0 items-center gap-2">
                  {t.reservation_id && <Link className="rounded-lg border border-cocoa-200 px-2.5 py-1 text-xs font-semibold text-cocoa-700 hover:border-cocoa-600" href={`/dashboard/folio/${t.reservation_id}`}>Open</Link>}
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
