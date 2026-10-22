import { q, tx } from '@/lib/db';
import { BookingError } from './errors';
import { audit } from './audit';
import { cancelEventBooking, seatsTaken, tr, EVENT_COLS, type EventRow } from './events';
import { decideInstapay } from './online-payments';
import { isBookableDate, timeLabel, dateLabel } from '@/lib/event-dates';
import { env } from '@/lib/env';
import { sendWhatsApp, normalizePhone, getWhatsAppConfig, type WaResult } from './whatsapp';
import { walletLabel } from './wallets';
import type { Q } from '@/lib/db';

/**
 * Booking actions shared by the dashboard and the Telegram admin bot, so a booking confirmed or cancelled in one
 * place is the same booking everywhere (ticket page, door check-in, reports).
 */

export async function bookingDetail(id: string) {
  const b = (await q<any>(`
    SELECT b.*, e.title, e.slug, e.start_time, e.end_time, e.options, e.capacity, e.price_cents ev_price, e.guest_price_cents ev_guest_price,
      (SELECT op.id FROM online_payments op WHERE op.event_booking_id=b.id AND op.provider IN ('instapay','vodafone_cash') AND op.status='submitted' ORDER BY op.created_at DESC LIMIT 1) proof_id
    FROM event_bookings b JOIN events e ON e.id=b.event_id WHERE b.id=$1`, [id]))[0];
  if (!b) throw new BookingError('NOT_FOUND');
  return b;
}

// The worker has no request to read the host from, so PUBLIC_BASE_URL is used first.
const base = async () => {
  if (env.baseUrl) return env.baseUrl.replace(/\/+$/, '');
  try { const { siteBase } = await import('@/lib/base-url'); return await siteBase(); } catch { return ''; }
};
export const ticketUrl = async (b: { language?: string; ticket_code: string }) => `${await base()}/${b.language === 'ar' ? 'ar' : 'en'}/tickets/${b.ticket_code}`;

const STATUS_AR: Record<string, string> = {
  paid: 'مدفوع', pay_on_site: 'محجوز · الدفع في المكان', pending_verification: 'إيصال مستني مراجعة', awaiting_payment: 'مستني الدفع', expired: 'انتهى', cancelled: 'ملغي',
};
const money = (c: number, cur: string) => `${(Number(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur}`;

/** Booking summary for the owner's Telegram (Arabic). */
export function bookingText(b: any, head = 'حجز فعالية'): string {
  const opt = b.option_key ? (b.options ?? []).find((o: any) => o.key === b.option_key) : null;
  return [
    `${head} · ${b.ticket_code}`,
    `${tr(b.title, 'ar')}`,
    `التاريخ: ${b.event_date} · ${b.start_time}–${b.end_time}`,
    `العدد: ${b.quantity}${opt ? ` · ${opt.ar || opt.en}` : ''}${b.is_hotel_guest ? ` · نزيل (${b.stay_reference})` : ''}`,
    `الاسم: ${b.full_name}`,
    `الموبايل: ${b.phone || '—'}`,
    `الإيميل: ${b.email}`,
    `الإجمالي: ${money(b.total_cents, b.currency)} · ${b.pay_method === 'cash' ? 'كاش في المكان' : b.pay_method === 'paymob' ? 'بطاقة (Paymob)' : walletLabel(b.pay_method, true)}`,
    `الحالة: ${STATUS_AR[b.status] ?? b.status}${b.confirmed_at && b.status !== 'cancelled' ? ' · متأكد' : ''}${b.attendance_confirmed_at ? ' · أكد الحضور' : ''}`,
    b.cancel_reason ? `سبب الإلغاء: ${b.cancel_reason}` : '',
  ].filter(Boolean).join('\n');
}

/* ───────── Messages to the guest ───────── */

async function guestText(kind: 'confirm' | 'cancel' | 'reminder', b: any, reason?: string | null) {
  const ar = b.language === 'ar';
  const name = String(b.full_name).split(/\s+/)[0];
  const title = tr(b.title, ar ? 'ar' : 'en');
  const when = `${dateLabel(b.event_date, ar ? 'ar' : 'en', { weekday: 'long', day: 'numeric', month: 'long' })} · ${timeLabel(b.start_time, ar ? 'ar' : 'en')}`;
  const link = await ticketUrl(b);
  if (kind === 'confirm') return ar
    ? `أهلاً ${name}، حجزك في "${title}" يوم ${when} اتأكد. عدد الأشخاص: ${b.quantity}. تذكرتك: ${link}\nفيلا ليلى`
    : `Hi ${name}, your booking for "${title}" on ${when} is confirmed. People: ${b.quantity}. Your ticket: ${link}\nVilla Layla`;
  if (kind === 'cancel') return ar
    ? `أهلاً ${name}، للأسف اتلغى حجزك في "${title}" يوم ${when} (كود ${b.ticket_code}).${reason ? ` السبب: ${reason}.` : ''} لو عندك أي سؤال رد علينا هنا.\nفيلا ليلى`
    : `Hi ${name}, your booking for "${title}" on ${when} (code ${b.ticket_code}) has been cancelled.${reason ? ` Reason: ${reason}.` : ''} Reply here if you have any question.\nVilla Layla`;
  return ar
    ? `أهلاً ${name}، فاضل ساعة على "${title}" (${timeLabel(b.start_time, 'ar')}) في فيلا ليلى. من فضلك أكد حضورك من هنا: ${link}?attend=1`
    : `Hi ${name}, "${title}" at Villa Layla starts in about an hour (${timeLabel(b.start_time, 'en')}). Please confirm you are coming: ${link}?attend=1`;
}

