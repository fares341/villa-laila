import { q, tx } from '@/lib/db';
import { todayLocal, addDays, zonedToUtc, isIsoDate } from '@/lib/dates';
import { getSetting, setSetting } from '../settings';
import { audit } from '../audit';
import { BookingError } from '../errors';
import { rateFor, toEgp } from './fx';
import { ensureRun, shiftWindow, activeShifts, addRunTask, taxiLine } from './tasks';
import { getWhatsAppConfig, normalizePhone, sendWhatsApp, type WaResult } from '../whatsapp';

/**
 * Airport taxi (pick-up / drop-off). Price per airport in USD, charged to the guest folio at the day's rate.
 * The guest is messaged the day before / that morning that the driver will wait: a task goes to the morning shift
 * of that day, or to the afternoon shift of the evening before when the taxi is before 10:00.
 */
export type TaxiPrices = { currency: 'USD'; cairo: number; sphinx: number };
export async function taxiPrices(): Promise<TaxiPrices> {
  const p = await getSetting<any>('taxi_prices').catch(() => null);
  return { currency: 'USD', cairo: Number(p?.cairo ?? 2500), sphinx: Number(p?.sphinx ?? 3000) };
}
export async function setTaxiPrices(cairo: number, sphinx: number) {
  if (!(cairo > 0 && sphinx > 0)) throw new BookingError('INVALID_INPUT', 'Prices must be more than zero');
  await setSetting('taxi_prices', { currency: 'USD', cairo: Math.round(cairo), sphinx: Math.round(sphinx) });
}

const AIRPORT = { cairo: 'Cairo airport', sphinx: 'Sphinx airport' } as const;
const fmtWhen = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);

export function taxiMessage(x: any) {
  const when = fmtWhen(new Date(x.scheduled_at));
  const price = `USD ${Number(x.price_minor) / 100}`;
  return x.direction === 'pickup'
    ? `Hello ${x.guest_name}, this is Villa Layla Hostel. Your airport pick-up is confirmed: ${when} at ${AIRPORT[x.airport as 'cairo']}. Our driver will be waiting for you at arrivals with your name. The price is ${price}, paid at the hostel. Have a safe flight!`
    : `Hello ${x.guest_name}, this is Villa Layla Hostel. Your ride to ${AIRPORT[x.airport as 'cairo']} is confirmed for ${when}. The driver will wait for you at the hostel entrance. The price is ${price}, paid at the hostel.`;
}
export const waLink = (phone: string | null, text: string) => phone ? `https://wa.me/${phone.replace(/[^\d]/g, '').replace(/^0+/, '')}?text=${encodeURIComponent(text)}` : null;

/** Which shift sends the confirmation: before 10:00 -> the afternoon shift the evening before, else the morning shift that day. */
export async function reminderShift(at: Date) {
  const day = todayLocal(at);
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return hhmm < '10:00' ? { code: 'EVENING', workDate: addDays(day, -1) } : { code: 'MORNING', workDate: day };
}

async function scheduleReminder(taxi: any) {
  const target = await reminderShift(new Date(taxi.scheduled_at));
  let sh = await shiftWindow(target.code, target.workDate);
  // Booked too late for that shift: the shift running now sends it.
  if (!sh || new Date() >= sh.end) { const a = await activeShifts(); sh = a[a.length - 1] ?? sh; }
  if (!sh) return;
  const run = await ensureRun(sh.code, sh.workDate);
  await addRunTask(run.id, { title: `Send taxi confirmation: ${taxiLine({ ...taxi, confirmed_at: true }).replace(/ informed$/, '')}`, kind: 'taxi_confirm', source: 'taxi', refId: taxi.id, minutes: 5, phase: 'start' });
}

