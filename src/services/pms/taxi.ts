import { q, tx } from '@/lib/db';
import { todayLocal, addDays, zonedToUtc, isIsoDate } from '@/lib/dates';
import { getSetting, setSetting } from '../settings';
import { audit } from '../audit';
import { BookingError } from '../errors';
import { rateFor, toEgp } from './fx';
import { ensureRun, shiftWindow, activeShifts, addRunTask, taxiLine } from './tasks';

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
  direction: 'pickup' | 'dropoff'; airport: 'cairo' | 'sphinx'; date: string; time: string; note?: string | null; userId: string; actor: string;
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
  return taxi;
}

export async function setTaxiStatus(id: string, status: 'booked' | 'done' | 'cancelled', actor: string) {
  const t = (await q<any>(`UPDATE taxi_bookings SET status=$2 WHERE id=$1 RETURNING *`, [id, status]))[0];
  if (!t) throw new BookingError('NOT_FOUND');
  if (status === 'cancelled') {
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
  return q<any>(`SELECT t.*, r.reference, s.full_name confirmed_by_name FROM taxi_bookings t LEFT JOIN reservations r ON r.id=t.reservation_id LEFT JOIN staff s ON s.id=t.confirmed_by
                 WHERE (t.scheduled_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN $1 AND $2 ORDER BY t.scheduled_at`, [from, to]);
}
