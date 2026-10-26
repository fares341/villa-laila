import bcrypt from 'bcryptjs';
import { q, tx } from '@/lib/db';
import type { Q } from '@/lib/db';
import { todayLocal, addDays, zonedToUtc } from '@/lib/dates';
import { getSetting } from '../settings';
import { audit } from '../audit';
import { BookingError } from '../errors';
import { notifyStaff } from '../conversations';

export type Staff = {
  id: string; full_name: string; role: string; phone: string | null; user_id: string | null; is_manager: boolean; can_use_pos: boolean;
  monthly_target_hours: number; hourly_rate_cents: number; daily_rate_cents: number; active: boolean; has_pin: boolean; can_take_cash?: boolean;
};

export type LatenessTier = { from: number; to: number | null; fixed_cents: number | null; day_fraction: number; alert?: boolean };
export type LatenessPolicy = { grace_minutes: number; mode: 'fixed' | 'fraction'; tiers: LatenessTier[] };

const DEFAULT_POLICY: LatenessPolicy = {
  grace_minutes: 15, mode: 'fixed',
  tiers: [
    { from: 16, to: 30, fixed_cents: 5000, day_fraction: 0.25 },
    { from: 31, to: 60, fixed_cents: 10000, day_fraction: 0.5 },
    { from: 61, to: null, fixed_cents: null, day_fraction: 1, alert: true },
  ],
};

export async function latenessPolicy(): Promise<LatenessPolicy> {
  const p = await getSetting<LatenessPolicy>('lateness_policy').catch(() => null);
  return p && Array.isArray(p.tiers) ? p : DEFAULT_POLICY;
}

/** Pure: delay (ms) → tier + deduction. Tier 3 (> 60 min) is always a full day; fixed amounts apply to tiers 1–2 in fixed mode. */
export function lateness(delayMs: number, policy: LatenessPolicy, dailyRateCents: number) {
  const minutes = Math.max(0, Math.floor(delayMs / 60000));
  if (minutes <= policy.grace_minutes) return { minutes, tier: 0, deductionCents: 0, alert: false };
  const idx = policy.tiers.findIndex((t) => minutes >= t.from && (t.to == null || minutes <= t.to));
  const t = policy.tiers[idx >= 0 ? idx : policy.tiers.length - 1];
  const tier = (idx >= 0 ? idx : policy.tiers.length - 1) + 1;
  const byFraction = Math.round(dailyRateCents * t.day_fraction);
  const deduction = policy.mode === 'fixed' && t.fixed_cents != null ? t.fixed_cents : byFraction;
  return { minutes, tier: Math.min(3, tier), deductionCents: Math.max(0, deduction), alert: !!t.alert };
}

const PUBLIC_COLS = `id, full_name, role, phone, user_id, is_manager, can_use_pos, monthly_target_hours::float monthly_target_hours,
  hourly_rate_cents, daily_rate_cents, active, can_take_cash, (pin_hash IS NOT NULL) has_pin`;

export async function listStaff(activeOnly = false): Promise<Staff[]> {
  return q<Staff>(`SELECT ${PUBLIC_COLS} FROM staff ${activeOnly ? 'WHERE active' : ''} ORDER BY active DESC, full_name`);
}

