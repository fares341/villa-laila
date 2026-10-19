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

const schema = z.object({
  lang: z.string(), checkIn: z.string(), checkOut: z.string(), guests: z.coerce.number().int().min(1).max(40),
  roomTypeId: z.string().uuid(), fullName: z.string().trim().min(2).max(80), email: z.string().trim().email().max(120),
  phone: z.string().trim().max(30).optional(), nationality: z.string().trim().max(40).optional(), idGovernorate: z.string().trim().max(40).optional(), notes: z.string().trim().max(500).optional(),
  website: z.string().optional(), // honeypot
});

export async function submitBooking(formData: FormData) {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const lang = isSiteLang(raw.lang) ? raw.lang : 'en';
  const back = (code: string) => redirect(`/${lang}/book?checkIn=${encodeURIComponent(raw.checkIn ?? '')}&checkOut=${encodeURIComponent(raw.checkOut ?? '')}&guests=${encodeURIComponent(raw.guests ?? '')}&error=${code}`);
  if (raw.website) redirect(`/${lang}`); // bot filled the honeypot
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  if (!rateLimit('book:' + ip, 6, 10 * 60_000)) return back('rate_limit');
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return back('invalid_input');
  const v = parsed.data;
  const recent = (await q<any>(`SELECT count(*)::int n FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE lower(g.email)=lower($1) AND r.source='website' AND r.created_at > now() - interval '1 hour'`, [v.email]))[0].n;
  if (recent >= 3) return back('rate_limit');
  let ref: string;
  try {
    const res = await createReservation({
      guest: { fullName: v.fullName, email: v.email, phone: v.phone || null, nationality: v.nationality ? normalizeNationality(v.nationality) : null, language: lang },
      roomTypeId: v.roomTypeId, checkIn: v.checkIn, checkOut: v.checkOut, guestsCount: v.guests, source: 'website', status: 'pending',
      guestNotes: v.notes || undefined, facts: { nationality: v.nationality ? normalizeNationality(v.nationality) : undefined, id_governorate: v.idGovernorate ? normalizeGovernorate(v.idGovernorate) : undefined }, actor: 'website',
    });
    ref = res.reference;
  } catch (e) {
    if (e instanceof BookingError && e.code === 'POLICY_BLOCKED') return back('blocked_' + (((e.detail as any)?.key as string) ?? 'x'));
    if (e instanceof BookingError) return back(e.code.toLowerCase());
    console.error('[website booking]', e);
    return back('generic');
  }
  redirect(`/${lang}/booked/${ref}`);
}