export async function createTaxi(input: {
  reservationId?: string | null; guestName?: string; phone?: string | null; room?: string | null;
  direction: 'pickup' | 'dropoff'; airport: 'cairo' | 'sphinx'; date: string; time: string; note?: string | null; userId: string; actor: string; driverId?: string | null;
}) {
  if (!['pickup', 'dropoff'].includes(input.direction)) throw new BookingError('INVALID_INPUT', 'Pick-up or drop-off?');
  if (!['cairo', 'sphinx'].includes(input.airport)) throw new BookingError('INVALID_INPUT', 'Choose the airport');
  if (!isIsoDate(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) throw new BookingError('INVALID_INPUT', 'Enter the date and time');
  const at = zonedToUtc(input.date, input.time);
  const prices = await taxiPrices();
  const price = prices[input.airport];
  let res: any = null;
  if (input.reservationId) {
    res = (await q<any>(`SELECT r.*, g.full_name, g.phone,
      (SELECT string_agg(DISTINCT rm.name, ', ') FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=r.id AND ru.active) rooms
      FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.id=$1`, [input.reservationId]))[0];
    if (!res) throw new BookingError('NOT_FOUND', 'reservation');
  }
  const name = (input.guestName || res?.full_name || '').trim();
  if (name.length < 2) throw new BookingError('INVALID_INPUT', 'Guest name is required');
  const rate = res ? await rateFor('USD') : null;
  const taxi = await tx(async (c) => {
    let entryId: string | null = null;
    if (res) {
      const egp = toEgp(price, rate!);
      entryId = (await c.query(
        `INSERT INTO folio_entries(reservation_id,entry_date,kind,description,quantity,unit_cents,amount_cents,currency,ref_type,created_by,note)
         VALUES($1,$2,'taxi',$3,1,$4,$4,$5,'taxi',$6,$7) RETURNING id`,
        [res.id, todayLocal(), `Airport ${input.direction === 'pickup' ? 'pick-up' : 'drop-off'} · ${AIRPORT[input.airport]} · USD ${price / 100}`, egp, res.currency, input.userId, `USD ${price / 100} @ ${rate}`])).rows[0].id;
    }
    return (await c.query(
      `INSERT INTO taxi_bookings(reservation_id,guest_name,phone,room_label,direction,airport,scheduled_at,price_minor,price_currency,fx_rate,folio_entry_id,note,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'USD',$9,$10,$11,$12) RETURNING *`,
      [res?.id ?? null, name, input.phone || res?.phone || null, input.room || res?.rooms || null, input.direction, input.airport, at, price, rate, entryId, input.note?.trim() || null, input.userId])).rows[0];
  });
  if (res) await q(`UPDATE folio_entries SET ref_id=$2 WHERE id=$1`, [taxi.folio_entry_id, taxi.id]);
  await scheduleReminder(taxi);
  await audit(input.actor, 'taxi.create', 'taxi', taxi.id, { direction: input.direction, airport: input.airport, at });
  const driverWa = input.driverId ? await assignDriver(taxi.id, input.driverId, input.actor) : null;
  return { ...taxi, driverWa };
}

export async function setTaxiStatus(id: string, status: 'booked' | 'done' | 'cancelled', actor: string) {
  const t = (await q<any>(`UPDATE taxi_bookings SET status=$2 WHERE id=$1 RETURNING *`, [id, status]))[0];
  if (!t) throw new BookingError('NOT_FOUND');
  if (status === 'cancelled') {
    // The driver already has the trip: tell him it's off.
    if (t.driver_id) {
      const d = await taxiWithDriver(id);
      const text = `❌ *إلغاء مشوار* من فيلا ليلى\nمشوار ${d.guest_name} يوم ${arWhen(new Date(d.scheduled_at))} اتلغى. متشكرين 🙏`;
      const wa = await sendWhatsApp(d.driver_phone, text);
      if (!wa.sent) { const { notifyDriverMessage } = await import('../admin-bot'); await notifyDriverMessage(`❌ بلّغ ${d.driver_name} إن مشوار ${d.guest_name} اتلغى`, wa).catch(() => {}); }
    }
    if (t.folio_entry_id) await q(`UPDATE folio_entries SET voided=true, void_reason='Taxi cancelled', voided_at=now() WHERE id=$1 AND NOT voided`, [t.folio_entry_id]);
    await q(`DELETE FROM shift_tasks WHERE source='taxi' AND ref_id=$1 AND status='pending'`, [id]);
  }
  await audit(actor, 'taxi.' + status, 'taxi', id, {});
}

export async function setTaxiConfirmed(id: string, confirmed: boolean, staffId: string | null) {
  await q(`UPDATE taxi_bookings SET confirmed_at=CASE WHEN $2 THEN now() ELSE NULL END, confirmed_by=$3 WHERE id=$1`, [id, confirmed, confirmed ? staffId : null]);
  if (confirmed) await q(`UPDATE shift_tasks SET status='done', done_at=now(), done_by=$2, started_at=COALESCE(started_at, now()), missed_at=NULL WHERE source='taxi' AND ref_id=$1 AND status='pending'`, [id, staffId]);
}

export async function listTaxis(from: string, to: string) {
  return q<any>(`SELECT t.*, r.reference, s.full_name confirmed_by_name, d.name driver_name, d.phone driver_phone FROM taxi_bookings t LEFT JOIN reservations r ON r.id=t.reservation_id LEFT JOIN staff s ON s.id=t.confirmed_by LEFT JOIN taxi_drivers d ON d.id=t.driver_id
                 WHERE (t.scheduled_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2 ORDER BY t.scheduled_at`, [from, to]);
}

/* ───────── Drivers ───────── */

export type Driver = { id: string; name: string; phone: string; car: string | null; active: boolean };

export async function listDrivers(all = false): Promise<Driver[]> {
  return q<Driver>(`SELECT id, name, phone, car, active FROM taxi_drivers ${all ? '' : 'WHERE active'} ORDER BY active DESC, name`).catch(() => []);
}

export async function saveDriver(input: { id?: string | null; name: string; phone: string; car?: string | null }, actor: string) {
  const name = input.name.trim().slice(0, 60);
  const phone = normalizePhone(input.phone);
  if (name.length < 2) throw new BookingError('INVALID_INPUT', 'Write the driver’s name');
  if (!phone) throw new BookingError('INVALID_INPUT', 'Write the driver’s WhatsApp number (e.g. 010… or +20…)');
  const car = input.car?.trim().slice(0, 60) || null;
  const id = input.id
    ? (await q<{ id: string }>(`UPDATE taxi_drivers SET name=$2, phone=$3, car=$4 WHERE id=$1 RETURNING id`, [input.id, name, phone, car]))[0]?.id
    : (await q<{ id: string }>(`INSERT INTO taxi_drivers(name, phone, car) VALUES($1,$2,$3) RETURNING id`, [name, phone, car]))[0].id;
  if (!id) throw new BookingError('NOT_FOUND', 'driver');
  await audit(actor, 'taxi.driver_save', 'taxi_driver', id, { name });
  return id;
}

export async function setDriverActive(id: string, active: boolean, actor: string) {
  await q(`UPDATE taxi_drivers SET active=$2 WHERE id=$1`, [id, active]);
  await audit(actor, active ? 'taxi.driver_on' : 'taxi.driver_off', 'taxi_driver', id, {});
}

const arWhen = (d: Date) => new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(d);
const AIRPORT_AR = { cairo: 'مطار القاهرة', sphinx: 'مطار سفنكس' } as const;
const VILLA_MAP = 'https://maps.app.goo.gl/H7YGjCVT7nshDExj9';

/** The pieces of a taxi job, in the order of the Meta template variables ({{1}}…{{6}}). */
export function driverJobParams(t: any): string[] {
  const kind = t.direction === 'pickup' ? 'استقبال من المطار ✈️ ← الفيلا' : 'توصيل من الفيلا ← المطار ✈️';
  return [
    kind,
    AIRPORT_AR[t.airport as 'cairo'] ?? t.airport,
    arWhen(new Date(t.scheduled_at)),
    [t.guest_name, t.room_label].filter(Boolean).join(' · '),
    t.phone ? '+' + (normalizePhone(t.phone) ?? t.phone) : 'مش متاح',
    t.note?.trim() || 'لا يوجد',
  ];
}

/** Message to the driver when the trip is given to him (same text as the Meta template "driver job"). */
export function driverJobText(t: any): string {
  const [kind, airport, when, guest, phone, note] = driverJobParams(t);
  return [
    '🚖 *مشوار جديد من فيلا ليلى*',
    '',
    `▪️ *النوع:* ${kind}`,
    `▪️ *المطار:* ${airport}`,
    `▪️ *الميعاد:* ${when}`,
    `▪️ *العميل:* ${guest}`,
    `▪️ *رقم العميل:* ${phone}`,
    `▪️ *ملاحظات:* ${note}`,
    '',
    t.direction === 'pickup'
      ? '📍 استنى العميل في صالة الوصول ومعاك لافتة باسمه، ووصّله لفيلا ليلى: 20 شارع صفية زغلول، السيدة زينب.'
      : '📍 الاستلام من باب فيلا ليلى: 20 شارع صفية زغلول، السيدة زينب.',
    VILLA_MAP,
    '',
    'من فضلك أكد استلام المشوار بالرد على الرسالة دي. شكراً 🙏',
  ].join('\n');
}

/** Reminder 30 minutes before (same text as the Meta template "driver reminder"). */
export function driverReminderParams(t: any): string[] {
  const p = driverJobParams(t);
  return [p[2], p[0], p[1], p[3], p[4]];
}
export function driverReminderText(t: any): string {
  const [when, kind, airport, guest, phone] = driverReminderParams(t);
  return [
    '⏰ *تذكير من فيلا ليلى*',
    'مشوارك بعد حوالي نص ساعة.',
    '',
    `▪️ *الميعاد:* ${when}`,
    `▪️ *النوع:* ${kind} · ${airport}`,
    `▪️ *العميل:* ${guest} · ${phone}`,
    '',
    'من فضلك اتحرك في الميعاد. شكراً 🙏',
  ].join('\n');
}

async function taxiWithDriver(id: string) {
  return (await q<any>(`SELECT t.*, d.name driver_name, d.phone driver_phone FROM taxi_bookings t LEFT JOIN taxi_drivers d ON d.id=t.driver_id WHERE t.id=$1`, [id]))[0];
}

/**
 * Give the trip to a driver and message him the guest's details on WhatsApp (automatically when WhatsApp is
 * connected; otherwise the result has a one-tap wa.me link and the owner's Telegram gets it too).
 */
export async function assignDriver(taxiId: string, driverId: string | null, actor: string): Promise<WaResult | null> {
  if (!driverId) {
    await q(`UPDATE taxi_bookings SET driver_id=NULL, driver_notified_at=NULL, driver_reminded_at=NULL WHERE id=$1`, [taxiId]);
    await audit(actor, 'taxi.driver_unassign', 'taxi', taxiId, {});
    return null;
  }
  const d = (await q<any>(`SELECT id FROM taxi_drivers WHERE id=$1 AND active`, [driverId]))[0];
  if (!d) throw new BookingError('NOT_FOUND', 'driver');
  await q(`UPDATE taxi_bookings SET driver_id=$2, driver_notified_at=NULL, driver_reminded_at=NULL WHERE id=$1`, [taxiId, driverId]);
  const t = await taxiWithDriver(taxiId);
  if (!t) throw new BookingError('NOT_FOUND', 'taxi');
  const wa = await sendDriverJob(t);
  await audit(actor, 'taxi.driver_assign', 'taxi', taxiId, { driverId, sent: wa.sent });
  return wa;
}

async function sendDriverJob(t: any): Promise<WaResult> {
  const cfg = await getWhatsAppConfig();
  const wa = await sendWhatsApp(t.driver_phone, driverJobText(t), cfg.template_driver_job ? { name: cfg.template_driver_job, params: driverJobParams(t) } : undefined);
  if (wa.sent) await q(`UPDATE taxi_bookings SET driver_notified_at=now() WHERE id=$1`, [t.id]);
  else {
    const { notifyDriverMessage } = await import('../admin-bot');
    await notifyDriverMessage(`🚖 مشوار لـ ${t.driver_name}: ${t.guest_name} · ${arWhen(new Date(t.scheduled_at))}`, wa).catch(() => {});
  }
  return wa;
}

/** Worker: trips starting within 30 minutes whose driver has not been reminded. Marks them first, then sends. */
export async function sendDueDriverReminders(): Promise<number> {
  const due = await q<{ id: string }>(`
    UPDATE taxi_bookings SET driver_reminded_at=now()
    WHERE driver_id IS NOT NULL AND driver_reminded_at IS NULL AND status='booked'
      AND scheduled_at BETWEEN now() AND now() + interval '31 minutes'
    RETURNING id`).catch(() => []);
  const cfg = due.length ? await getWhatsAppConfig() : null;
  for (const r of due) {
    const t = await taxiWithDriver(r.id);
    const wa = await sendWhatsApp(t.driver_phone, driverReminderText(t), cfg!.template_driver_reminder ? { name: cfg!.template_driver_reminder, params: driverReminderParams(t) } : undefined);
    if (!wa.sent) {
      const { notifyDriverMessage } = await import('../admin-bot');
      await notifyDriverMessage(`⏰ تذكير السواق ${t.driver_name}: مشوار ${t.guest_name} بعد نص ساعة`, wa).catch(() => {});
    }
  }
  return due.length;
}

export { waLinkTo as driverWaLink };
function waLinkTo(phone: string | null, text: string) { const p = normalizePhone(phone); return p ? `https://wa.me/${p}?text=${encodeURIComponent(text)}` : null; }