export async function saveStaff(input: { id?: string; fullName: string; role: string; phone?: string | null; pin?: string | null; isManager?: boolean; canUsePos?: boolean; monthlyTargetHours?: number; hourlyRateCents?: number; dailyRateCents?: number; active?: boolean; userId?: string | null; canTakeCash?: boolean }, actor: string) {
  if (!input.fullName?.trim()) throw new BookingError('INVALID_INPUT', 'Name is required');
  if (input.pin && !/^\d{4,6}$/.test(input.pin)) throw new BookingError('INVALID_INPUT', 'PIN must be 4–6 digits');
  const pinHash = input.pin ? await bcrypt.hash(input.pin, 10) : null;
  const vals = [input.fullName.trim(), input.role?.trim() || 'Receptionist', input.phone?.trim() || null, !!input.isManager, input.canUsePos !== false,
    input.monthlyTargetHours ?? 208, input.hourlyRateCents ?? 0, input.dailyRateCents ?? 0, input.active !== false, input.userId || null];
  let id = input.id;
  if (id) {
    await q(`UPDATE staff SET full_name=$2, role=$3, phone=$4, is_manager=$5, can_use_pos=$6, monthly_target_hours=$7, hourly_rate_cents=$8, daily_rate_cents=$9, active=$10, user_id=$11,
             pin_hash=COALESCE($12, pin_hash), can_take_cash=$13, updated_at=now() WHERE id=$1`, [id, ...vals, pinHash, !!input.canTakeCash]);
  } else {
    id = (await q<any>(`INSERT INTO staff(full_name,role,phone,is_manager,can_use_pos,monthly_target_hours,hourly_rate_cents,daily_rate_cents,active,user_id,pin_hash,can_take_cash)
                        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [...vals, pinHash, !!input.canTakeCash]))[0].id;
  }
  await audit(actor, input.id ? 'staff.update' : 'staff.create', 'staff', id!, { name: input.fullName, pinChanged: !!input.pin });
  return id!;
}

/** Check a PIN for one staff member. Small delay on failure discourages guessing. */
export async function verifyPin(staffId: string, pin: string): Promise<Staff | null> {
  const row = (await q<any>(`SELECT ${PUBLIC_COLS}, pin_hash FROM staff WHERE id=$1 AND active`, [staffId]))[0];
  if (!row?.pin_hash || !/^\d{4,6}$/.test(pin || '')) { await new Promise((r) => setTimeout(r, 400)); return null; }
  const ok = await bcrypt.compare(pin, row.pin_hash);
  if (!ok) { await new Promise((r) => setTimeout(r, 400)); return null; }
  const { pin_hash: _ph, ...s } = row;
  return s as Staff;
}

/* ───────── Roster ───────── */

export async function shiftTypes() {
  return q<{ code: string; label: string; start_time: string | null; end_time: string | null; is_off: boolean }>(`SELECT * FROM shift_types ORDER BY sort_order`);
}

export async function rosterRange(from: string, to: string) {
  return q<any>(`SELECT r.*, st.label, st.is_off FROM staff_roster r JOIN shift_types st ON st.code=r.shift_code WHERE r.work_date BETWEEN $1 AND $2`, [from, to]);
}

export async function setRoster(staffId: string, workDate: string, shiftCode: string, userId: string, times?: { start?: string | null; end?: string | null; note?: string | null }) {
  if (shiftCode === '') { await q(`DELETE FROM staff_roster WHERE staff_id=$1 AND work_date=$2`, [staffId, workDate]); return; }
  const st = (await q<any>(`SELECT * FROM shift_types WHERE code=$1`, [shiftCode]))[0];
  if (!st) throw new BookingError('INVALID_INPUT', 'Unknown shift');
  const hhmm = (v?: string | null) => (v && /^\d{2}:\d{2}$/.test(v) ? v : null);
  await q(`INSERT INTO staff_roster(staff_id,work_date,shift_code,start_time,end_time,note,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (staff_id,work_date) DO UPDATE SET shift_code=EXCLUDED.shift_code, start_time=EXCLUDED.start_time, end_time=EXCLUDED.end_time, note=EXCLUDED.note, updated_by=EXCLUDED.updated_by, updated_at=now()`,
    [staffId, workDate, shiftCode, st.is_off ? null : hhmm(times?.start) ?? st.start_time, st.is_off ? null : hhmm(times?.end) ?? st.end_time, times?.note ?? null, userId]);
}

/** Copy one week of roster onto the next N weeks (only fills empty days). */
export async function copyWeek(fromMonday: string, weeks: number, userId: string) {
  for (let w = 1; w <= weeks; w++) {
    await q(`INSERT INTO staff_roster(staff_id,work_date,shift_code,start_time,end_time,note,updated_by)
             SELECT staff_id, work_date + $2::int, shift_code, start_time, end_time, note, $3 FROM staff_roster
             WHERE work_date >= $1::date AND work_date < $1::date + 7 ON CONFLICT (staff_id,work_date) DO NOTHING`, [fromMonday, 7 * w, userId]);
  }
}

/** The scheduled shift that covers `now` for this staff member (today's, or last night's overnight shift). */
async function scheduledShift(c: Q, staffId: string, now: Date) {
  const today = todayLocal(now);
  const rows = (await c.query(`SELECT * FROM staff_roster WHERE staff_id=$1 AND work_date IN ($2::date, $3::date) AND shift_code <> 'OFF' AND start_time IS NOT NULL ORDER BY work_date DESC`, [staffId, today, addDays(today, -1)])).rows;
  const cands = rows.map((r: any) => {
    const start = zonedToUtc(r.work_date, r.start_time);
    let end = zonedToUtc(r.work_date, r.end_time || r.start_time);
    if (end <= start) end = new Date(end.getTime() + 86400000); // overnight
    return { roster: r, start, end };
  });
  // The shift whose window (from 4h before start until its end) contains now; e.g. 02:00 belongs to last night's 23:00 shift.
  const inWindow = cands.find((x) => now.getTime() >= x.start.getTime() - 4 * 3600e3 && now < x.end);
  return inWindow ?? cands.find((x) => x.roster.work_date === today) ?? null;
}

/* ───────── Clock in / out ───────── */

export async function clockIn(staffId: string, opts: { cashShiftId?: string | null; source?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const policy = await latenessPolicy();
  const result = await tx(async (c) => {
    const cq = c as unknown as Q;
    const s = (await c.query(`SELECT * FROM staff WHERE id=$1 AND active FOR UPDATE`, [staffId])).rows[0];
    if (!s) throw new BookingError('NOT_FOUND', 'staff');
    const open = (await c.query(`SELECT * FROM staff_attendance WHERE staff_id=$1 AND clock_out_at IS NULL`, [staffId])).rows[0];
    if (open) {
      if (opts.cashShiftId && !open.cash_shift_id) await c.query(`UPDATE staff_attendance SET cash_shift_id=$2 WHERE id=$1`, [open.id, opts.cashShiftId]);
      return { attendance: open, alreadyIn: true, staff: s };
    }
    const sch = await scheduledShift(cq, staffId, now);
    const delayMs = sch ? Math.max(0, now.getTime() - sch.start.getTime()) : 0;
    const daily = Number(s.daily_rate_cents) || Math.round(Number(s.hourly_rate_cents) * 8);
    const L = sch ? lateness(delayMs, policy, daily) : { minutes: 0, tier: 0, deductionCents: 0, alert: false };
    const att = (await c.query(
      `INSERT INTO staff_attendance(staff_id,work_date,roster_id,shift_code,scheduled_start,scheduled_end,clock_in_at,delay_ms,delay_minutes,tier,deduction_cents,cash_shift_id,source)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [staffId, sch?.roster.work_date ?? todayLocal(now), sch?.roster.id ?? null, sch?.roster.shift_code ?? null, sch?.start ?? null, sch?.end ?? null, now,
        delayMs, L.minutes, L.tier, L.deductionCents, opts.cashShiftId ?? null, opts.source ?? 'pos'])).rows[0];
    if (L.tier >= 1) {
      await c.query(`INSERT INTO tasks(title,detail,kind,dedupe_key) VALUES($1,$2,'general',$3) ON CONFLICT (dedupe_key) DO NOTHING`,
        [`${s.full_name} was ${L.minutes} min late`, `Scheduled shift at ${sch?.roster.start_time}. Deduction ${(L.deductionCents / 100).toFixed(0)} EGP. Forgive it in Team → Attendance if excused.`, 'late:' + att.id]);
    }
    await audit('pos', 'staff.clock_in', 'staff', staffId, { delayMinutes: L.minutes, tier: L.tier }, cq);
    return { attendance: att, alreadyIn: false, staff: s, alert: L.alert, minutes: L.minutes };
  });
  if ((result as any).alert) notifyStaff(`Attendance alert: ${result.staff.full_name} clocked in ${(result as any).minutes} minutes late (full-day deduction).`).catch(() => {});
  return result;
}

