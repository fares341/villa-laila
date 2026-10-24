import { q } from '@/lib/db';
import type { Q } from '@/lib/db';
import { BookingError } from '../errors';
import { getSetting, setSetting } from '../settings';

/**
 * Foreign guests paying on the venue's card machine. The cashier records passport number, name and nationality
 * with the payment; every night at 00:00 (Cairo) the day's list goes out as an Excel file.
 */
export type CardPayer = { passport: string; name: string; nationality: string };

export function cleanPayer(p: CardPayer | null | undefined): CardPayer | null {
  if (!p) return null;
  const passport = String(p.passport ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const name = String(p.name ?? '').trim().replace(/\s+/g, ' ');
  const nationality = String(p.nationality ?? '').trim();
  if (!passport && !name && !nationality) return null;
  if (!/^[A-Z0-9]{5,20}$/.test(passport)) throw new BookingError('INVALID_INPUT', 'Passport number: 5–20 letters and numbers, as printed in the passport');
  if (name.length < 3) throw new BookingError('INVALID_INPUT', 'Write the name as it is in the passport');
  if (nationality.length < 2) throw new BookingError('INVALID_INPUT', 'Choose the nationality');
  if (/^egypt(ian)?$|^eg$|^مصر/i.test(nationality)) throw new BookingError('INVALID_INPUT', 'This list is for foreign guests only. Choose "Egyptian" instead.');
  return { passport, name: name.slice(0, 100), nationality: nationality.slice(0, 60) };
}

export async function recordCardPayer(c: Q, p: CardPayer, v: { amountCents: number; source: 'pos_sale' | 'folio_payment' | 'event'; saleId?: string | null; paymentId?: string | null; reservationId?: string | null; shiftId?: string | null; staffName?: string | null; paidFor?: string | null }) {
  await c.query(`INSERT INTO card_foreign_payers(amount_cents,full_name,nationality,passport_no,source,sale_id,payment_id,reservation_id,shift_id,staff_name,paid_for)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [v.amountCents, p.name, p.nationality, p.passport, v.source, v.saleId ?? null, v.paymentId ?? null, v.reservationId ?? null, v.shiftId ?? null, v.staffName ?? null, v.paidFor ?? null]);
}

export async function cardPayersFor(day: string) {
  return q<any>(`
    SELECT f.*, r.reference, cs.shift_no,
      to_char(f.created_at AT TIME ZONE 'Africa/Cairo', 'HH24:MI') AS time
    FROM card_foreign_payers f
    LEFT JOIN reservations r ON r.id=f.reservation_id
    LEFT JOIN cash_shifts cs ON cs.id=f.shift_id
    WHERE f.day=$1 ORDER BY f.created_at`, [day]);
}

/** The Excel file for one day (SheetJS). Columns match the sample sent to the owner. */
export async function cardPayersXlsx(day: string): Promise<{ file: Buffer; name: string; count: number; totalCents: number }> {
  const XLSX = await import('xlsx');
  const rows = await cardPayersFor(day);
  const total = rows.reduce((a: number, r: any) => a + Number(r.amount_cents), 0);
  const dayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));
  const head = ['#', 'Time', 'Guest name (as in passport)', 'Nationality', 'Passport No.', 'Amount (EGP)', 'Paid for', 'Booking / room', 'Shift', 'Cashier'];
  const aoa: any[][] = [
    ['Villa Layla Hostel — Foreign guests paid by card (venue POS machine)'],
    [`Date: ${dayLabel}`, '', '', '', '', '', '', '', '', `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`],
    [],
    head,
    ...rows.map((r: any, i: number) => [i + 1, r.time, r.full_name, r.nationality, r.passport_no, Number(r.amount_cents) / 100, r.paid_for ?? '', r.reference ?? 'Walk-in', r.shift_no ? `#${r.shift_no}` : '', r.staff_name ?? '']),
    [],
    ['', '', 'Total', `${rows.length} payment(s)`, '', total / 100],
  ];
  if (!rows.length) aoa.splice(4, 0, ['', '', 'No card payments by foreign guests on this day.']);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 4 }, { wch: 7 }, { wch: 30 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 34 }, { wch: 18 }, { wch: 8 }, { wch: 18 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }];
  // Amount column as money with 2 decimals.
  for (let r = 4; r < aoa.length; r++) { const ref = XLSX.utils.encode_cell({ r, c: 5 }); if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '#,##0.00'; }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Foreign card payments');
  const file = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return { file, name: `villa-layla-foreign-card-payments-${day}.xlsx`, count: rows.length, totalCents: total };
}

/**
 * Midnight job (worker tick): once the clock passes 00:00 Cairo, send yesterday's file to the owner on Telegram.
 * Sent once per day; also downloadable any time from Dashboard → Shifts & cash.
 */
export async function sendDailyCardPayersReport(now = new Date()): Promise<boolean> {
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(d);
  const today = fmt(now);
  const yesterday = fmt(new Date(now.getTime() - 24 * 3600e3 + 60_000));
  const last = await getSetting<string>('foreign_card_report_sent').catch(() => null);
  if (last && last >= yesterday) return false;
  if (yesterday >= today) return false;
  const { getAdminBotConfig, adminApi } = await import('../admin-bot');
  const { token, chat_ids } = await getAdminBotConfig();
  if (!token) return false;
  const rep = await cardPayersXlsx(yesterday);
  const caption = rep.count
    ? `أجانب دفعوا بالفيزا على ماكينة المكان · ${yesterday}\n${rep.count} عملية · الإجمالي ${(rep.totalCents / 100).toLocaleString('en-US')} جنيه`
    : `مفيش أجانب دفعوا بالفيزا على ماكينة المكان يوم ${yesterday}.`;
  for (const id of chat_ids) {
    if (rep.count) await adminApi.document(id, rep.file, rep.name, caption).catch((e: Error) => console.error('[card report]', e.message));
    else await adminApi.send(id, caption).catch(() => {});
  }
  await setSetting('foreign_card_report_sent', yesterday);
  return true;
}
