import { randomInt } from 'node:crypto';
import { q, tx } from '@/lib/db';
import { todayLocal, addDays, zonedToUtc } from '@/lib/dates';
import { getSetting } from '../settings';
import { audit } from '../audit';
import { BookingError } from '../errors';
import { getFolio } from './folio';

/**
 * Shift tasks. The same checklist every shift; each shift it is shared out at random between the staff who are
 * clocked in, balanced by the minutes each task takes, and avoiding giving someone the task they had last time.
 * Distribution happens once the grace period after the shift start has passed (so on-time arrivals all count),
 * and is self-healing: latecomers pick up untouched tasks, and tasks of someone who clocked out are shared again.
 */

export type TaskItem = { label: string; done: boolean };
export type ShiftNow = { code: string; label: string; workDate: string; start: Date; end: Date };

const KIND_LABEL: Record<string, string> = { money: 'Money', unpaid: 'Unpaid', washes: 'Washes', tours: 'Tours', taxi: 'Taxi', check: 'Checklist' };
export const taskKinds = KIND_LABEL;

export async function currentShift(now = new Date()): Promise<ShiftNow | null> {
  const types = await q<any>(`SELECT code, label, start_time, end_time FROM shift_types WHERE NOT is_off AND start_time IS NOT NULL ORDER BY sort_order`);
  const today = todayLocal(now);
  for (const day of [today, addDays(today, -1)]) {
    for (const t of types) {
      const start = zonedToUtc(day, t.start_time);
      let end = zonedToUtc(day, t.end_time || t.start_time);
      if (end <= start) end = new Date(end.getTime() + 86400000);
      if (now >= start && now < end) return { code: t.code, label: t.label, workDate: day, start, end };
    }
  }
  return null;
}

async function graceMinutes() {
  const s = await getSetting<any>('shift_tasks').catch(() => null);
  const n = Number(s?.distribute_after_minutes);
  return Number.isFinite(n) && n >= 0 ? n : 15;
}