export async function clockOut(staffId: string, now: Date = new Date()) {
  const r = await q<any>(`UPDATE staff_attendance SET clock_out_at=$2 WHERE staff_id=$1 AND clock_out_at IS NULL RETURNING *`, [staffId, now]);
  if (r[0]) await audit('pos', 'staff.clock_out', 'staff', staffId, {});
  return r[0] ?? null;
}

export async function waiveDeduction(attendanceId: string, reason: string, userId: string, actor: string) {
  if (!reason?.trim()) throw new BookingError('INVALID_INPUT', 'A reason is required to waive a deduction');
  const r = await q(`UPDATE staff_attendance SET waived=true, waived_by=$2, waive_reason=$3, waived_at=now() WHERE id=$1 AND NOT waived RETURNING staff_id`, [attendanceId, userId, reason.trim()]);
  if (!r.length) throw new BookingError('BAD_STATE');
  await audit(actor, 'staff.waive_deduction', 'staff_attendance', attendanceId, { reason });
}

export async function attendanceList(from: string, to: string, staffId?: string) {
  return q<any>(`SELECT a.*, s.full_name, u.name waived_by_name,
      EXTRACT(EPOCH FROM (COALESCE(a.clock_out_at, now()) - a.clock_in_at))/3600.0 AS hours
    FROM staff_attendance a JOIN staff s ON s.id=a.staff_id LEFT JOIN users u ON u.id=a.waived_by
    WHERE a.work_date BETWEEN $1 AND $2 AND ($3::uuid IS NULL OR a.staff_id=$3)
    ORDER BY a.clock_in_at DESC`, [from, to, staffId ?? null]);
}

