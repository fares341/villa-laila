import { q, tx, pool } from '@/lib/db';
import type { Q } from '@/lib/db';
import { todayLocal, zonedToUtc, addDays } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { t, type Lang } from '@/i18n/bot';
import { env } from '@/lib/env';

export const STAFF_KINDS = ['staff_unreviewed', 'inquiry_unanswered', 'escalation_unattended'];

/** Idempotent: the same dedupe_key can never create a second row. */
export async function schedule(kind: string, runAt: Date, dedupeKey: string, refs: { conversationId?: string | null; reservationId?: string | null; guestId?: string | null }, c?: Q) {
  const run = c ?? (pool() as unknown as Q);
  await run.query(
    `INSERT INTO scheduled_messages(kind,conversation_id,reservation_id,guest_id,run_at,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [kind, refs.conversationId ?? null, refs.reservationId ?? null, refs.guestId ?? null, runAt, dedupeKey]);
}

/** Move an existing pending follow-up later (used when the guest is still active) — or create it. */
export async function reschedule(kind: string, runAt: Date, dedupeKey: string, refs: { conversationId?: string | null; reservationId?: string | null; guestId?: string | null }) {
  const r = await q(`UPDATE scheduled_messages SET run_at=$2 WHERE dedupe_key=$1 AND status='pending' RETURNING id`, [dedupeKey, runAt]);
  if (!r[0]) await schedule(kind, runAt, dedupeKey, refs);
}

export async function cancelFollowups(f: { reservationId?: string; conversationId?: string; kinds?: string[] }) {
  await q(
    `UPDATE scheduled_messages SET status='cancelled', skip_reason='no longer relevant' WHERE status='pending'
       AND ($1::uuid IS NULL OR reservation_id=$1) AND ($2::uuid IS NULL OR conversation_id=$2) AND ($3::text[] IS NULL OR kind = ANY($3))
       AND ($1::uuid IS NOT NULL OR $2::uuid IS NOT NULL)`,
    [f.reservationId ?? null, f.conversationId ?? null, f.kinds ?? null]);
}

const minutes = (m: number) => new Date(Date.now() + m * 60_000);

/** Derive every time-based follow-up from the CURRENT database state. Safe to run every minute (idempotent). */
export async function scanAndSchedule() {
  const rules = Object.fromEntries((await q<any>('SELECT * FROM automation_rules WHERE enabled')).map((r) => [r.kind, r]));
  const today = todayLocal();

  if (rules.pending_reminder || rules.staff_unreviewed) {
    const pend = await q<any>(`SELECT id, guest_id, created_at, needs_review FROM reservations WHERE status IN ('pending','hold')`);
    for (const r of pend) {
      if (rules.pending_reminder) await schedule('pending_reminder', new Date(+new Date(r.created_at) + rules.pending_reminder.delay_minutes * 60_000), `pending_reminder:${r.id}`, { reservationId: r.id, guestId: r.guest_id });
      if (rules.staff_unreviewed) await schedule('staff_unreviewed', new Date(+new Date(r.created_at) + rules.staff_unreviewed.delay_minutes * 60_000), `staff_unreviewed:${r.id}`, { reservationId: r.id, guestId: r.guest_id });
    }
  }
  const upcoming = await q<any>(`SELECT id, guest_id, check_in, check_out, status FROM reservations WHERE status IN ('confirmed','checked_in') AND check_out >= $1`, [today]);
  for (const r of upcoming) {
    if (r.status === 'confirmed' && r.check_in >= today) {
      if (rules.pre_arrival) await schedule('pre_arrival', new Date(+zonedToUtc(r.check_in, '10:00') - rules.pre_arrival.delay_minutes * 60_000), `pre_arrival:${r.id}:${r.check_in}`, { reservationId: r.id, guestId: r.guest_id });
      if (rules.checkin_reminder) await schedule('checkin_reminder', new Date(+zonedToUtc(r.check_in, '08:00') - rules.checkin_reminder.delay_minutes * 60_000), `checkin:${r.id}:${r.check_in}`, { reservationId: r.id, guestId: r.guest_id });
    }
    if (rules.checkout_reminder) await schedule('checkout_reminder', new Date(+zonedToUtc(r.check_out, '08:00') - rules.checkout_reminder.delay_minutes * 60_000), `checkout:${r.id}:${r.check_out}`, { reservationId: r.id, guestId: r.guest_id });
  }
  if (rules.payment_followup) {
    const due = await q<any>(`SELECT id, guest_id, created_at FROM reservations WHERE status IN ('confirmed','checked_in') AND check_out >= $1`, [today]);
    for (const r of due) await schedule('payment_followup', new Date(+new Date(r.created_at) + rules.payment_followup.delay_minutes * 60_000), `payment_followup:${r.id}`, { reservationId: r.id, guestId: r.guest_id });
  }
  if (rules.extension_followup) {
    for (const e of await q<any>(`SELECT e.id, e.reservation_id, e.created_at, r.guest_id FROM extension_requests e JOIN reservations r ON r.id=e.reservation_id WHERE e.status IN ('pending','conflict')`))
      await schedule('extension_followup', new Date(+new Date(e.created_at) + rules.extension_followup.delay_minutes * 60_000), `extension_followup:${e.id}`, { reservationId: e.reservation_id, guestId: e.guest_id });
  }
  for (const k of ['inquiry_unanswered', 'escalation_unattended'] as const) {
    if (!rules[k]) continue;
    for (const cv of await q<any>(`SELECT id, escalated_at, last_guest_message_at FROM conversations WHERE status='needs_staff'`)) {
      const base = k === 'escalation_unattended' ? cv.escalated_at : cv.last_guest_message_at;
      if (!base) continue;
      await schedule(k, new Date(+new Date(base) + rules[k].delay_minutes * 60_000), `${k}:${cv.id}:${new Date(base).getTime()}`, { conversationId: cv.id });
    }
  }
}

type Decision = { send: false; reason: string } | { send: true; conversationId: string | null; text: string; staff?: boolean; kb?: any };

async function findConversation(guestId: string | null, conversationId: string | null): Promise<any | null> {
  if (conversationId) return (await q('SELECT * FROM conversations WHERE id=$1', [conversationId]))[0] ?? null;
  if (!guestId) return null;
  return (await q(`SELECT * FROM conversations WHERE guest_id=$1 AND channel='telegram' ORDER BY updated_at DESC LIMIT 1`, [guestId]))[0] ?? null;
}

async function decide(row: any): Promise<Decision> {
  const kind: string = row.kind;
  const rule = (await q<any>('SELECT * FROM automation_rules WHERE kind=$1', [kind]))[0];
  if (!rule?.enabled) return { send: false, reason: 'rule disabled' };
  const today = todayLocal();

  // ---- staff-facing alerts
  if (STAFF_KINDS.includes(kind)) {
    if (kind === 'staff_unreviewed') {
      const r = (await q<any>(`SELECT reference, status FROM reservations WHERE id=$1`, [row.reservation_id]))[0];
      if (!r || !['pending', 'hold'].includes(r.status)) return { send: false, reason: 'already reviewed' };
      await q(`INSERT INTO tasks(title,detail,kind,reservation_id,dedupe_key) VALUES($1,$2,'review_booking',$3,$4) ON CONFLICT (dedupe_key) DO NOTHING`, [`Request ${r.reference} still unreviewed`, 'Past the review deadline', row.reservation_id, 'unreviewed:' + row.reservation_id]);
      return { send: true, conversationId: null, staff: true, text: `⏰ Booking request ${r.reference} has not been reviewed yet.` };
    }
    const cv = (await q<any>('SELECT * FROM conversations WHERE id=$1', [row.conversation_id]))[0];
    if (!cv || cv.status !== 'needs_staff') return { send: false, reason: 'conversation resolved' };
    if (kind === 'escalation_unattended' && cv.assigned_to) return { send: false, reason: 'already assigned' };
    if (kind === 'inquiry_unanswered') {
      const lastOut = (await q<any>(`SELECT max(created_at) m FROM messages WHERE conversation_id=$1 AND direction='out' AND sender='staff'`, [cv.id]))[0]?.m;
      if (lastOut && cv.last_guest_message_at && new Date(lastOut) > new Date(cv.last_guest_message_at)) return { send: false, reason: 'staff replied' };
    }
    return { send: true, conversationId: null, staff: true, text: `⏰ A guest conversation is waiting for reception (${cv.escalation_reason ?? 'needs help'}).` };
  }

  // ---- guest-facing
  const guest = row.guest_id ? (await q<any>('SELECT * FROM guests WHERE id=$1', [row.guest_id]))[0] : null;
  if (guest?.opted_out) return { send: false, reason: 'guest opted out' };
  const conv = await findConversation(row.guest_id, row.conversation_id);
  if (!conv) return { send: false, reason: 'no chat channel for this guest' };
  if (conv.mode === 'human') return { send: false, reason: 'staff has taken over' };
  const lang = (conv.language ?? guest?.language ?? 'en') as Lang;

  if (kind === 'incomplete_booking') {
    if (conv.flow !== 'booking') return { send: false, reason: 'booking flow no longer active' };
    return { send: true, conversationId: conv.id, text: t(lang, 'fu_incomplete'), kb: { inline: [[{ text: t(lang, 'btn_continue'), data: 'a:resume' }]] } };
  }
  const res = row.reservation_id ? (await q<any>(`SELECT r.*, folio_charges(r.id)::bigint charges_cents, COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.reservation_id=r.id AND p.status='verified'),0)::bigint paid FROM reservations r WHERE r.id=$1`, [row.reservation_id]))[0] : null;
  if (!res) return { send: false, reason: 'reservation missing' };
  const vars = { ref: res.reference, checkin: res.check_in, checkout: res.check_out, balance: fmtMoney(res.charges_cents - res.paid, res.currency) };
  const keyDate = row.dedupe_key.split(':')[2];

  switch (kind) {
    case 'pending_reminder': return ['pending', 'hold'].includes(res.status) ? { send: true, conversationId: conv.id, text: t(lang, 'fu_pending_reminder', vars) } : { send: false, reason: `reservation is ${res.status}` };
    case 'payment_followup': return ['confirmed', 'checked_in'].includes(res.status) && res.charges_cents - res.paid > 0 ? { send: true, conversationId: conv.id, text: t(lang, 'fu_payment', vars) } : { send: false, reason: 'nothing due or not active' };
    case 'pre_arrival': return res.status === 'confirmed' && res.check_in === keyDate && res.check_in >= today ? { send: true, conversationId: conv.id, text: t(lang, 'fu_pre_arrival', vars) } : { send: false, reason: 'stale or not confirmed' };
    case 'checkin_reminder': return res.status === 'confirmed' && res.check_in === keyDate ? { send: true, conversationId: conv.id, text: t(lang, 'fu_checkin', vars) } : { send: false, reason: 'stale or not confirmed' };
    case 'checkout_reminder': return ['confirmed', 'checked_in'].includes(res.status) && res.check_out === keyDate ? { send: true, conversationId: conv.id, text: t(lang, 'fu_checkout', vars) } : { send: false, reason: 'stale or not active' };
    case 'extension_followup': {
      const e = (await q<any>(`SELECT 1 FROM extension_requests WHERE reservation_id=$1 AND status IN ('pending','conflict')`, [res.id]))[0];
      return e ? { send: true, conversationId: conv.id, text: t(lang, 'fu_extension', vars) } : { send: false, reason: 'extension decided' };
    }
    case 'expiry_notice': return res.status === 'expired' ? { send: true, conversationId: conv.id, text: t(lang, 'expired_notice', vars) } : { send: false, reason: 'not expired' };
  }
  return { send: false, reason: 'unknown kind' };
}

/** Process due follow-ups: re-check live state, rate-limit, send, log, retry. */
export async function runDue(sender: (conv: any, text: string, kb?: any) => Promise<boolean>, staffNotifier: (text: string) => Promise<void>) {
  const rows = await tx(async (c) => (await c.query(`SELECT * FROM scheduled_messages WHERE status='pending' AND run_at <= now() ORDER BY run_at LIMIT 25 FOR UPDATE SKIP LOCKED`)).rows);
  for (const row of rows) {
    // claim: bump attempts first so a crash can't loop forever
    const claimed = (await q<any>(`UPDATE scheduled_messages SET attempts=attempts+1 WHERE id=$1 AND status='pending' RETURNING attempts`, [row.id]))[0];
    if (!claimed) continue;
    const rule = (await q<any>('SELECT * FROM automation_rules WHERE kind=$1', [row.kind]))[0];
    try {
      const d = await decide(row);
      if (!d.send) { await q(`UPDATE scheduled_messages SET status='skipped', skip_reason=$2 WHERE id=$1`, [row.id, d.reason]); continue; }
      if (d.staff) { await staffNotifier(d.text); await q(`UPDATE scheduled_messages SET status='sent', sent_at=now() WHERE id=$1`, [row.id]); continue; }
      if (row.guest_id && rule) {
        const n = (await q<any>(`SELECT count(*)::int n FROM scheduled_messages WHERE guest_id=$1 AND status='sent' AND sent_at > now() - interval '24 hours' AND kind <> ALL($2::text[])`, [row.guest_id, STAFF_KINDS]))[0].n;
        if (n >= rule.max_per_day) { await q(`UPDATE scheduled_messages SET status='skipped', skip_reason='daily message limit reached' WHERE id=$1`, [row.id]); continue; }
      }
      const conv = (await q<any>('SELECT * FROM conversations WHERE id=$1', [d.conversationId]))[0];
      const ok = await sender(conv, d.text, d.kb);
      await q(ok ? `UPDATE scheduled_messages SET status='sent', sent_at=now(), last_error=NULL WHERE id=$1` : `UPDATE scheduled_messages SET status='skipped', skip_reason='staff took over before send' WHERE id=$1`, [row.id]);
    } catch (e) {
      const max = rule?.max_attempts ?? 3;
      if (claimed.attempts >= max) await q(`UPDATE scheduled_messages SET status='failed', last_error=$2 WHERE id=$1`, [row.id, (e as Error).message]);
      else await q(`UPDATE scheduled_messages SET run_at=now() + ($3 || ' minutes')::interval, last_error=$2 WHERE id=$1`, [row.id, (e as Error).message, String(rule?.retry_minutes ?? 15)]);
    }
  }
  return rows.length;
}
