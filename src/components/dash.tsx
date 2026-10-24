import Link from 'next/link';
import type { SessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logoutAction } from '@/app/dashboard/actions';
import { navCounts } from '@/services/queries';
import { DashboardAgent } from '@/components/dashboard-agent';
import { Icon } from '@/components/icons';
import { DashNavLink } from '@/components/dash-nav-link';

export * from './dash-ui';

type Count = 'pending' | 'inbox' | 'payments' | 'instapay' | 'arrivals' | 'dirty' | 'lowstock' | 'taxis' | 'tasks' | 'shortages';
type NavItem = { href: string; label: string; perm: string; icon: string; count?: Count; external?: boolean; match?: string[] };
/**
 * One menu entry per job. Related screens are reached as tabs inside the page
 * (Team: roster / attendance / shift tasks; Reports: money / services / activity),
 * and the entry stays highlighted on all of them.
 */
const NAV: [string, NavItem[]][] = [
  ['Front office', [
    { href: '/dashboard', label: 'Today', perm: 'dashboard.view', icon: 'layout-dashboard', count: 'arrivals' },
    { href: '/dashboard/reservations', label: 'Reservations', perm: 'reservation.view', icon: 'bed', count: 'pending', match: ['/dashboard/extensions', '/dashboard/folio'] },
    { href: '/dashboard/ota', label: 'Bookings by source', perm: 'reservation.view', icon: 'globe' },
    { href: '/dashboard/calendar', label: 'Calendar', perm: 'reservation.view', icon: 'calendar-days' },
    { href: '/dashboard/guests', label: 'Guests', perm: 'guest.view', icon: 'users' },
    { href: '/dashboard/housekeeping', label: 'Cleaning', perm: 'frontdesk.use', icon: 'brush', count: 'dirty' },
    { href: '/dashboard/taxi', label: 'Airport taxi', perm: 'frontdesk.use', icon: 'map', count: 'taxis' },
    { href: '/dashboard/inbox', label: 'Guest messages', perm: 'inbox.use', icon: 'inbox', count: 'inbox' },
  ]],
  ['Sales', [
    { href: '/pos', label: 'Point of Sale', perm: 'pos.use', icon: 'shopping-cart', external: true },
    { href: '/dashboard/catalog', label: 'Products & tours', perm: 'inventory.manage', icon: 'package', count: 'lowstock', match: ['/dashboard/tours'] },
    { href: '/dashboard/events', label: 'Events', perm: 'tours.manage', icon: 'ticket' },
  ]],
  ['Money', [
    { href: '/dashboard/shift-reports', label: 'Shifts & cash', perm: 'reports.view', icon: 'receipt', count: 'shortages' },
    { href: '/dashboard/payments', label: 'Payments to check', perm: 'payment.record', icon: 'wallet', count: 'payments' },
  ]],
  ['Team & reports', [
    { href: '/dashboard/staff', label: 'Team', perm: 'staff.view', icon: 'user-plus', match: ['/dashboard/tasks'] },
    { href: '/dashboard/reports', label: 'Reports', perm: 'reports.view', icon: 'bar-chart', match: ['/dashboard/audit'] },
  ]],
  ['Setup', [
    { href: '/dashboard/automation', label: 'Automation', perm: 'automation.manage', icon: 'activity' },
  ]],
];

export async function DashShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const counts: Record<string, number> = await navCounts().catch(() => ({}));
  return (
    <div className="dash min-h-screen bg-cocoa-50 text-cocoa-900 md:flex" style={{ fontFamily: '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", "Almarai", system-ui, sans-serif' }}>
      <aside className="dash-side bg-cocoa-900 text-cocoa-100 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <Link href="/dashboard" aria-label="Dashboard home" className="flex items-center gap-2.5">
            <img src="/assets/logo-240.webp" alt="" width={34} height={36} />
            <span className="leading-tight"><b className="block text-[15px] text-white">Villa Layla</b><span className="block text-[11px] text-cocoa-200">Property management</span></span>
          </Link>
          <Link href="/en" className="inline-flex items-center gap-1 text-xs text-cocoa-200 hover:text-white" target="_blank"><Icon name="globe" size={14} /> Site</Link>
        </div>
        <details className="md:open" open>
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm md:hidden"><Icon name="menu" size={16} /> Menu</summary>
          <nav aria-label="Dashboard" className="px-2 pb-4">
            {NAV.map(([group, items]) => {
              const visible = items.filter((i) => can(user.role, i.perm));
              if (!visible.length) return null;
              return (
                <div key={group} className="mt-3">
                  <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-cocoa-400">{group}</p>
                  {visible.map((i) => (
                    <DashNavLink key={i.href} href={i.href} external={i.external} match={i.match}>
                      <Icon name={i.icon} size={17} />
                      <span className="flex-1">{i.label}</span>
                      {i.external && <Icon name="external-link" size={13} className="opacity-60" />}
                      {i.count && counts[i.count] > 0 && <span className="rounded-full bg-gold-500 px-2 text-xs font-bold text-cocoa-900">{counts[i.count]}</span>}
                    </DashNavLink>
                  ))}
                </div>
              );
            })}
          </nav>
        </details>
        <div className="border-t border-white/10 px-4 py-3 text-sm">
          <p className="font-semibold text-white">{user.name}</p><p className="text-xs capitalize text-cocoa-200">{user.role}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {/* Owner set-up pages (rooms & prices, users, texts) live behind one link, out of the daily menu. */}
            {can(user.role, 'settings.manage') && <Link href="/dashboard/settings" className="inline-flex items-center gap-1.5 text-cocoa-200 hover:text-white"><Icon name="settings" size={15} /> Settings</Link>}
            <form action={logoutAction}><button className="inline-flex items-center gap-1.5 text-cocoa-200 hover:text-white"><Icon name="log-out" size={15} /> Sign out</button></form>
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1 p-4 md:p-8">
        {children}
        <DashboardAgent user={user} />
      </div>
    </div>
  );
}
