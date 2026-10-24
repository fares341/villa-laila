'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { createOtaBooking, CHANNELS, type ChannelKey } from '@/services/ota-bookings';
import { BookingError } from '@/services/errors';
import { saveLink, type SiteKey } from '@/services/site-prices';
import { SITE_KEYS } from '@/services/ota-bookings';

const S = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const minor = (v: string) => { const n = Number(v.replace(/[, ]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };

export async function otaCreate(f: FormData) {
  const u = await requireUser('reservation.create');
  const channel = S(f, 'channel') as ChannelKey;
  const back = `/dashboard/ota?ch=${channel}`;
  if (!CHANNELS[channel]) redirect('/dashboard/ota');
  let done: { id: string; reference: string; dueAtHostel: number } | null = null;
  try {
    const cur = (['USD', 'EUR'].includes(S(f, 'currency')) ? S(f, 'currency') : 'EGP') as any;
    done = await createOtaBooking({
      channel, ref: S(f, 'ref'), fullName: S(f, 'fullName'), phone: S(f, 'phone') || null, email: S(f, 'email') || null, nationality: S(f, 'nationality') || null,
      roomTypeId: S(f, 'roomTypeId'), unitIds: f.getAll('unitId').map(String).filter(Boolean), checkIn: S(f, 'checkIn'), checkOut: S(f, 'checkOut'),
      guests: parseInt(S(f, 'guests'), 10) || 1, total: S(f, 'total') ? minor(S(f, 'total')) : (CHANNELS[channel].direct ? null : NaN), currency: cur, prepaidByChannel: f.get('prepaid') === 'on', payAtHostel: f.get('payAtHostel') === 'on',
      deposit: S(f, 'deposit') ? minor(S(f, 'deposit')) : undefined, commission: S(f, 'commission') ? minor(S(f, 'commission')) : null,
      notes: S(f, 'notes') || null, actor: u.email, userId: u.id,
    });
  } catch (e) {
    const m = e instanceof BookingError ? (e.message && e.message !== e.code ? e.message : e.code === 'NO_AVAILABILITY' ? 'No free bed/room of that type for these dates' : e.code) : 'Could not save the booking';
    redirect(`${back}&err=${encodeURIComponent(m)}#add`);
  }
  revalidatePath('/dashboard');
  const due = done!.dueAtHostel;
  redirect(`${back}&ok=${encodeURIComponent(`Saved as ${done!.reference}${channel === 'walk_in' ? ' and checked in if arriving today' : ''}. It is on the calendar. ${due > 0 ? `To collect at the hostel: EGP ${(due / 100).toLocaleString('en-US')}` : 'Nothing to collect at the hostel.'}`)}`);
}

export async function siteLinkSave(f: FormData) {
  await requireUser('settings.manage');
  const channel = S(f, 'channel') as SiteKey;
  const back = `/dashboard/ota?ch=${channel}`;
  if (!(SITE_KEYS as readonly string[]).includes(channel)) redirect('/dashboard/ota');
  try { await saveLink(channel, S(f, 'url')); } catch (e) { redirect(`${back}&err=${encodeURIComponent((e as Error).message)}`); }
  revalidatePath('/dashboard/ota');
  redirect(`${back}&ok=${encodeURIComponent('Link saved. The price is read from it once an hour.')}`);
}