async function sendGuest(kind: 'confirm' | 'cancel' | 'reminder', b: any, reason?: string | null): Promise<WaResult> {
  const text = await guestText(kind, b, reason);
  const cfg = await getWhatsAppConfig();
  const tpl = kind === 'reminder' ? cfg.template_reminder : kind === 'cancel' ? cfg.template_cancel : cfg.template_confirm;
  const ar = b.language === 'ar';
  const params = [String(b.full_name).split(/\s+/)[0], tr(b.title, ar ? 'ar' : 'en'), `${b.event_date} ${b.start_time}`, await ticketUrl(b)];
  return sendWhatsApp(b.phone, text, tpl ? { name: tpl, params } : undefined);
}

/* ───────── Actions ───────── */

/**
 * Owner confirms a booking. A waiting receipt is approved (ticket becomes paid); a booking without payment yet is
 * kept as "pay at the villa". The guest gets the confirmation on WhatsApp.
 */
export async function confirmEventBookingAdmin(id: string, actor: string, staffUserId: string | null = null): Promise<{ b: any; wa: WaResult }> {
  let b = await bookingDetail(id);
  if (['cancelled', 'expired'].includes(b.status)) throw new BookingError('BAD_STATE', 'This booking is ' + b.status);
  if (b.status === 'pending_verification' && b.proof_id) return approveProofAdmin(b.proof_id, actor, staffUserId);
  await q(`UPDATE event_bookings SET confirmed_at=now(), confirmed_by=$2, hold_expires_at=NULL,
             status=CASE WHEN status IN ('awaiting_payment','pending_verification') THEN 'pay_on_site' ELSE status END, updated_at=now() WHERE id=$1`, [id, actor]);
  await audit(actor, 'event_booking.confirm', 'event_booking', id);
  b = await bookingDetail(id);
  return { b, wa: await sendGuest('confirm', b) };
}

export async function cancelEventBookingAdmin(id: string, actor: string, reason: string | null = null): Promise<{ b: any; wa: WaResult }> {
  await cancelEventBooking(id, actor);
  await q(`UPDATE event_bookings SET cancel_reason=$2 WHERE id=$1`, [id, reason]);
  await q(`UPDATE online_payments SET status='rejected', updated_at=now() WHERE event_booking_id=$1 AND status='submitted'`, [id]);
  const b = await bookingDetail(id);
  return { b, wa: await sendGuest('cancel', b, reason) };
}

/**
 * The receipt (InstaPay / Vodafone Cash) was checked in the app and the money is there: the booking becomes
 * paid and confirmed, and the guest gets the confirmation. Used by the Telegram bot and the dashboard.
 */
export async function approveProofAdmin(onlinePaymentId: string, actor: string, staffUserId: string | null = null) {
  const op = (await q<any>(`SELECT event_booking_id, reservation_id, kind FROM online_payments WHERE id=$1`, [onlinePaymentId]))[0];
  if (!op) throw new BookingError('NOT_FOUND');
  await decideInstapay(onlinePaymentId, true, staffUserId as any, actor);
  if (op.kind !== 'event') return { b: null, wa: { sent: false, link: null } as WaResult };
  await q(`UPDATE event_bookings SET confirmed_at=COALESCE(confirmed_at, now()), confirmed_by=COALESCE(confirmed_by, $2) WHERE id=$1`, [op.event_booking_id, actor]);
  const b = await bookingDetail(op.event_booking_id);
  return { b, wa: await sendGuest('confirm', b) };
}

/** The money is not there: the guest can send the receipt again (the booking waits 12 more hours). */
export async function rejectProofAdmin(onlinePaymentId: string, actor: string, staffUserId: string | null = null) {
  const op = (await q<any>(`SELECT event_booking_id FROM online_payments WHERE id=$1`, [onlinePaymentId]))[0];
  await decideInstapay(onlinePaymentId, false, staffUserId as any, actor);
  return op?.event_booking_id ? bookingDetail(op.event_booking_id) : null;
}

