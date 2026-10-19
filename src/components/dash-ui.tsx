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
  if (sp.ok) return <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-emerald-900">✓ {sp.ok}</p>;
  if (sp.err) return <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-red-900">✕ {sp.err}</p>;
  return null;
}

export const PageHeader = ({ title, children, sub }: { title: string; sub?: string; children?: React.ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="text-3xl font-semibold text-lapis-800" style={{ fontFamily: "'El Messiri Variable', sans-serif" }}>
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

export const Card = ({ title, children, className = '' }: { title?: string; children: React.ReactNode; className?: string }) => (
  <section className={`rounded-2xl border border-lapis-100 bg-white p-5 ${className}`}>
    {title && <h2 className="mb-3 text-lg font-semibold text-lapis-800">{title}</h2>}
    {children}
  </section>
);

export const Btn = 'inline-flex items-center justify-center rounded-lg bg-lapis-800 px-4 py-2 text-sm font-semibold text-white hover:bg-lapis-600';
export const BtnGhost = 'inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50';
export const BtnDanger = 'inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800';
export const Input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
export const Lbl = ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
  <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
    {children}
  </label>
);
