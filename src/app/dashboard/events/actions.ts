'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { openShiftRow } from '@/services/pms/pos';
import { markEventBookingPaid, checkInTicket, cancelEventBooking, updateEventSettings } from '@/services/events';
import { decideInstapay } from '@/services/online-payments';
import { q } from '@/lib/db';

const P = '/dashboard/events';
const done = (ok: string, back = P) => { revalidatePath(P); redirect(`${back}${back.includes('?') ? '&' : '?'}ok=${encodeURIComponent(ok)}`); };
const fail = (e: unknown, back = P) => redirect(`${back}${back.includes('?') ? '&' : '?'}err=${encodeURIComponent((e as Error)?.message || 'Failed')}`);
const safeBack = (v: FormDataEntryValue | null) => { const s = String(v || ''); return s.startsWith('/') && !s.startsWith('//') ? s : P; };

export async function decideInstapayAction(formData: FormData) {
  const u = await requireUser('frontdesk.use');
  const id = String(formData.get('id'));
  const ok = formData.get('decision') === 'verify';
  try { await decideInstapay(id, ok, u.id, u.email); } catch (e) { fail(e); }
  done(ok ? 'InstaPay transfer verified' : 'InstaPay transfer rejected');
}

export async function markEventPaidAction(formData: FormData) {
  const u = await requireUser('tours.manage');
  const id = String(formData.get('id'));
  const shift = await openShiftRow();
  try { await markEventBookingPaid(id, u.email, shift ? `Paid cash at the desk · shift #${shift.shift_no}` : 'Paid at the desk', { shiftId: shift?.id ?? null }); } catch (e) { fail(e); }
  done(`Paid in cash · added to the drawer of shift #${shift?.shift_no}`);
}

export async function checkInEventAction(formData: FormData) {
  const u = await requireUser('tours.manage');
  const back = safeBack(formData.get('back'));
  try { await checkInTicket(String(formData.get('id')), u.email); } catch (e) { fail(e, back); }
  done('Guest checked in', back);
}

export async function staffCheckInTicketAction(formData: FormData) {
  return checkInEventAction(formData);
}

export async function cancelEventBookingAction(formData: FormData) {
  const u = await requireUser('tours.manage');
  try { await cancelEventBooking(String(formData.get('id')), u.email); } catch (e) { fail(e); }
  done('Booking cancelled');
}

export async function findTicketAction(formData: FormData) {
  await requireUser('tours.manage');
  const code = String(formData.get('code') || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const withPrefix = code.startsWith('EV-') ? code : 'EV-' + code;
  const b = (await q<any>('SELECT ticket_code, language FROM event_bookings WHERE ticket_code=$1', [withPrefix]))[0];
  if (!b) redirect(`${P}?err=${encodeURIComponent('No ticket ' + withPrefix)}`);
  redirect(`/${b.language || 'en'}/tickets/${b.ticket_code}`);
}

export async function updateEventAction(formData: FormData) {
  const u = await requireUser('settings.manage');
  const num = (k: string) => { const v = String(formData.get(k) ?? '').trim(); return v === '' ? null : Math.round(Number(v) * 100); };
  const cap = String(formData.get('capacity') ?? '').trim();
  const price = num('price');
  if (price == null || !Number.isFinite(price) || price < 0) fail(new Error('Enter a price'));
  try {
    await updateEventSettings(String(formData.get('id')), {
      priceCents: price!, guestPriceCents: num('guestPrice'), capacity: cap === '' ? null : Math.max(1, parseInt(cap, 10) || 1), active: formData.get('active') === 'on',
    }, u.email);
  } catch (e) { fail(e); }
  done('Event updated');
}