/** Monthly timesheet: target vs scheduled vs worked, lateness and deductions. month = 'YYYY-MM'. */
export async function monthlyTimesheet(month: string) {
  const from = `${month}-01`;
  const d = new Date(from + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1);
  const to = d.toISOString().slice(0, 10); // exclusive
  return q<any>(`
    SELECT s.id, s.full_name, s.role, s.monthly_target_hours::float target_hours,
      COALESCE(sch.hours, 0)::float scheduled_hours,
      COALESCE(w.hours, 0)::float worked_hours,
      COALESCE(w.shifts, 0)::int shifts_worked,
      COALESCE(w.late_minutes, 0)::int late_minutes,
      COALESCE(w.late_count, 0)::int late_count,
      COALESCE(w.deductions, 0)::bigint deductions_cents,
      COALESCE(w.waived, 0)::bigint waived_cents,
      COALESCE(w.open_now, 0)::int open_now,
      (SELECT COALESCE(string_agg(cs.currency || ' ' || (cs.amount_minor / 100.0)::text, ' · '), '') FROM cash_shortages cs
        WHERE cs.staff_id=s.id AND cs.status='salary' AND cs.created_at >= $1::date AND cs.created_at < $2::date) salary_shortages
    FROM staff s
    LEFT JOIN LATERAL (
      SELECT sum(
        CASE WHEN r.start_time IS NULL THEN 0 ELSE
          ((EXTRACT(EPOCH FROM (r.end_time::time - r.start_time::time)) / 3600.0) + CASE WHEN r.end_time::time <= r.start_time::time THEN 24 ELSE 0 END) END) hours
      FROM staff_roster r WHERE r.staff_id=s.id AND r.work_date >= $1::date AND r.work_date < $2::date AND r.shift_code <> 'OFF'
    ) sch ON true
    LEFT JOIN LATERAL (
      SELECT sum(EXTRACT(EPOCH FROM (a.clock_out_at - a.clock_in_at)) / 3600.0) FILTER (WHERE a.clock_out_at IS NOT NULL) hours,
             count(*) shifts,
             sum(a.delay_minutes) FILTER (WHERE a.tier > 0) late_minutes,
             count(*) FILTER (WHERE a.tier > 0) late_count,
             sum(a.deduction_cents) FILTER (WHERE NOT a.waived) deductions,
             sum(a.deduction_cents) FILTER (WHERE a.waived) waived,
             count(*) FILTER (WHERE a.clock_out_at IS NULL) open_now
      FROM staff_attendance a WHERE a.staff_id=s.id AND a.work_date >= $1::date AND a.work_date < $2::date
    ) w ON true
    WHERE s.active OR w.shifts > 0
    ORDER BY s.full_name`, [from, to]);
}

