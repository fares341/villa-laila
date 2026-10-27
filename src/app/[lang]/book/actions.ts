'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { normalizeGovernorate } from '@/services/policy';
import { createReservation } from '@/services/reservations';
import { BookingError } from '@/services/errors';
import { rateLimit } from '@/lib/ratelimit';
import { isSiteLang } from '@/i18n/site';
import { q } from '@/lib/db';
import { normalizeNationality } from '@/bot/flow';
import { siteBase } from '@/lib/base-url';
import { startReservationPaymob, submitReservationInstapay } from '@/services/online-payments';

const schema = z.object({
  lang: z.string(), checkIn: z.string(), checkOut: z.string(), guests: z.coerce.number().int().min(1).max(40),
  roomTypeId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(40), lastName: z.string().trim().min(1).max(40),
  email: z.string().trim().email().max(120), emailConfirm: z.string().trim().max(120),
  phone: z.string().trim().min(6).max(30),
  address1: z.string().trim().min(1).max(120), address2: z.string().trim().max(120).optional(), city: z.string().trim().min(1).max(60),
  state: z.string().trim().max(60).optional(), postcode: z.string().trim().min(1).max(20), country: z.string().trim().regex(/^[A-Z]{2}$/),
  arrivalTime: z.string().trim().regex(/^(\d{2}:\d{2})?$/).optional(), nationality: z.string().trim().max(40).optional(), idGovernorate: z.string().trim().max(40).optional(), notes: z.string().trim().max(500).optional(),
  payMethod: z.enum(['paymob', 'instapay', 'hostel']).default('hostel'),
  website: z.string().optional(), // honeypot
});

export async function submitBooking(formData: FormData) {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const lang = isSiteLang(raw.lang) ? raw.lang : 'en';
  const back = (code: string) => redirect(`/${lang}/book?checkIn=${encodeURIComponent(raw.checkIn ?? '')}&checkOut=${encodeURIComponent(raw.checkOut ?? '')}&guests=${encodeURIComponent(raw.guests ?? '')}${raw.room ? '&room=' + encodeURIComponent(raw.room) : ''}&error=${code}`);
  if (raw.website) redirect(`/${lang}`); // bot filled the honeypot
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (!rateLimit('book:' + ip, 6, 10 * 60_000)) return back('rate_limit');
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return back('invalid_input');
  const v = parsed.data;
  if (v.email.toLowerCase() !== v.emailConfirm.toLowerCase()) return back('invalid_input');
  const fullName = `${v.firstName} ${v.lastName}`.replace(/\s+/g, ' ').trim();
  const recent = (await q<any>(`SELECT count(*)::int n FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE lower(g.email)=lower($1) AND r.source='website' AND r.created_at > now() - interval '1 hour'`, [v.email]))[0].n;
  if (recent >= 3) return back('rate_limit');
  let ref: string;
  try {
    const res = await createReservation({
      guest: { fullName, email: v.email, phone: v.phone || null, nationality: v.nationality ? normalizeNationality(v.nationality) : null, language: lang },
      roomTypeId: v.roomTypeId, checkIn: v.checkIn, checkOut: v.checkOut, guestsCount: v.guests, source: 'website', status: 'pending',
      guestNotes: v.notes || undefined, facts: { nationality: v.nationality ? normalizeNationality(v.nationality) : undefined, id_governorate: v.idGovernorate ? normalizeGovernorate(v.idGovernorate) : undefined }, actor: 'website',
    });
    ref = res.reference;
    // The same details the booking engine asks for: address on the guest, arrival time on the booking.
    await q(`UPDATE guests SET address=$2 WHERE id=$1`, [res.guest_id, JSON.stringify({ line1: v.address1, line2: v.address2 || null, city: v.city, state: v.state || null, postcode: v.postcode, country: v.country })]);
    await q(`UPDATE reservations SET arrival_time=$2 WHERE id=$1`, [res.id, v.arrivalTime || null]);
    // Paid online: the beds are held 45 minutes for the payment; once Paymob confirms it, they stay held until reception confirms.
    if (v.payMethod === 'paymob') await q(`UPDATE reservations SET hold_expires_at=now() + interval '45 minutes' WHERE id=$1 AND status='pending'`, [res.id]);
    // Owner's Telegram: confirm it and block the beds in the channel manager.
    // (Paid by Paymob: reception is told once the payment comes in, see the Paymob webhook.)
    if (v.payMethod !== 'paymob') import('@/services/admin-bot').then((m) => m.notifyNewRoomBooking(res.id)).catch((e) => console.error('[admin bot room]', e));
  } catch (e) {
    if (e instanceof BookingError && e.code === 'POLICY_BLOCKED') return back('blocked_' + (((e.detail as any)?.key as string) ?? 'x'));
    if (e instanceof BookingError) return back(e.code.toLowerCase());
    console.error('[website booking]', e);
    return back('generic');
  }
  if (v.payMethod === 'paymob') {
    let url: string | null = null;
    try { url = await startReservationPaymob(ref, await siteBase()); }
    catch (e) { console.error('[booking paymob]', e); }
    if (url) redirect(url);
    redirect(`/${lang}/booked/${ref}?payment=unavailable`);
  }
  redirect(`/${lang}/booked/${ref}${v.payMethod === 'instapay' ? '?pay=instapay#pay' : ''}`);
}

export async function payReservationPaymobAction(formData: FormData) {
  const lang = isSiteLang(String(formData.get('lang'))) ? String(formData.get('lang')) : 'en';
  const ref = String(formData.get('ref') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  let url: string | null = null;
  try { url = await startReservationPaymob(ref, await siteBase()); }
  catch (e) { console.error('[booking paymob retry]', e); }
  if (url) redirect(url);
  redirect(`/${lang}/booked/${ref}?payment=unavailable`);
}

export async function submitReservationInstapayAction(formData: FormData) {
  const lang = isSiteLang(String(formData.get('lang'))) ? String(formData.get('lang')) : 'en';
  const ref = String(formData.get('ref') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const name = String(formData.get('payerName') || '').trim().slice(0, 80);
  const tref = String(formData.get('payerRef') || '').trim().slice(0, 60);
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (!rateLimit('ipr:' + ip, 10, 10 * 60_000)) redirect(`/${lang}/booked/${ref}?error=rate_limit`);
  if (name.length < 2 || tref.length < 3) redirect(`/${lang}/booked/${ref}?pay=instapay&error=instapay_input#pay`);
  let failed = false;
  const pf = formData.get('proof');
  const proof = pf && typeof pf !== 'string' && (pf as File).size ? { bytes: Buffer.from(await (pf as File).arrayBuffer()), mime: (pf as File).type || 'application/octet-stream' } : null;
  if (!proof) redirect(`/${lang}/booked/${ref}?pay=instapay&error=proof_required#pay`);
  try { await submitReservationInstapay(ref, name, tref, proof); } catch (e) { console.error('[instapay room]', e); failed = true; }
  redirect(`/${lang}/booked/${ref}?payment=${failed ? 'error' : 'submitted'}`);
}
