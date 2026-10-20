import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { todayLocal } from '@/lib/dates';
import { PageHeader, Card, Flash, fmt, dt, Btn, BtnGhost, Input, Lbl, Pill, Stat } from '@/components/dash';
import { Icon } from '@/components/icons';
import { monthlyTimesheet, attendanceList, latenessPolicy } from '@/services/pms/staff';
import { attendanceWaive, latenessPolicySave } from '../../pms-actions';

export const dynamic = 'force-dynamic';

const TIER: Record<number, [string, 'green' | 'amber' | 'red' | 'slate']> = { 0: ['On time', 'green'], 1: ['Tier 1', 'amber'], 2: ['Tier 2', 'amber'], 3: ['Tier 3', 'red'] };
const h = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-US')} h`;

export default async function Timesheet({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('staff.view');
  const sp = await searchParams;
  const manage = can(u.role, 'staff.manage');
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : todayLocal().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const [sheet, att, policy] = await Promise.all([monthlyTimesheet(month), attendanceList(`${month}-01`, last, sp.staff || undefined), latenessPolicy()]);
  const totals = sheet.reduce((a, r) => ({ worked: a.worked + r.worked_hours, late: a.late + r.late_minutes, ded: a.ded + Number(r.deductions_cents) }), { worked: 0, late: 0, ded: 0 });
  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`));
  const back = `/dashboard/staff/timesheet?month=${month}${sp.staff ? `&staff=${sp.staff}` : ''}`;
  const time = (v: any) => (v ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: process.env.HOSTEL_TZ || 'Africa/Cairo' }).format(new Date(v)) : '—');

  return (
    <>
      <PageHeader title="Attendance & hours" sub="Clock-ins from the POS, measured against the roster to the millisecond. Deductions follow the lateness policy below.">
        <Link href={`?month=${prev}`} className={BtnGhost} aria-label="Previous month"><Icon name="chevron-left" size={16} /></Link>
        <span className="self-center font-semibold text-cocoa-800">{monthName}</span>
        <Link href={`?month=${next}`} className={BtnGhost} aria-label="Next month"><Icon name="chevron-right" size={16} /></Link>
        <Link href="/dashboard/staff" className={BtnGhost}><Icon name="calendar-days" size={16} /> Roster</Link>
      </PageHeader>
      <Flash sp={sp} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Hours worked" value={h(totals.worked)} />
        <Stat label="Late minutes" value={totals.late} tone={totals.late ? 'warn' : 'ok'} />
        <Stat label="Deductions" value={fmt(totals.ded)} tone={totals.ded ? 'due' : 'ok'} />
        <Stat label="Grace period" value={`${policy.grace_minutes} min`} hint={policy.mode === 'fixed' ? 'Fixed EGP deductions' : 'Day-fraction deductions'} />
      </div>

      <Card title={`Monthly timesheet · ${monthName}`} className="mb-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-2">Staff</th><th className="text-right">Target</th><th className="text-right">Scheduled</th><th className="text-right">Worked</th><th className="text-right">Variance</th><th className="text-right">Shifts</th><th className="text-right">Late</th><th className="text-right">Late min</th><th className="text-right">Deductions</th><th /></tr></thead>
            <tbody>
              {sheet.map((r) => {
                const v = r.worked_hours - r.target_hours;
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2"><b>{r.full_name}</b><div className="text-xs text-slate-500">{r.role}{r.open_now ? ' · on shift now' : ''}</div></td>
                    <td className="text-right tabular-nums">{h(r.target_hours)}</td>
                    <td className="text-right tabular-nums">{h(r.scheduled_hours)}</td>
                    <td className="text-right font-semibold tabular-nums">{h(r.worked_hours)}</td>
                    <td className={`text-right tabular-nums ${v < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{v >= 0 ? '+' : ''}{h(v)}</td>
                    <td className="text-right tabular-nums">{r.shifts_worked}</td>
                    <td className="text-right tabular-nums">{r.late_count}</td>
                    <td className="text-right tabular-nums">{r.late_minutes}</td>
                    <td className="text-right tabular-nums">{fmt(Number(r.deductions_cents))}{Number(r.waived_cents) > 0 && <div className="text-xs text-slate-500">{fmt(Number(r.waived_cents))} waived</div>}</td>
                    <td><Link href={`?month=${month}&staff=${r.id}#log`} className="text-xs font-semibold text-cocoa-600 underline">Log</Link></td>
                  </tr>
                );
              })}
              {sheet.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-slate-500">No staff yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={sp.staff ? `Clock-in log · ${sheet.find((s) => s.id === sp.staff)?.full_name ?? ''}` : 'Clock-in log'} className="mb-6">
        <div id="log" className="scroll-mt-24" />
        {sp.staff && <Link href={`?month=${month}#log`} className="mb-3 inline-block text-sm underline">Show everyone</Link>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-2">Date</th><th>Staff</th><th>Shift</th><th>Scheduled</th><th>Clock in</th><th>Clock out</th><th className="text-right">Delay</th><th>Tier</th><th className="text-right">Deduction</th><th /></tr></thead>
            <tbody>
              {att.map((a) => {
                const [tl, tt] = TIER[a.tier] ?? ['—', 'slate'];
                const ms = Number(a.delay_ms);
                return (
                  <tr key={a.id} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap py-2 tabular-nums">{a.work_date}</td>
                    <td>{a.full_name}</td>
                    <td>{a.shift_code ?? <span className="text-slate-400">Not rostered</span>}</td>
                    <td className="tabular-nums">{time(a.scheduled_start)}</td>
                    <td className="tabular-nums">{time(a.clock_in_at)}</td>
                    <td className="tabular-nums">{a.clock_out_at ? time(a.clock_out_at) : <Pill tone="green">On shift</Pill>}</td>
                    <td className="text-right tabular-nums" title={`${ms.toLocaleString('en-US')} ms`}>{ms > 0 ? `${a.delay_minutes} min ${Math.floor((ms % 60000) / 1000)} s` : '—'}</td>
                    <td><Pill tone={tt}>{tl}</Pill></td>
                    <td className="text-right tabular-nums">{a.waived ? <span className="text-slate-400 line-through">{fmt(Number(a.deduction_cents))}</span> : fmt(Number(a.deduction_cents))}
                      {a.waived && <div className="text-xs text-slate-500">Waived by {a.waived_by_name ?? 'manager'}: {a.waive_reason}</div>}</td>
                    <td>
                      {manage && !a.waived && a.tier > 0 && (
                        <details className="relative">
                          <summary className="cursor-pointer list-none text-xs font-semibold text-cocoa-600 underline">Waive</summary>
                          <form action={attendanceWaive} className="absolute right-0 z-10 mt-1 w-64 rounded-xl border border-cocoa-200 bg-white p-3 shadow-lg">
                            <input type="hidden" name="id" value={a.id} /><input type="hidden" name="back" value={back} />
                            <Lbl>Reason (required, audited)</Lbl>
                            <input name="reason" required minLength={3} className={Input} placeholder="e.g. Metro breakdown, approved" />
                            <button className={Btn + ' mt-2 w-full'}>Waive deduction</button>
                          </form>
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
              {att.length === 0 && <tr><td colSpan={10} className="py-6 text-center text-slate-500">No clock-ins this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Lateness policy">
        <div id="policy" className="scroll-mt-24" />
        <ul className="mb-4 space-y-1 text-sm text-slate-700">
          <li><Pill tone="green">0 – {policy.grace_minutes} min</Pill> Grace period, no deduction.</li>
          <li><Pill tone="amber">Tier 1 · {policy.grace_minutes + 1}–30 min</Pill> {policy.mode === 'fixed' ? fmt(policy.tiers[0]?.fixed_cents ?? 0) : 'Quarter day'}</li>
          <li><Pill tone="amber">Tier 2 · 31–60 min</Pill> {policy.mode === 'fixed' ? fmt(policy.tiers[1]?.fixed_cents ?? 0) : 'Half day'}</li>
          <li><Pill tone="red">Tier 3 · over 60 min</Pill> Full day, and managers get an alert.</li>
        </ul>
        {manage && (
          <form action={latenessPolicySave} className="grid gap-3 sm:grid-cols-4">
            <div><Lbl htmlFor="lp-g">Grace minutes</Lbl><input id="lp-g" name="grace" type="number" min={0} max={30} defaultValue={policy.grace_minutes} className={Input} /></div>
            <div><Lbl htmlFor="lp-m">Tiers 1–2 deduct</Lbl>
              <select id="lp-m" name="mode" defaultValue={policy.mode} className={Input}><option value="fixed">Fixed EGP amounts</option><option value="fraction">Quarter / half day</option></select></div>
            <div><Lbl htmlFor="lp-1">Tier 1 amount (EGP)</Lbl><input id="lp-1" name="t1" type="number" min={0} defaultValue={(policy.tiers[0]?.fixed_cents ?? 5000) / 100} className={Input} /></div>
            <div><Lbl htmlFor="lp-2">Tier 2 amount (EGP)</Lbl><input id="lp-2" name="t2" type="number" min={0} defaultValue={(policy.tiers[1]?.fixed_cents ?? 10000) / 100} className={Input} /></div>
            <div className="sm:col-span-4"><button className={BtnGhost}>Save policy</button></div>
          </form>
        )}
      </Card>
    </>
  );
}
