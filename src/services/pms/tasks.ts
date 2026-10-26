import { randomInt } from 'node:crypto';
import { q, tx } from '@/lib/db';
import { todayLocal, addDays, zonedToUtc } from '@/lib/dates';
import { getSetting } from '../settings';
import { audit } from '../audit';
import { BookingError } from '../errors';
import { getFolio } from './folio';
import { notifyStaff } from '../conversations';

/**
 * Shift tasks. The same checklist every shift; each shift it is shared out at random between the staff who are
 * clocked in, balanced by the minutes each task takes, and avoiding giving someone the task they had last time.
 * Distribution happens once the grace period after the shift start has passed (so on-time arrivals all count),
 * and is self-healing: latecomers pick up untouched tasks, and tasks of someone who clocked out are shared again.
 */

export type TaskItem = { label: string; done: boolean };
export type ShiftWin = { code: string; label: string; workDate: string; start: Date; end: Date };

const KIND_LABEL: Record<string, string> = { money: 'Drawer handover', unpaid: 'Unpaid list', washes: 'Washes list', tours: 'Tours list', taxi: 'Taxi list', check: 'Checklist', taxi_confirm: 'Taxi confirmation', tour_booking: 'Tour car booking' };
export const taskKinds = KIND_LABEL;

async function coreTypes() {
  return q<any>(`SELECT code, label, start_time, end_time FROM shift_types WHERE NOT is_off AND core AND start_time IS NOT NULL ORDER BY sort_order`);
}
const win = (t: any, day: string): ShiftWin => {
  const start = zonedToUtc(day, t.start_time);
  let end = zonedToUtc(day, t.end_time || t.start_time);
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { code: t.code, label: t.label, workDate: day, start, end };
};