/** The run (checklist instance) for a shift, created from the active templates the first time it is needed. */
export async function ensureRun(code: string, workDate: string) {
  return tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ['taskrun:' + workDate + code]);
    let run = (await c.query(`SELECT * FROM shift_task_runs WHERE work_date=$1 AND shift_code=$2`, [workDate, code])).rows[0];
    if (run) return run;
    run = (await c.query(`INSERT INTO shift_task_runs(work_date,shift_code) VALUES($1,$2) RETURNING *`, [workDate, code])).rows[0];
    const tpl = (await c.query(`SELECT * FROM shift_task_templates WHERE active AND $1 = ANY(shift_codes) ORDER BY sort_order, title`, [code])).rows;
    for (const t of tpl) {
      const items: TaskItem[] = (t.items ?? []).map((label: string) => ({ label, done: false }));
      await c.query(`INSERT INTO shift_tasks(run_id,template_id,title,kind,items,minutes,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [run.id, t.id, t.title, t.kind, JSON.stringify(items), t.minutes, t.sort_order]);
    }
    return run;
  });
}

/** Staff clocked in right now (POS clock-in or opening a drawer). */
export async function onDuty() {
  return q<any>(`SELECT s.id, s.full_name, s.role, s.is_manager, a.clock_in_at FROM staff_attendance a JOIN staff s ON s.id=a.staff_id
                 WHERE a.clock_out_at IS NULL AND s.active ORDER BY a.clock_in_at`);
}

const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = randomInt(i + 1); [b[i], b[j]] = [b[j], b[i]]; } return b; };

/** Assign every unassigned pending task. Random order, biggest first, to the least-loaded person; avoid repeating last run. */
async function assignOpen(runId: string, staff: { id: string }[]) {
  if (!staff.length) return 0;
  const run = (await q<any>(`SELECT * FROM shift_task_runs WHERE id=$1`, [runId]))[0];
  const tasks = await q<any>(`SELECT * FROM shift_tasks WHERE run_id=$1`, [runId]);
  const load = new Map<string, number>(staff.map((s) => [s.id, 0]));
  for (const t of tasks) if (t.assigned_to && load.has(t.assigned_to)) load.set(t.assigned_to, load.get(t.assigned_to)! + t.minutes);
  // Who had which template on the previous run of the same shift (yesterday), and on the shift just before.
  const prev = await q<any>(`SELECT st.template_id, st.assigned_to FROM shift_tasks st JOIN shift_task_runs r ON r.id=st.run_id
                             WHERE r.id <> $1 AND r.work_date BETWEEN $2::date - 1 AND $2::date AND st.assigned_to IS NOT NULL`, [runId, run.work_date]);
  const had = new Set(prev.map((p) => `${p.template_id}|${p.assigned_to}`));
  const open = shuffle(tasks.filter((t) => !t.assigned_to && t.status === 'pending')).sort((a, b) => b.minutes - a.minutes);
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

/**
 * Keep the run fair as people come and go:
 * - tasks of someone no longer clocked in (and not started) go back to the pool and are shared again;
 * - someone who arrived after the share-out takes untouched tasks from the busiest person while it evens things out.
 */
async function rebalance(runId: string, staff: { id: string }[]) {
  const ids = new Set(staff.map((s) => s.id));
  await q(`UPDATE shift_tasks SET assigned_to=NULL WHERE run_id=$1 AND status='pending' AND started_at IS NULL AND assigned_to IS NOT NULL AND NOT (assigned_to = ANY($2::uuid[]))`, [runId, [...ids]]);
  await assignOpen(runId, staff);
  if (staff.length < 2) return;
  for (let guard = 0; guard < 50; guard++) {
    const tasks = await q<any>(`SELECT * FROM shift_tasks WHERE run_id=$1 AND status='pending'`, [runId]);
    const load = new Map<string, number>(staff.map((s) => [s.id, 0]));
    for (const t of tasks) if (t.assigned_to && load.has(t.assigned_to)) load.set(t.assigned_to, load.get(t.assigned_to)! + t.minutes);
    const sorted = [...load.entries()].sort((a, b) => a[1] - b[1]);
    const [lo, loLoad] = sorted[0], [hi, hiLoad] = sorted[sorted.length - 1];
    const movable = shuffle(tasks.filter((t) => t.assigned_to === hi && !t.started_at)).sort((a, b) => a.minutes - b.minutes);
    const t = movable.find((x) => Math.abs((hiLoad - x.minutes) - (loLoad + x.minutes)) < hiLoad - loLoad);
    if (!t) return;
    await q(`UPDATE shift_tasks SET assigned_to=$2 WHERE id=$1`, [t.id, lo]);
  }
}

/** Called whenever someone looks at the tasks: creates the run, shares it out after the grace period, and keeps it balanced. */
export async function syncCurrentRun(opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const sh = await currentShift(now);
  if (!sh) return null;
  const run = await ensureRun(sh.code, sh.workDate);
  const staff = await onDuty();
  const shareAt = new Date(sh.start.getTime() + (await graceMinutes()) * 60000);
  if (!run.distributed_at) {
    if ((opts.force || now >= shareAt) && staff.length) {
      await assignOpen(run.id, staff);
      await q(`UPDATE shift_task_runs SET distributed_at=$2 WHERE id=$1`, [run.id, now]);
      run.distributed_at = now;
    }
  } else {
    await rebalance(run.id, staff);
  }
  return { run, shift: sh, shareAt, staff };
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

export async function runView(runId: string) {
  const run = (await q<any>(`SELECT r.*, st.label FROM shift_task_runs r JOIN shift_types st ON st.code=r.shift_code WHERE r.id=$1`, [runId]))[0];
  if (!run) throw new BookingError('NOT_FOUND');
  const tasks = await q<any>(`SELECT t.*, s.full_name assignee, d.full_name done_by_name FROM shift_tasks t
                              LEFT JOIN staff s ON s.id=t.assigned_to LEFT JOIN staff d ON d.id=t.done_by
                              WHERE t.run_id=$1 ORDER BY t.sort_order, t.title`, [runId]);
  const kinds = new Set(tasks.map((t) => t.kind));
  const [unpaid, washes, tours] = await Promise.all([
    kinds.has('unpaid') ? unpaidList() : Promise.resolve([]),
    kinds.has('washes') ? washesList() : Promise.resolve([]),
    kinds.has('tours') ? toursList() : Promise.resolve([]),
  ]);
  return { run, tasks, unpaid, washes, tours };
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
             done_at=CASE WHEN $5 THEN now() WHEN $6 THEN NULL ELSE done_at END, done_by=CASE WHEN $5 THEN $7::uuid WHEN $6 THEN NULL ELSE done_by END WHERE id=$1`,
    [taskId, JSON.stringify(items), input.note?.trim() || null, touched, !!input.done, input.done === false, by.id]);
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
  const staff = await onDuty();
  if (!staff.length) throw new BookingError('BAD_STATE', 'Nobody is clocked in yet');
  await q(`UPDATE shift_tasks SET assigned_to=NULL WHERE run_id=$1 AND status='pending' AND started_at IS NULL`, [runId]);
  await q(`UPDATE shift_task_runs SET distributed_at=COALESCE(distributed_at, now()) WHERE id=$1`, [runId]);
  const n = await assignOpen(runId, staff);
  await audit(actor, 'task.redistribute', 'shift_task_run', runId, { n, staff: staff.length });
  return n;
}

