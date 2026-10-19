import Link from 'next/link';
import type { SessionUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { logoutAction } from '@/app/dashboard/actions';
import { navCounts } from '@/services/queries';
import { DashboardAgent } from '@/components/dashboard-agent';

export * from './dash-ui';

type NavItem = [href: string, label: string, perm: string, count?: 'pending' | 'inbox' | 'payments' | 'extensions'];
const NAV: [string, NavItem[]][] = [
  ['Front desk', [
    ['/dashboard', 'Today', 'dashboard.view'],
    ['/dashboard/reservations', 'Reservations', 'reservation.view', 'pending'],
    ['/dashboard/calendar', 'Calendar', 'reservation.view'],
    ['/dashboard/inbox', 'Inbox', 'inbox.use', 'inbox']
  ]],
  ['Market & Operations', [
    ['/dashboard/pos', 'Point of Sale (POS)', 'pos.use'],
    ['/dashboard/inventory', 'Inventory & Stock (الجرد)', 'inventory.manage'],
    ['/dashboard/tours', 'Tours & Transfers', 'tours.manage'],
    ['/dashboard/shifts', 'Cash Drawer & Shifts', 'shifts.manage'],
  ]],
  ['Money & stays', [
    ['/dashboard/payments', 'Payments', 'payment.record', 'payments'],
    ['/dashboard/extensions', 'Extensions', 'extension.decide', 'extensions'],
    ['/dashboard/guests', 'Guests', 'guest.view']
  ]],
  ['Setup', [
    ['/dashboard/rooms', 'Rooms & rates', 'inventory.manage'],
    ['/dashboard/automation', 'Automation', 'automation.manage'],
    ['/dashboard/settings', 'Settings', 'settings.manage'],
    ['/dashboard/import', 'Import Excel', 'import.run']
  ]],
  ['Insight', [
    ['/dashboard/reports', 'Financial Reports', 'reports.view'],
    ['/dashboard/reports/services', 'Services Breakdown', 'reports.view'],
    ['/dashboard/audit', 'Activity log', 'audit.view']
  ]],
];

export async function DashShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const counts: Record<string, number> = await navCounts().catch(() => ({}));
  return (
    <div className="min-h-screen bg-[#f3f4f1] text-lapis-900 md:flex" style={{ fontFamily: "'Readex Pro Variable', system-ui, sans-serif" }}>
      <aside className="bg-lapis-800 text-lapis-100 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto">
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <Link href="/dashboard" aria-label="Dashboard home" className="plaque plaque-sm text-center" style={{ boxShadow: 'inset 0 0 0 2px #1e2a4a, inset 0 0 0 3.5px #fff' }}>
            <span className="block text-[15px] leading-tight" style={{ fontFamily: "'El Messiri Variable', sans-serif" }}>Villa Layla</span>
            <span className="block text-[10px] leading-tight opacity-80" style={{ fontFamily: "'El Messiri Variable', sans-serif" }}>فيلا ليلى</span>
          </Link>
          <Link href="/en" className="text-xs text-lapis-200 underline underline-offset-4 hover:text-white">View site</Link>
        </div>
        <details className="md:open" open>
          <summary className="cursor-pointer px-4 py-2 text-sm md:hidden">☰ Menu</summary>
          <nav aria-label="Dashboard" className="px-2 pb-4">
            {NAV.map(([group, items]) => {
              const visible = items.filter(([, , p]) => can(user.role, p));
              if (!visible.length) return null;
              return (
                <div key={group} className="mt-3">
                  <p className="px-3 pb-1 text-xs text-lapis-200/70">{group}</p>
                  {visible.map(([href, label, , c]) => (
                    <Link key={href} href={href} className="flex items-center justify-between rounded-lg px-3 py-1.5 text-sm hover:bg-lapis-600">
                      <span>{label}</span>
                      {c && counts[c] > 0 && <span className="rounded-full bg-bloom-600 px-2 text-xs font-semibold text-white">{counts[c]}</span>}
                    </Link>
                  ))}
                </div>
              );
            })}
          </nav>
        </details>
        <div className="border-t border-lapis-600 px-4 py-3 text-sm">
          <p className="font-medium text-white">{user.name}</p><p className="text-xs capitalize text-lapis-200">{user.role}</p>
          <form action={logoutAction} className="mt-2"><button className="text-lapis-200 underline">Sign out</button></form>
        </div>
      </aside>
      <div className="min-w-0 flex-1 p-4 md:p-8">
        {children}
        <DashboardAgent user={user} />
      </div>
    </div>
  );
}