/** Core shifts running at `now` (two of them during the 15:30–16:30 overlap). `lead` widens the start, e.g. someone opening early. */
export async function activeShifts(now = new Date(), leadMin = 0): Promise<ShiftWin[]> {
  const types = await coreTypes();
  const today = todayLocal(now);
  const out: ShiftWin[] = [];
  for (const day of [addDays(today, -1), today, addDays(today, 1)]) for (const t of types) {
    const w = win(t, day);
    if (now.getTime() >= w.start.getTime() - leadMin * 60000 && now < w.end) out.push(w);
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}
export async function currentShift(now = new Date()): Promise<ShiftWin | null> {
  const a = await activeShifts(now);
  return a[a.length - 1] ?? null;
}
export async function shiftWindow(code: string, workDate: string): Promise<ShiftWin | null> {
  const t = (await coreTypes()).find((x) => x.code === code);
  return t ? win(t, workDate) : null;
}

async function graceMinutes() {
  const s = await getSetting<any>('shift_tasks').catch(() => null);
  const n = Number(s?.distribute_after_minutes);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

/** The run (checklist instance) for a core shift, created from the active templates the first time it is needed. */
export async function ensureRun(code: string, workDate: string) {
  return tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['taskrun:' + workDate + code]);
    let run = (await c.query(`SELECT * FROM shift_task_runs WHERE work_date=$1 AND shift_code=$2`, [workDate, code])).rows[0];
    if (run) return run;
    run = (await c.query(`INSERT INTO shift_task_runs(work_date,shift_code) VALUES($1,$2) RETURNING *`, [workDate, code])).rows[0];
    const tpl = (await c.query(`SELECT * FROM shift_task_templates WHERE active AND $1 = ANY(shift_codes) ORDER BY sort_order, title`, [code])).rows;
    for (const t of tpl) {
      const items: TaskItem[] = (t.items ?? []).map((label: string) => ({ label, done: false }));
      await c.query(`INSERT INTO shift_tasks(run_id,template_id,title,kind,items,minutes,sort_order,phase) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [run.id, t.id, t.title, t.kind, JSON.stringify(items), t.minutes, t.sort_order, t.phase ?? 'last_hour']);
    }
    return run;
  });
}

/** Staff clocked in right now, with the shift they are rostered on. */
export async function onDuty() {
  return q<any>(`SELECT s.id, s.full_name, s.role, s.is_manager, a.clock_in_at, a.shift_code, COALESCE(st.core, false) core
                 FROM staff_attendance a JOIN staff s ON s.id=a.staff_id LEFT JOIN shift_types st ON st.code=a.shift_code
                 WHERE a.clock_out_at IS NULL AND s.active ORDER BY a.clock_in_at`);
}
/** Who works a run: people on that core shift, in-between shifts, or not rostered. Not the incoming/outgoing other core shift. */
const eligible = (staff: any[], code: string) => staff.filter((s) => !s.shift_code || s.shift_code === code || !s.core);

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = randomInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/** Assign unassigned pending tasks of the given phases. Random order, biggest first, to the least-loaded person; avoid repeating last time. */
async function assignOpen(runId: string, staff: { id: string }[], phases: string[]) {
  if (!staff.length || !phases.length) return 0;
  const run = (await q<any>(`SELECT * FROM shift_task_runs WHERE id=$1`, [runId]))[0];
  const tasks = await q<any>(`SELECT * FROM shift_tasks WHERE run_id=$1`, [runId]);
  const load = new Map<string, number>(staff.map((s) => [s.id, 0]));
  for (const t of tasks) if (t.assigned_to && load.has(t.assigned_to)) load.set(t.assigned_to, load.get(t.assigned_to)! + t.minutes);
  const prev = await q<any>(`SELECT st.template_id, st.assigned_to FROM shift_tasks st JOIN shift_task_runs r ON r.id=st.run_id
                             WHERE r.id <> $1 AND r.work_date BETWEEN $2::date - 1 AND $2::date AND st.assigned_to IS NOT NULL AND st.template_id IS NOT NULL`, [runId, run.work_date]);
  const had = new Set(prev.map((p) => `${p.template_id}|${p.assigned_to}`));
  // Money tasks belong to whoever receives the drawer, never shared at random.
  const open = shuffle(tasks.filter((t) => !t.assigned_to && t.status === 'pending' && t.kind !== 'money' && phases.includes(t.phase))).sort((a, b) => b.minutes - a.minutes);
  let n = 0;
  for (const t of open) {
    const order = shuffle(staff).map((s) => ({ s, score: load.get(s.id)! + (had.has(`${t.template_id}|${s.id}`) ? Math.max(10, t.minutes) : 0) }))
      .sort((a, b) => a.score - b.score);
    const pick = order[0].s;
    await q(`UPDATE shift_tasks SET assigned_to=$2 WHERE id=$1 AND assigned_to IS NULL`, [t.id, pick.id]);
    load.set(pick.id, load.get(pick.id)! + t.minutes);
    n++;
  }
  return n;
}

/** Keep it fair as people come and go (only tasks nobody has started; money tasks stay with the drawer holder). */
async function rebalance(runId: string, staff: { id: string }[], phases: string[]) {
  const ids = [...new Set(staff.map((s) => s.id))];
  await q(`UPDATE shift_tasks SET assigned_to=NULL WHERE run_id=$1 AND status='pending' AND started_at IS NULL AND kind <> 'money' AND source = 'template'
           AND assigned_to IS NOT NULL AND NOT (assigned_to = ANY($2::uuid[]))`, [runId, ids]);
  await assignOpen(runId, staff, phases);
  if (staff.length < 2) return;
  for (let guard = 0; guard < 50; guard++) {
    const tasks = await q<any>(`SELECT * FROM shift_tasks WHERE run_id=$1 AND status='pending'`, [runId]);
    const load = new Map<string, number>(staff.map((s) => [s.id, 0]));
    for (const t of tasks) if (t.assigned_to && load.has(t.assigned_to)) load.set(t.assigned_to, load.get(t.assigned_to)! + t.minutes);
    const sorted = [...load.entries()].sort((a, b) => a[1] - b[1]);
    const [lo, loLoad] = sorted[0], [hi, hiLoad] = sorted[sorted.length - 1];
    const movable = shuffle(tasks.filter((t) => t.assigned_to === hi && !t.started_at && t.kind !== 'money' && t.source === 'template' && phases.includes(t.phase))).sort((a, b) => a.minutes - b.minutes);
    const t = movable.find((x) => Math.abs((hiLoad - x.minutes) - (loLoad + x.minutes)) < hiLoad - loLoad);
    if (!t) return;
    await q(`UPDATE shift_tasks SET assigned_to=$2 WHERE id=$1`, [t.id, lo]);
  }
}

/** Shift ended with tasks open: record them as missed; the third time the same person misses the same task, alert the owner. */
async function closeOut(run: any, sh: ShiftWin) {
  const missed = await q<any>(`UPDATE shift_tasks SET missed_at=$2 WHERE run_id=$1 AND status='pending' AND missed_at IS NULL AND assigned_to IS NOT NULL RETURNING *`, [run.id, sh.end]);
  for (const t of missed) {
    const n = (await q<any>(`SELECT count(*)::int n FROM shift_tasks WHERE assigned_to=$1 AND missed_at IS NOT NULL AND missed_at > now() - interval '60 days'
                             AND (($2::uuid IS NOT NULL AND template_id=$2) OR ($2::uuid IS NULL AND kind=$3))`, [t.assigned_to, t.template_id, t.kind]))[0].n;
    if (n >= 3) {
      const who = (await q<any>(`SELECT full_name FROM staff WHERE id=$1`, [t.assigned_to]))[0]?.full_name ?? 'Staff';
      const title = `${who} missed "${t.title}" ${n} times`;
      const ins = await q(`INSERT INTO tasks(title,detail,kind,dedupe_key) VALUES($1,$2,'general',$3) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
        [title, `Last missed on the ${sh.label} shift of ${sh.workDate}. For follow-up by the owner.`, 'taskmiss:' + t.id]);
      if (ins.length) notifyStaff(`Task alert: ${title} (latest: ${sh.label} shift, ${sh.workDate}).`).catch(() => {});
    }
  }
}

