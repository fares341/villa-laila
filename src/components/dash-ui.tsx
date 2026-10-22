import { Icon } from './icons';
import React from 'react';

export const STATUS_STYLE: Record<string, string> = {
  hold: 'bg-purple-100 text-purple-900',
  pending: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-emerald-100 text-emerald-900',
  checked_in: 'bg-sky-100 text-sky-900',
  checked_out: 'bg-slate-200 text-slate-800',
  cancelled: 'bg-red-100 text-red-900',
  rejected: 'bg-red-100 text-red-900',
  expired: 'bg-slate-200 text-slate-700',
  no_show: 'bg-orange-100 text-orange-900',
};

export const STATUS_LABEL: Record<string, string> = {
  hold: 'Temporary hold',
  pending: 'Pending request',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
  expired: 'Expired',
  no_show: 'No-show',
};

export const Badge = ({ status }: { status: string }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] ?? 'bg-slate-100'}`}>
    {STATUS_LABEL[status] ?? status}
  </span>
);

const PAY_STYLE: Record<string, string> = {
  unpaid: 'bg-red-100 text-red-900',
  partial: 'bg-amber-100 text-amber-900',
  paid: 'bg-emerald-100 text-emerald-900',
  overpaid: 'bg-purple-100 text-purple-900',
};

export const PayBadge = ({ state, awaiting }: { state: string; awaiting?: boolean }) => (
  <span className="inline-flex flex-col gap-0.5">
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${PAY_STYLE[state]}`}>
      {state === 'unpaid' ? 'Unpaid' : state === 'partial' ? 'Part paid' : state === 'paid' ? 'Paid' : 'Overpaid'}
    </span>
    {awaiting && <span className="text-[11px] text-amber-800">payment awaiting check</span>}
  </span>
);

export const fmt = (cents: number, cur = 'EGP') =>
  `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${cur}`;

export const dt = (v: string | Date | null) =>
  v ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }).format(new Date(v)) : '—';

export function Flash({ sp }: { sp: Record<string, string | undefined> }) {
  if (sp.ok) return <p role="status" className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-emerald-900"><Icon name="check-circle" size={18} /> {sp.ok}</p>;
  if (sp.err) return <p role="alert" className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-red-900"><Icon name="alert-triangle" size={18} /> {sp.err}</p>;
  return null;
}

export const PageHeader = ({ title, children, sub }: { title: string; sub?: string; children?: React.ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-[28px] font-extrabold tracking-tight text-cocoa-800">
        {title}
      </h1>
      {sub && <p className="mt-1 text-sm text-slate-600">{sub}</p>}
    </div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-600">
    {children}
  </div>
);

export const Card = ({ title, children, className = '', id }: { title?: string; children: React.ReactNode; className?: string; id?: string }) => (
  <section id={id} className={`rounded-2xl border border-cocoa-200 bg-white p-5 shadow-[0_1px_2px_rgba(81,64,47,.06)] ${className}`}>
    {title && <h2 className="mb-3 text-lg font-bold text-cocoa-800">{title}</h2>}
    {children}
  </section>
);

export const Btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-cocoa-800 px-4 py-2 text-sm font-semibold text-white hover:bg-cocoa-600 disabled:opacity-50';
export const BtnGhost = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-cocoa-200 bg-white px-4 py-2 text-sm font-semibold text-cocoa-800 hover:border-cocoa-600 hover:bg-cocoa-50';
export const BtnDanger = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800';
export const Input = 'w-full rounded-lg border border-cocoa-200 bg-white px-3 py-2 text-sm focus:border-cocoa-600 focus:outline-none';
export const Lbl = ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
  <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
    {children}
  </label>
);

export const Stat = ({ label, value, tone = 'default', hint }: { label: string; value: React.ReactNode; tone?: 'default' | 'due' | 'ok' | 'credit' | 'warn'; hint?: React.ReactNode }) => {
  const c = { default: 'text-cocoa-800', due: 'text-red-700', ok: 'text-emerald-700', credit: 'text-sky-700', warn: 'text-amber-700' }[tone];
  return (
    <div className="rounded-2xl border border-cocoa-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${c}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
};

export const Pill = ({ tone = 'slate', children }: { tone?: 'slate' | 'red' | 'green' | 'blue' | 'amber' | 'cocoa'; children: React.ReactNode }) => {
  const c = { slate: 'bg-slate-100 text-slate-700', red: 'bg-red-100 text-red-800', green: 'bg-emerald-100 text-emerald-800', blue: 'bg-sky-100 text-sky-800', amber: 'bg-amber-100 text-amber-900', cocoa: 'bg-cocoa-100 text-cocoa-800' }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${c}`}>{children}</span>;
};

export const BalancePill = ({ state, cents, cur = 'EGP' }: { state: 'due' | 'settled' | 'credit'; cents: number; cur?: string }) =>
  state === 'due' ? <Pill tone="red">Balance due {fmt(cents, cur)}</Pill>
  : state === 'credit' ? <Pill tone="blue">Credit {fmt(-cents, cur)}</Pill>
  : <Pill tone="green">Fully settled</Pill>;

export const HK_LABEL: Record<string, [string, 'green' | 'red' | 'blue' | 'slate']> = {
  clean: ['Clean', 'green'], dirty: ['Dirty', 'red'], inspected: ['Inspected', 'blue'], out_of_order: ['Out of order', 'slate'],
};

/** Tabs between closely related pages, so the side menu stays short. */
export const SubTabs = ({ tabs, current }: { tabs: { href: string; label: string; icon?: string; count?: number }[]; current: string }) => (
  <nav className="mb-5 flex flex-wrap gap-1 rounded-2xl border border-cocoa-200 bg-white p-1" aria-label="Sections">
    {tabs.map((t) => (
      <a key={t.href} href={t.href} aria-current={current === t.href ? 'page' : undefined}
        className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold ${current === t.href ? 'bg-cocoa-800 text-white' : 'text-cocoa-800 hover:bg-cocoa-50'}`}>
        {t.icon && <Icon name={t.icon} size={15} />}{t.label}
        {t.count ? <span className={`rounded-full px-1.5 text-xs ${current === t.href ? 'bg-white/20' : 'bg-gold-500 text-cocoa-900'}`}>{t.count}</span> : null}
      </a>
    ))}
  </nav>
);

export const TEAM_TABS = [
  { href: '/dashboard/staff', label: 'Staff & roster', icon: 'calendar-days' },
  { href: '/dashboard/staff/timesheet', label: 'Attendance & hours', icon: 'clock' },
  { href: '/dashboard/tasks', label: 'Shift tasks', icon: 'clipboard-list' },
];
export const REPORT_TABS = [
  { href: '/dashboard/reports', label: 'Occupancy & money', icon: 'bar-chart' },
  { href: '/dashboard/reports/services', label: 'Sales by service', icon: 'shopping-cart' },
  { href: '/dashboard/audit', label: 'Activity log', icon: 'file-text' },
];
