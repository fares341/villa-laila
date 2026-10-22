import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { todayLocal } from '@/lib/dates';
import { getSetting } from '@/services/settings';
import { PageHeader, Card, Flash, dt, Btn, BtnGhost, Input, Lbl, Pill, Stat } from '@/components/dash';
import { Icon } from '@/components/icons';
import { syncCurrentRun, runView, handoverText, taskStats, kindLabel, onDuty } from '@/services/pms/tasks';
import { taskTemplateSave, taskRedistribute, taskReassign, taskSettingsSave } from '../pms-actions';

export const dynamic = 'force-dynamic';

const KINDS: [string, string][] = [['check', 'Checklist'], ['money', 'Drawer check (whoever receives the drawer)'], ['unpaid', 'Unpaid guests (automatic list)'], ['washes', 'Washes (automatic list)'], ['tours', 'Tours (automatic list)'], ['taxi', 'Taxis (automatic list)']];

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('staff.view');
  const sp = await searchParams;
  const manage = can(u.role, 'staff.manage');
  const cur = await syncCurrentRun();
  const today = todayLocal();
  const [runs, templates, shiftTypes, stats, setting, staffNow] = await Promise.all([
    q<any>(`SELECT r.*, st.label FROM shift_task_runs r JOIN shift_types st ON st.code=r.shift_code WHERE r.work_date >= $1::date - 1 ORDER BY r.work_date DESC, st.sort_order DESC LIMIT 4`, [today]),
    q<any>(`SELECT * FROM shift_task_templates ORDER BY active DESC, sort_order, title`),
    q<any>(`SELECT code, label FROM shift_types WHERE NOT is_off ORDER BY sort_order`),
    taskStats(today.slice(0, 7)),
    getSetting<any>('shift_tasks').catch(() => null),
    onDuty(),
  ]);
  const runId = sp.run || cur?.run.id || runs[0]?.id;
  const view = runId ? await runView(runId) : null;
  const handover = view ? await handoverText(view.run.id) : '';
  const edit = sp.edit === 'new' ? ({} as any) : templates.find((t) => t.id === sp.edit);
  const byPerson = new Map<string, any[]>();
  for (const t of view?.tasks ?? []) { const k = t.assignee ?? 'Unassigned'; byPerson.set(k, [...(byPerson.get(k) ?? []), t]); }
  const done = view ? view.tasks.filter((t: any) => t.status === 'done').length : 0;

  return (
    <>
      <PageHeader title="Shift tasks" sub="The same checklist every shift, shared at random between the staff clocked in on the POS, balanced by the time each task takes.">
        {manage && <a href="?edit=new#templates" className={Btn}><Icon name="plus" size={16} /> Add task</a>}
      </PageHeader>
      <Flash sp={sp} />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Shift now" value={cur ? cur.shift.label : 'None'} hint={cur ? `Last-hour tasks ${cur.run.distributed_at ? 'shared at ' + dt(cur.run.distributed_at) : 'shared at ' + dt(cur.shareAt)}` : undefined} />
        <Stat label="Clocked in" value={staffNow.length} hint={staffNow.map((s: any) => s.full_name).join(', ') || 'Nobody'} />
        <Stat label="Done this shift" value={view ? `${done}/${view.tasks.length}` : '—'} tone={view && done === view.tasks.length ? 'ok' : 'default'} />
        <Stat label="Start-of-shift tasks" value={`+${setting?.distribute_after_minutes ?? 15} min`} hint="last-hour tasks: 60 min before the end" />
      </div>

      {runs.length > 1 && (
        <nav className="mb-4 flex flex-wrap gap-2">
          {runs.map((r) => (
            <a key={r.id} href={`?run=${r.id}`} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${r.id === runId ? 'border-cocoa-800 bg-cocoa-800 text-white' : 'border-cocoa-200 bg-white text-cocoa-800'}`}>
              {r.label} · {r.work_date}</a>
          ))}
        </nav>
      )}

      {view && (
        <div className="mb-6 grid gap-5 xl:grid-cols-3">
          <Card title={`${view.run.label} · ${view.run.work_date}`} className="xl:col-span-2">
            {!view.run.distributed_at && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Not shared yet. It happens automatically after the grace period, or share now.</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {[...byPerson.entries()].map(([who, list]) => (
                <div key={who} className="rounded-xl border border-cocoa-200 p-3">
                  <p className="mb-2 flex items-center justify-between font-bold text-cocoa-800"><span>{who}</span>
                    <span className="text-xs font-semibold text-slate-500">{list.filter((t) => t.status === 'done').length}/{list.length} · {list.reduce((s, t) => s + t.minutes, 0)} min</span></p>
                  <ul className="space-y-1.5 text-sm">
                    {list.map((t) => (
                      <li key={t.id} className="flex items-center gap-2">
                        <Icon name={t.status === 'done' ? 'check-circle' : 'clipboard-list'} size={16} className={t.status === 'done' ? 'text-emerald-700' : 'text-slate-400'} />
                        <span className="flex-1">{t.title}{t.note && <span className="block text-xs text-slate-500">{t.note}</span>}</span>
                        {manage && t.status === 'pending' && (
                          <form action={taskReassign} className="flex items-center gap-1">
                            <input type="hidden" name="taskId" value={t.id} />
                            <select name="staffId" defaultValue={t.assigned_to ?? ''} className="rounded-md border border-cocoa-200 px-1 py-0.5 text-xs" aria-label={`Move ${t.title}`}>
                              <option value="">Unassigned</option>
                              {staffNow.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                            </select>
                            <button className="text-xs font-semibold text-cocoa-600 underline">Move</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {manage && (
              <form action={taskRedistribute} className="mt-4"><input type="hidden" name="runId" value={view.run.id} />
                <button className={BtnGhost}><Icon name="refresh" size={16} /> Share open tasks again</button>
                <span className="ml-2 text-xs text-slate-500">Tasks someone already started stay with them.</span></form>
            )}
          </Card>
          <Card title="Handover report">
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-lg bg-cocoa-50 p-3 font-sans text-sm text-cocoa-900">{handover}</pre>
            <p className="mt-2 text-xs text-slate-500">Staff copy this from the POS (Tasks → Handover report) into the team WhatsApp group.</p>
          </Card>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Checklist (same every shift)" className="xl:col-span-2">
          <div id="templates" className="scroll-mt-24" />
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="py-2">Task</th><th>Items</th><th>When</th><th>Shifts</th><th className="text-right">Minutes</th><th /></tr></thead>
            <tbody>{templates.map((t) => (
              <tr key={t.id} className={`border-t border-slate-100 ${t.active ? '' : 'opacity-50'}`}>
                <td className="py-2"><b>{t.title}</b><div className="text-xs text-slate-500">{kindLabel(t.kind)}</div></td>
                <td className="text-xs">{(t.items as string[]).join(', ') || '—'}</td>
                <td className="text-xs">{t.kind === 'money' ? 'Drawer handover' : t.phase === 'start' ? 'Start of shift' : 'Last hour'}</td>
                <td className="text-xs">{(t.shift_codes as string[]).map((c) => shiftTypes.find((s) => s.code === c)?.label ?? c).join(', ')}</td>
                <td className="text-right tabular-nums">{t.minutes}</td>
                <td className="text-right">{manage && <a href={`?edit=${t.id}#templates`} className="font-semibold text-cocoa-600 underline">Edit</a>}</td>
              </tr>))}</tbody>
          </table>
        </Card>
        <div className="space-y-5">
          {manage && edit && (
            <Card title={edit.id ? `Edit: ${edit.title}` : 'New task'}>
              <form action={taskTemplateSave} className="space-y-3" key={edit.id ?? 'new'}>
                {edit.id && <input type="hidden" name="id" value={edit.id} />}
                <div><Lbl htmlFor="tt">Task</Lbl><input id="tt" name="title" required defaultValue={edit.title} className={Input} /></div>
                <div><Lbl htmlFor="tk">Type</Lbl><select id="tk" name="kind" defaultValue={edit.kind ?? 'check'} className={Input}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                <div><Lbl htmlFor="tp">When</Lbl><select id="tp" name="phase" defaultValue={edit.phase ?? 'last_hour'} className={Input}><option value="last_hour">Last hour before handover</option><option value="start">Start of the shift</option></select></div>
                <div><Lbl htmlFor="ti">Items to tick (one per line, optional)</Lbl><textarea id="ti" name="items" rows={3} defaultValue={(edit.items ?? []).join('\n')} className={Input} /></div>
                <fieldset><legend className="mb-1 text-sm font-medium text-slate-700">Shifts</legend>
                  <div className="flex flex-wrap gap-3 text-sm">{shiftTypes.map((s) => <label key={s.code} className="flex items-center gap-1.5"><input type="checkbox" name="shifts" value={s.code} defaultChecked={!edit.shift_codes || edit.shift_codes.includes(s.code)} /> {s.label}</label>)}</div>
                </fieldset>
                <div className="grid grid-cols-2 gap-2">
                  <div><Lbl htmlFor="tm">Minutes</Lbl><input id="tm" name="minutes" type="number" min={1} max={480} defaultValue={edit.minutes ?? 10} className={Input} /></div>
                  <div><Lbl htmlFor="ts">Order</Lbl><input id="ts" name="sort" type="number" defaultValue={edit.sort_order ?? templates.length + 1} className={Input} /></div>
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={edit.active ?? true} /> Active</label>
                <div className="flex gap-2"><button className={Btn}>Save</button><a href="/dashboard/tasks" className={BtnGhost}>Close</a></div>
              </form>
            </Card>
          )}
          <Card title={`This month by person`}>
            <ul className="space-y-1.5 text-sm">
              {stats.map((s) => <li key={s.id} className="flex items-center justify-between"><span>{s.full_name}</span><span className="flex gap-1"><Pill tone="green">{s.done} done</Pill>{s.missed > 0 && <Pill tone="red">{s.missed} missed</Pill>}</span></li>)}
              {stats.length === 0 && <li className="text-slate-500">No tasks yet this month.</li>}
            </ul>
          </Card>
          {manage && (
            <Card title="Sharing">
              <form action={taskSettingsSave} className="flex items-end gap-2">
                <div className="flex-1"><Lbl htmlFor="ta">Share start-of-shift tasks this many minutes after the shift starts</Lbl><input id="ta" name="after" type="number" min={0} max={120} defaultValue={setting?.distribute_after_minutes ?? 15} className={Input} /></div>
                <button className={BtnGhost}>Save</button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