export async function confirmAttendance(code: string) {
  const r = await q<any>(`UPDATE event_bookings SET attendance_confirmed_at=COALESCE(attendance_confirmed_at, now()), updated_at=now()
                          WHERE ticket_code=$1 AND status IN ('paid','pay_on_site','pending_verification') RETURNING id, (attendance_confirmed_at = updated_at) fresh`, [code]);
  if (!r.length) throw new BookingError('BAD_STATE');
  const { notifyAttendance } = await import('./admin-bot');
  await notifyAttendance(r[0].id).catch(() => {});
}

/** Change a booking from the admin bot. Date and quantity re-check the seats; quantity re-prices the booking. */
export async function updateEventBooking(id: string, field: 'date' | 'quantity' | 'full_name' | 'phone' | 'email', value: string, actor: string) {
  const v = value.trim();
  await tx(async (c) => {
    const b = (await c.query(`SELECT * FROM event_bookings WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    if (!b) throw new BookingError('NOT_FOUND');
    if (['cancelled', 'expired'].includes(b.status)) throw new BookingError('BAD_STATE', 'This booking is ' + b.status);
    const ev = (await c.query(`SELECT ${EVENT_COLS} FROM events WHERE id=$1`, [b.event_id])).rows[0] as EventRow;
    if (field === 'date' || field === 'quantity') {
      const date = field === 'date' ? parseDate(v) : b.event_date;
      const qty = field === 'quantity' ? parseInt(v, 10) : b.quantity;
      if (!date || !isBookableDate(ev, date)) throw new BookingError('INVALID_DATES', 'The event does not run on that date');
      if (!(qty >= 1 && qty <= 20)) throw new BookingError('INVALID_INPUT', 'Quantity must be 1–20');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['ev:' + ev.id + ':' + date]);
      if (ev.capacity != null) {
        const taken = await seatsTaken(c as unknown as Q, ev.id, date) - (date === b.event_date ? b.quantity : 0);
        if (taken + qty > ev.capacity) throw new BookingError('NO_AVAILABILITY', `Only ${Math.max(0, ev.capacity - taken)} places left on ${date}`);
      }
      await c.query(`UPDATE event_bookings SET event_date=$2, quantity=$3, total_cents=unit_price_cents*$3, reminder_sent_at=CASE WHEN event_date=$2 THEN reminder_sent_at END, updated_at=now() WHERE id=$1`, [id, date, qty]);
    } else if (field === 'email') {
      if (!/^\S+@\S+\.\S+$/.test(v)) throw new BookingError('INVALID_INPUT', 'Not an email address');
      await c.query(`UPDATE event_bookings SET email=$2, updated_at=now() WHERE id=$1`, [id, v]);
    } else if (field === 'phone') {
      if (!normalizePhone(v)) throw new BookingError('INVALID_INPUT', 'Not a phone number');
      await c.query(`UPDATE event_bookings SET phone=$2, updated_at=now() WHERE id=$1`, [id, v]);
    } else {
      if (v.length < 2) throw new BookingError('INVALID_INPUT', 'Name is too short');
      await c.query(`UPDATE event_bookings SET full_name=$2, updated_at=now() WHERE id=$1`, [id, v.slice(0, 80)]);
    }
    await audit(actor, 'event_booking.update', 'event_booking', id, { field, value: v }, c as unknown as Q);
  });
  return bookingDetail(id);
}

/** 2026-11-05, 5/11/2026, 5-11 (this year or next) → YYYY-MM-DD. */
export function parseDate(s: string): string | null {
  const t = s.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?$/.exec(t);
  if (m) {
    const now = new Date();
    let y = m[3] ? +m[3] : now.getFullYear();
    if (y < 100) y += 2000;
    let d = iso(y, +m[2], +m[1]);
    if (!m[3] && d && d < now.toISOString().slice(0, 10)) d = iso(y + 1, +m[2], +m[1]);
    return d;
  }
  return null;
}
function iso(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

/* ───────── Reminder one hour before ───────── */

/** Bookings whose event starts within the next hour and have not been reminded yet. Marks them first, then sends. */
export async function sendDueReminders(): Promise<number> {
  const due = await q<any>(`
    UPDATE event_bookings b SET reminder_sent_at=now()
    FROM events e
    WHERE e.id=b.event_id AND b.reminder_sent_at IS NULL AND b.attendance_confirmed_at IS NULL
      AND b.status IN ('paid','pay_on_site','pending_verification')
      AND ((b.event_date::text || ' ' || e.start_time)::timestamp AT TIME ZONE 'Africa/Cairo') BETWEEN now() AND now() + interval '65 minutes'
    RETURNING b.id`);
  const { notifyReminder } = await import('./admin-bot');
  for (const r of due) {
    const b = await bookingDetail(r.id);
    const wa = await sendGuest('reminder', b);
    await notifyReminder(b, wa).catch(() => {});
  }
  return due.length;
}