export async function setRunNotes(runId: string, notes: string) {
  await q(`UPDATE shift_task_runs SET notes=$2 WHERE id=$1`, [runId, notes.trim() || null]);
}

export async function setWashReady(serviceOrderId: string, ready: boolean) {
  await q(`UPDATE service_orders SET ready_at=CASE WHEN $2 THEN now() ELSE NULL END WHERE id=$1 AND service_type='laundry'`, [serviceOrderId, ready]);
}

const money = (c: number, cur = 'EGP') => `${Math.round(c / 100).toLocaleString('en-US')}${cur === 'EGP' ? '' : ' ' + cur}`;

/** The handover message staff paste into the team WhatsApp group (same layout the team already uses). */
export async function handoverText(runId: string) {
  const v = await runView(runId);
  const mark = (t: any) => (t.status === 'done' ? '✅' : '❌');
  const lines: string[] = [];
  for (const t of v.tasks) {
    const icon = /money/i.test(t.title) ? '💰' : /visa|card/i.test(t.title) ? '🧾' : /key/i.test(t.title) ? '🔑' : /coffee/i.test(t.title) ? '☕' : /bath/i.test(t.title) ? '🛁'
      : /ota|message/i.test(t.title) ? '🌍' : t.kind === 'taxi' ? '🚖' : t.kind === 'tours' ? '🌌' : t.kind === 'washes' ? '🧺' : t.kind === 'unpaid' ? '📝' : '▫️';
    const items = (t.items as TaskItem[]);
    if (t.kind === 'unpaid') {
      lines.push(`${icon} ${t.title}:`);
      for (const u of v.unpaid) lines.push(`⁠${u.guest}${u.rooms ? ' ' + u.rooms : ''} ( ${money(u.cents, u.currency)})`);
      if (!v.unpaid.length) lines.push('⁠All paid ✅');
    } else if (t.kind === 'washes') {
      lines.push(`${icon} ${t.title}:`);
      for (const w of v.washes) lines.push(`⁠${w.room_number || w.guest_name || 'Walk-in'} ${['paid', 'comp'].includes(w.payment_status) ? 'paid' : 'not paid'} and ${w.ready_at ? 'ready' : 'not ready'}`);
      if (!v.washes.length) lines.push('⁠No washes');
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
