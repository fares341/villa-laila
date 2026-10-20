import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, Flash, fmt, Btn, BtnGhost, Input, Lbl, Pill, Stat } from '@/components/dash';
import { Icon } from '@/components/icons';
import { listStaff, shiftTypes, rosterRange, onShiftNow } from '@/services/pms/staff';
import { staffSave, rosterSaveWeek } from '../pms-actions';

export const dynamic = 'force-dynamic';

const mondayOf = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; return addDays(iso, -wd); };
const SHIFT_TONE: Record<string, string> = { MORNING: 'bg-amber-50 border-amber-200', EVENING: 'bg-sky-50 border-sky-200', NIGHT: 'bg-indigo-50 border-indigo-200', OFF: 'bg-slate-50 border-slate-200' };

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('staff.view');
  const sp = await searchParams;
  const manage = can(u.role, 'staff.manage');
  const today = todayLocal();
  const monday = mondayOf(sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const [staff, types, roster, onShift] = await Promise.all([listStaff(), shiftTypes(), rosterRange(monday, days[6]), onShiftNow()]);
  const cell = new Map(roster.map((r: any) => [`${r.staff_id}|${r.work_date}`, r]));
  const edit = sp.edit ? staff.find((s) => s.id === sp.edit) : null;
  const active = staff.filter((s) => s.active);
  const back = `/dashboard/staff?week=${monday}`;
  const dayFmt = (d: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(d + 'T12:00:00Z'));

  return (
    <>
      <PageHeader title="Staff & roster" sub="Profiles, POS PINs and the weekly schedule. Lateness is measured against this roster when staff clock in on the POS.">
        <Link href="/dashboard/staff/timesheet" className={BtnGhost}><Icon name="clock" size={16} /> Attendance & hours</Link>
        {manage && <a href="#profile" className={Btn}><Icon name="user-plus" size={16} /> Add staff</a>}
      </PageHeader>
      <Flash sp={sp} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active staff" value={active.length} />
        <Stat label="On shift now" value={onShift.length} hint={onShift.map((a: any) => a.full_name).join(', ') || 'Nobody clocked in'} />
        <Stat label="Without a PIN" value={active.filter((s) => !s.has_pin).length} tone={active.some((s) => !s.has_pin) ? 'warn' : 'ok'} hint="Needed to use the POS" />
        <Stat label="Managers" value={active.filter((s) => s.is_manager).length} hint="Can approve comps and expenses" />
      </div>

      <Card title="Weekly roster" className="mb-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Link href={`/dashboard/staff?week=${addDays(monday, -7)}`} className={BtnGhost} aria-label="Previous week"><Icon name="chevron-left" size={16} /></Link>
          <span className="font-semibold text-cocoa-800">{dayFmt(monday)} – {dayFmt(days[6])}</span>
          <Link href={`/dashboard/staff?week=${addDays(monday, 7)}`} className={BtnGhost} aria-label="Next week"><Icon name="chevron-right" size={16} /></Link>
          {monday !== mondayOf(today) && <Link href="/dashboard/staff" className={BtnGhost}>This week</Link>}
          <span className="ml-auto text-xs text-slate-500">{types.filter((t) => !t.is_off).map((t) => `${t.label} ${t.start_time}–${t.end_time}`).join(' · ')}</span>
        </div>
        {active.length === 0 ? <p className="text-sm text-slate-500">Add staff below to build the roster.</p> : (
          <form action={rosterSaveWeek}>
            <input type="hidden" name="back" value={back} /><input type="hidden" name="monday" value={monday} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead><tr className="text-left text-slate-500"><th className="py-2 pr-2">Staff</th>{days.map((d) => <th key={d} className={`px-1 ${d === today ? 'text-cocoa-800' : ''}`}>{dayFmt(d)}</th>)}</tr></thead>
                <tbody>
                  {active.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="py-2 pr-2"><b className="text-cocoa-800">{s.full_name}</b><div className="text-xs text-slate-500">{s.role}</div></td>
                      {days.map((d) => {
                        const r: any = cell.get(`${s.id}|${d}`);
                        const v = r?.shift_code ?? '';
                        return (
                          <td key={d} className="px-1 py-1">
                            <input type="hidden" name={`p|${s.id}|${d}`} value={v} />
                            <select name={`r|${s.id}|${d}`} defaultValue={v} disabled={!manage} aria-label={`${s.full_name} ${d}`}
                              className={`w-full rounded-lg border px-1.5 py-1.5 text-xs font-semibold ${SHIFT_TONE[v] ?? 'border-dashed border-slate-300 bg-white text-slate-400'}`}>
                              <option value="">—</option>
                              {types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {manage && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={Btn}><Icon name="check" size={16} /> Save week</button>
                <button name="copy" value="1" className={BtnGhost}><Icon name="refresh" size={16} /> Save and repeat for next 3 weeks</button>
                <span className="self-center text-xs text-slate-500">Repeating only fills empty days, so changes you made later are kept.</span>
              </div>
            )}
          </form>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Team" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">Name</th><th>Role</th><th>Target</th><th>Hourly</th><th>Day rate</th><th>Access</th><th /></tr></thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id} className={`border-t border-slate-100 ${s.active ? '' : 'opacity-50'}`}>
                    <td className="py-2"><b>{s.full_name}</b><div className="text-xs text-slate-500" dir="ltr">{s.phone}</div></td>
                    <td>{s.role}</td>
                    <td className="tabular-nums">{s.monthly_target_hours} h</td>
                    <td className="tabular-nums">{fmt(s.hourly_rate_cents)}</td>
                    <td className="tabular-nums">{fmt(s.daily_rate_cents)}</td>
                    <td className="space-x-1">{s.is_manager && <Pill tone="cocoa">Manager</Pill>}{s.can_use_pos && (s.has_pin ? <Pill tone="green">POS PIN set</Pill> : <Pill tone="amber">No PIN</Pill>)}{!s.active && <Pill>Inactive</Pill>}</td>
                    <td>{manage && <Link href={`/dashboard/staff?week=${monday}&edit=${s.id}#profile`} className="text-sm font-semibold text-cocoa-600 underline">Edit</Link>}</td>
                  </tr>
                ))}
                {staff.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">No staff yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        {manage && (
          <Card title={edit ? `Edit ${edit.full_name}` : 'Add staff member'}>
            <div id="profile" className="scroll-mt-24" />
            <form action={staffSave} className="space-y-3" key={edit?.id ?? 'new'}>
              {edit && <input type="hidden" name="id" value={edit.id} />}
              <div><Lbl htmlFor="s-n">Full name</Lbl><input id="s-n" name="fullName" required defaultValue={edit?.full_name} className={Input} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Lbl htmlFor="s-r">Role</Lbl><input id="s-r" name="role" list="roles" defaultValue={edit?.role ?? 'Receptionist'} className={Input} />
                  <datalist id="roles"><option value="Receptionist" /><option value="Night auditor" /><option value="Housekeeping" /><option value="Manager" /><option value="Kitchen" /></datalist></div>
                <div><Lbl htmlFor="s-p">Phone</Lbl><input id="s-p" name="phone" dir="ltr" defaultValue={edit?.phone ?? ''} className={Input} /></div>
              </div>
              <div><Lbl htmlFor="s-pin">{edit?.has_pin ? 'New POS PIN (leave empty to keep)' : 'POS PIN (4–6 digits)'}</Lbl>
                <input id="s-pin" name="pin" inputMode="numeric" pattern="\d{4,6}" maxLength={6} autoComplete="new-password" className={Input + ' tracking-[.4em]'} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Lbl htmlFor="s-t">Target h / month</Lbl><input id="s-t" name="target" type="number" min={0} defaultValue={edit?.monthly_target_hours ?? 208} className={Input} /></div>
                <div><Lbl htmlFor="s-h">Hourly (EGP)</Lbl><input id="s-h" name="hourly" type="number" min={0} step="0.01" defaultValue={edit ? edit.hourly_rate_cents / 100 : ''} className={Input} /></div>
                <div><Lbl htmlFor="s-d">Day rate (EGP)</Lbl><input id="s-d" name="daily" type="number" min={0} step="0.01" defaultValue={edit ? edit.daily_rate_cents / 100 : ''} className={Input} /></div>
              </div>
              <p className="text-xs text-slate-500">Day rate is used when the lateness policy deducts quarter / half / full days (set on Attendance &amp; hours).</p>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="canUsePos" defaultChecked={edit?.can_use_pos ?? true} /> Uses the POS</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="isManager" defaultChecked={edit?.is_manager ?? false} /> Manager (approvals)</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={edit?.active ?? true} /> Active</label>
              </div>
              <div className="flex gap-2"><button className={Btn}>{edit ? 'Save changes' : 'Add staff'}</button>{edit && <Link href={`/dashboard/staff?week=${monday}`} className={BtnGhost}>Cancel</Link>}</div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