export async function onShiftNow() {
  return q<any>(`SELECT a.*, s.full_name, s.role FROM staff_attendance a JOIN staff s ON s.id=a.staff_id WHERE a.clock_out_at IS NULL ORDER BY a.clock_in_at`);
}

/* ───────── POS: my shift today and who works with me ───────── */

const cairoAt = (date: string, hhmm: string) => zonedToUtc(date, hhmm);
const addDay = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

export type ShiftSlot = { staffId: string; name: string; label: string; start: string; end: string; startAt: string; endAt: string; clockIn: string | null; clockOut: string | null };

/**
 * The rostered shift of a staff member around now (yesterday's night shift included), their clock-in, and the
 * other people rostered in an overlapping window — with when they start and whether they are in yet.
 */
export async function myShiftInfo(staffId: string, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(now);
  const rows = await q<any>(`
    SELECT r.staff_id, s.full_name name, r.work_date::text d, r.shift_code, COALESCE(r.start_time, st.start_time) st, COALESCE(r.end_time, st.end_time) et, st.label,
      (SELECT a.clock_in_at FROM staff_attendance a WHERE a.staff_id=r.staff_id AND a.work_date=r.work_date ORDER BY a.clock_in_at DESC LIMIT 1) clock_in,
      (SELECT a.clock_out_at FROM staff_attendance a WHERE a.staff_id=r.staff_id AND a.work_date=r.work_date ORDER BY a.clock_in_at DESC LIMIT 1) clock_out
    FROM staff_roster r JOIN staff s ON s.id=r.staff_id AND s.active LEFT JOIN shift_types st ON st.code=r.shift_code
    WHERE r.work_date BETWEEN $1::date - 1 AND $1::date + 1 AND COALESCE(st.is_off, false) = false AND COALESCE(r.start_time, st.start_time) IS NOT NULL`, [today]).catch(() => []);
  const slots: ShiftSlot[] = rows.map((r) => {
    const startAt = cairoAt(r.d, r.st);
    let endAt = cairoAt(r.d, r.et);
    if (endAt <= startAt) endAt = cairoAt(addDay(r.d, 1), r.et); // ends after midnight
    return { staffId: r.staff_id, name: r.name, label: r.label ?? r.shift_code, start: r.st, end: r.et, startAt: startAt.toISOString(), endAt: endAt.toISOString(), clockIn: r.clock_in ? new Date(r.clock_in).toISOString() : null, clockOut: r.clock_out ? new Date(r.clock_out).toISOString() : null };
  });
  // My slot: the one I'm clocked in on, else the one running now, else my next one today.
  const mine = slots.filter((s) => s.staffId === staffId);
  const t = now.getTime();
  const me = mine.find((s) => s.clockIn && !s.clockOut) ?? mine.find((s) => Date.parse(s.startAt) - 2 * 3600e3 <= t && t <= Date.parse(s.endAt) + 4 * 3600e3) ?? mine.filter((s) => Date.parse(s.startAt) > t).sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null;
  const from = me ? Date.parse(me.startAt) : t, to = me ? Date.parse(me.endAt) : t + 8 * 3600e3;
  const team = slots.filter((s) => s.staffId !== staffId && Date.parse(s.startAt) < to && Date.parse(s.endAt) > from).sort((a, b) => a.startAt.localeCompare(b.startAt));
  let late = 0, overtime = 0;
  if (me?.clockIn) {
    late = Math.max(0, Math.round((Date.parse(me.clockIn) - Date.parse(me.startAt)) / 60000));
    const outAt = me.clockOut ? Date.parse(me.clockOut) : t;
    overtime = Math.max(0, Math.round((outAt - Date.parse(me.endAt)) / 60000));
  }
  return { me, team, late, overtime, now: now.toISOString() };
}