/** Automatic sharing of shift tasks (off: the manager gives them out). Settings key tasks_auto_share. */
export async function tasksAutoShare(): Promise<boolean> {
  const { getSetting } = await import('../settings');
  return (await getSetting<boolean>('tasks_auto_share').catch(() => null)) === true;
}

/** Shares tasks at the right time and keeps runs balanced. Called by the POS, the dashboard and the worker. */
export async function syncRuns(opts: { now?: Date; force?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const grace = await graceMinutes();
  const auto = await tasksAutoShare();
  const staff = await onDuty();
  const out: { run: any; shift: ShiftWin; shareStartAt: Date; shareLastAt: Date; staff: any[] }[] = [];
  for (const sh of await activeShifts(now)) {
    const run = await ensureRun(sh.code, sh.workDate);
    const team = eligible(staff, sh.code);
    const shareStartAt = new Date(sh.start.getTime() + grace * 60000);
    const shareLastAt = new Date(sh.end.getTime() - 60 * 60000);
    const phases = [...(opts.force || now >= shareStartAt ? ['start'] : []), ...(opts.force || now >= shareLastAt ? ['last_hour'] : [])];
    // Tasks are given out by the manager (POS → Tasks). Automatic sharing only when the owner turns it on.
    if (auto && team.length && phases.length) {
      await rebalance(run.id, team, phases);
      if (phases.includes('last_hour') && !run.distributed_at) {
        await q(`UPDATE shift_task_runs SET distributed_at=$2 WHERE id=$1`, [run.id, now]);
        run.distributed_at = now;
      }
    }
    out.push({ run, shift: sh, shareStartAt, shareLastAt, staff: team });
  }
  // Close out runs that have just ended (yesterday and today).
  const ended = await q<any>(`SELECT * FROM shift_task_runs WHERE work_date >= $1::date - 1 AND work_date <= $1::date`, [todayLocal(now)]);
  for (const r of ended) {
    const sh = await shiftWindow(r.shift_code, r.work_date);
    if (sh && now >= sh.end) await closeOut(r, sh);
  }
  return out;
}

/** Back-compat: the run that matters most right now (the latest started). */
export async function syncCurrentRun(opts: { force?: boolean; now?: Date } = {}) {
  const all = await syncRuns(opts);
  const r = all[all.length - 1];
  return r ? { run: r.run, shift: r.shift, shareAt: r.shareLastAt, shareStartAt: r.shareStartAt, staff: r.staff } : null;
}

/** The run a staff member works in now (their rostered shift if it is running, else the latest one). */
export async function runForStaff(staffId: string, now = new Date()) {
  const all = await syncRuns({ now });
  if (!all.length) return null;
  const me = (await onDuty()).find((s) => s.id === staffId);
  return (me?.shift_code && all.find((r) => r.shift.code === me.shift_code)) || all.find((r) => r.staff.some((s: any) => s.id === staffId)) || all[all.length - 1];
}

/** The drawer was received (POS open shift): the money tasks of the shift being started go to that person; the count completes "Money received". */
export async function onDrawerReceived(staffId: string, counts: { EGP: number; USD: number; EUR: number }, mismatch: string | null, now = new Date()) {
  const cands = await activeShifts(now, 30);
  const sh = cands[cands.length - 1];
  if (!sh) return;
  const run = await ensureRun(sh.code, sh.workDate);
  const note = `Counted at handover: EGP ${counts.EGP / 100} · USD ${counts.USD / 100} · EUR ${counts.EUR / 100}${mismatch ? ` · difference ${mismatch}` : ''}`;
  await q(`UPDATE shift_tasks SET assigned_to=$2 WHERE run_id=$1 AND kind='money' AND status='pending'`, [run.id, staffId]);
  await q(`UPDATE shift_tasks SET status='done', done_at=now(), done_by=$2, started_at=COALESCE(started_at, now()), note=$3
           WHERE run_id=$1 AND kind='money' AND status='pending' AND title ILIKE 'money%'`, [run.id, staffId, note]);
}

/** Add a one-off task to a run (taxi confirmation, tour car booking). */
export async function addRunTask(runId: string, t: { title: string; kind: string; source: string; refId?: string | null; minutes?: number; assignedTo?: string | null; phase?: string; items?: string[] }) {
  const exists = t.refId ? (await q<any>(`SELECT id FROM shift_tasks WHERE source=$1 AND ref_id=$2 AND kind=$3`, [t.source, t.refId, t.kind]))[0] : null;
  if (exists) return exists.id;
  return (await q<any>(`INSERT INTO shift_tasks(run_id,title,kind,items,minutes,sort_order,phase,source,ref_id,assigned_to) VALUES($1,$2,$3,$4,$5,0,$6,$7,$8,$9) RETURNING id`,
    [runId, t.title, t.kind, JSON.stringify((t.items ?? []).map((label) => ({ label, done: false }))), t.minutes ?? 5, t.phase ?? 'start', t.source, t.refId ?? null, t.assignedTo ?? null]))[0].id;
}

/** Whoever took the money for a tour books the car and driver in the same shift. */
export async function onTourSold(x: { serviceOrderId: string; staffId: string; tour: string; qty: number; guest: string; room: string | null }) {
  const r = await runForStaff(x.staffId);
  if (!r) return;
  await addRunTask(r.run.id, { title: `Book car & driver: ${x.tour} · ${x.guest}${x.room ? ' (' + x.room + ')' : ''} · ${x.qty} pax`, kind: 'tour_booking', source: 'tour', refId: x.serviceOrderId, minutes: 10, assignedTo: x.staffId, items: ['Car & driver booked', 'Guest told the pick-up time'] });
}

/* ───────── Live content for the automatic tasks ───────── */

export async function unpaidList() {
  const rows = await q<any>(`SELECT r.id, r.reference, r.currency, g.full_name,
      (SELECT string_agg(DISTINCT rm.name, ', ') FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=r.id AND ru.active) rooms
    FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.status='checked_in' ORDER BY g.full_name`);
  const out = [];
  for (const r of rows) { const f = await getFolio(r.id); if (f.balance > 0) out.push({ id: r.id, guest: r.full_name, rooms: r.rooms, cents: f.balance, currency: r.currency }); }
  return out;
}

export async function washesList() {
  return q<any>(`SELECT s.id, s.guest_name, s.room_number, s.quantity, s.amount_cents, s.payment_status, s.ready_at, s.created_at
                 FROM service_orders s WHERE s.service_type='laundry' AND s.payment_status <> 'void'
                   AND (s.ready_at IS NULL OR s.ready_at > now() - interval '12 hours') AND s.created_at > now() - interval '7 days'
                 ORDER BY s.ready_at NULLS FIRST, s.created_at`);
}

export async function toursList() {
  const today = todayLocal();
  return q<any>(`SELECT s.id, s.guest_name, s.room_number, s.quantity, s.item_name, s.order_date, s.payment_status
                 FROM service_orders s WHERE s.tour_id IS NOT NULL AND s.payment_status <> 'void' AND s.order_date BETWEEN $1::date - 1 AND $1::date + 1
                 ORDER BY s.created_at DESC`, [today]);
}

/** Taxis from now until the end of tomorrow. */
export async function upcomingTaxis() {
  return q<any>(`SELECT * FROM taxi_bookings WHERE status='booked' AND scheduled_at > now() - interval '3 hours'
                 AND scheduled_at < (($1::date + 2)::timestamp AT TIME ZONE 'Africa/Cairo') ORDER BY scheduled_at`, [todayLocal()]);
}

export async function runView(runId: string) {
  const run = (await q<any>(`SELECT r.*, st.label FROM shift_task_runs r JOIN shift_types st ON st.code=r.shift_code WHERE r.id=$1`, [runId]))[0];
  if (!run) throw new BookingError('NOT_FOUND');
  const tasks = await q<any>(`SELECT t.*, s.full_name assignee, d.full_name done_by_name FROM shift_tasks t
                              LEFT JOIN staff s ON s.id=t.assigned_to LEFT JOIN staff d ON d.id=t.done_by
                              WHERE t.run_id=$1 ORDER BY t.sort_order, t.title`, [runId]);
  const kinds = new Set(tasks.map((t) => t.kind));
  const [unpaid, washes, tours, taxis] = await Promise.all([
    kinds.has('unpaid') ? unpaidList() : Promise.resolve([]),
    kinds.has('washes') ? washesList() : Promise.resolve([]),
    kinds.has('tours') ? toursList() : Promise.resolve([]),
    kinds.has('taxi') || kinds.has('taxi_confirm') ? upcomingTaxis() : Promise.resolve([]),
  ]);
  return { run, tasks, unpaid, washes, tours, taxis };
}

/* ───────── Actions ───────── */

/** Save ticks / note; mark done. Only the assignee or a manager. */
export async function saveTask(taskId: string, by: { id: string; is_manager: boolean }, input: { items?: TaskItem[]; note?: string | null; done?: boolean }) {
  const t = (await q<any>(`SELECT * FROM shift_tasks WHERE id=$1`, [taskId]))[0];
  if (!t) throw new BookingError('NOT_FOUND');
  if (t.assigned_to !== by.id && !by.is_manager) throw new BookingError('FORBIDDEN', 'This task is assigned to someone else');
  const items: TaskItem[] = Array.isArray(input.items) ? (t.items as TaskItem[]).map((it, i) => ({ label: it.label, done: !!input.items![i]?.done })) : t.items;
  if (input.done && items.some((i) => !i.done)) throw new BookingError('INVALID_INPUT', 'Tick every item first, or write a note on what is missing');
  const touched = items.some((i) => i.done) || !!input.note?.trim() || !!input.done;
  await q(`UPDATE shift_tasks SET items=$2, note=$3, started_at=CASE WHEN $4 THEN COALESCE(started_at, now()) ELSE started_at END,
             status=CASE WHEN $5 THEN 'done' WHEN $6 THEN 'pending' ELSE status END,
             done_at=CASE WHEN $5 THEN now() WHEN $6 THEN NULL ELSE done_at END, missed_at=CASE WHEN $5 THEN NULL ELSE missed_at END, done_by=CASE WHEN $5 THEN $7::uuid WHEN $6 THEN NULL ELSE done_by END WHERE id=$1`,
    [taskId, JSON.stringify(items), input.note?.trim() || null, touched, !!input.done, input.done === false, by.id]);
  if (t.kind === 'taxi_confirm' && t.ref_id && input.done !== undefined)
    await q(`UPDATE taxi_bookings SET confirmed_at=CASE WHEN $2 THEN now() ELSE NULL END, confirmed_by=CASE WHEN $2 THEN $3::uuid ELSE NULL END WHERE id=$1`, [t.ref_id, !!input.done, by.id]);
}

/** Done with an exception: allowed with a note even if not every item is ticked (e.g. "toilet paper out of stock"). */
export async function finishWithNote(taskId: string, by: { id: string; is_manager: boolean }, note: string) {
  if (!note?.trim()) throw new BookingError('INVALID_INPUT', 'Write what is missing');
  const t = (await q<any>(`SELECT * FROM shift_tasks WHERE id=$1`, [taskId]))[0];
  if (!t) throw new BookingError('NOT_FOUND');
  if (t.assigned_to !== by.id && !by.is_manager) throw new BookingError('FORBIDDEN', 'This task is assigned to someone else');
  await q(`UPDATE shift_tasks SET status='done', note=$2, done_at=now(), done_by=$3, started_at=COALESCE(started_at, now()) WHERE id=$1`, [taskId, note.trim(), by.id]);
}

export async function reassignTask(taskId: string, staffId: string | null, actor: string) {
  await q(`UPDATE shift_tasks SET assigned_to=$2, started_at=CASE WHEN $2::uuid IS NULL THEN NULL ELSE started_at END WHERE id=$1`, [taskId, staffId]);
  await audit(actor, 'task.reassign', 'shift_task', taskId, { staffId });
}

export async function redistribute(runId: string, actor: string) {
  const run = (await q<any>(`SELECT * FROM shift_task_runs WHERE id=$1`, [runId]))[0];
  if (!run) throw new BookingError('NOT_FOUND');
  const team = eligible(await onDuty(), run.shift_code);
  if (!team.length) throw new BookingError('BAD_STATE', 'Nobody on this shift is clocked in yet');
  await q(`UPDATE shift_tasks SET assigned_to=NULL WHERE run_id=$1 AND status='pending' AND started_at IS NULL AND kind <> 'money' AND source='template'`, [runId]);
  await q(`UPDATE shift_task_runs SET distributed_at=COALESCE(distributed_at, now()) WHERE id=$1`, [runId]);
  const n = await assignOpen(runId, team, ['start', 'last_hour']);
  await audit(actor, 'task.redistribute', 'shift_task_run', runId, { n, staff: team.length });
  return n;
}

export async function setRunNotes(runId: string, notes: string) {
  await q(`UPDATE shift_task_runs SET notes=$2 WHERE id=$1`, [runId, notes.trim() || null]);
}

export async function setWashReady(serviceOrderId: string, ready: boolean) {
  await q(`UPDATE service_orders SET ready_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1 AND service_type='laundry'`, [serviceOrderId, ready]);
}

const cairo = (d: Date | string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', ...o }).format(new Date(d));
export function taxiLine(x: any) {
  const day = cairo(x.scheduled_at, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
  const today = todayLocal();
  const when = day === today ? 'today' : day === addDays(today, 1) ? 'tomorrow' : '';
  const date = cairo(x.scheduled_at, { day: 'numeric', month: 'numeric' });
  const time = cairo(x.scheduled_at, { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' });
  return `${x.guest_name}${x.room_label ? ' ' + x.room_label : ''} ${x.direction === 'pickup' ? 'pickup' : 'drop-off'} ${when} ${date} ${time} ${x.airport === 'sphinx' ? 'Sphinx' : 'Cairo'} airport${x.confirmed_at ? ' informed' : ' not informed yet'}`.replace(/\s+/g, ' ');
}

const money = (c: number, cur = 'EGP') => `${Math.round(c / 100).toLocaleString('en-US')}${cur === 'EGP' ? '' : ' ' + cur}`;

/** The handover message staff paste into the team WhatsApp group (same layout the team already uses). */
export async function handoverText(runId: string) {
  const v = await runView(runId);
  const mark = (t: any) => (t.status === 'done' ? '✅' : '❌');
  const lines: string[] = [];
  for (const t of v.tasks) {
    if (t.kind === 'taxi_confirm') continue; // covered by the taxi status line
    const icon = /money/i.test(t.title) ? '💰' : /visa|card/i.test(t.title) ? '🧾' : /key/i.test(t.title) ? '🔑' : /coffee/i.test(t.title) ? '☕' : /bath/i.test(t.title) ? '🛁'
      : /ota|message/i.test(t.title) ? '🌍' : t.kind === 'taxi' ? '🚖' : t.kind === 'tours' ? '🌌' : t.kind === 'washes' ? '🧺' : t.kind === 'unpaid' ? '📝' : t.kind === 'tour_booking' ? '🚗' : '▫️';
    const items = (t.items as TaskItem[]);
    if (t.kind === 'unpaid') {
      lines.push(`${icon} ${t.title}:`);
      for (const u of v.unpaid) lines.push(`⁠${u.guest}${u.rooms ? ' ' + u.rooms : ''} ( ${money(u.cents, u.currency)})`);
      if (!v.unpaid.length) lines.push('⁠All paid ✅');
    } else if (t.kind === 'washes') {
      lines.push(`${icon} ${t.title}:`);
      for (const w of v.washes) lines.push(`⁠${w.room_number || w.guest_name || 'Walk-in'} ${['paid', 'comp'].includes(w.payment_status) ? 'paid' : 'not paid'} and ${w.ready_at ? 'ready' : 'not ready'}`);
      if (!v.washes.length) lines.push('⁠No washes');
    } else if (t.kind === 'taxi') {
      lines.push(`${icon} ${t.title}:`);
      for (const x of v.taxis) lines.push(`⁠${taxiLine(x)}`);
      if (!v.taxis.length) lines.push('⁠No taxis');
    } else if (t.kind === 'tours') {
      lines.push(`${icon} ${t.title}:`);
      for (const x of v.tours) lines.push(`⁠${x.guest_name || 'Walk-in'}${x.room_number ? ' ' + x.room_number : ''} ${x.item_name} x${x.quantity}`);
      if (!v.tours.length) lines.push('⁠No tours');
    } else if (items.length) {
      lines.push(`${icon} ${t.title} : ${items.map((i) => `${i.label} ${i.done ? '✅' : '❌'}`).join(' ')}`);
    } else {
      lines.push(`${icon} ${t.title}* : ${mark(t)}`);
    }
    if (t.note) lines.push(`   ${t.note}`);
  }
  if (v.run.notes) lines.push(`Notes : ${v.run.notes}`);
  return lines.join('\n');
}

/** Per-staff completion for a month (for the attendance page / manager). */
export async function taskStats(month: string) {
  const from = `${month}-01`;
  const d = new Date(from + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1);
  const to = d.toISOString().slice(0, 10);
  return q<any>(`SELECT s.id, s.full_name,
      count(t.id) FILTER (WHERE t.status='done')::int done,
      count(t.id) FILTER (WHERE t.status='pending' AND r.work_date < $3::date)::int missed,
      count(t.id)::int total
    FROM staff s JOIN shift_tasks t ON t.assigned_to=s.id JOIN shift_task_runs r ON r.id=t.run_id
    WHERE r.work_date >= $1::date AND r.work_date < $2::date GROUP BY s.id ORDER BY s.full_name`, [from, to, todayLocal()]);
}
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;
