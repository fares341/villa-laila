'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isSiteLang } from '@/i18n/site';
import { rateLimit } from '@/lib/ratelimit';
import { siteBase, clientIp } from '@/lib/base-url';
import { createEventBooking } from '@/services/events';
import { startEventPaymob, submitEventInstapay } from '@/services/online-payments';
import { BookingError } from '@/services/errors';

const schema = z.object({
  lang: z.string(), slug: z.string().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.coerce.number().int().min(1).max(20), option: z.string().max(40).optional(),
  hotelGuest: z.string().optional(), stayRef: z.string().trim().max(20).optional(),
  fullName: z.string().trim().min(2).max(80), email: z.string().trim().email().max(120), phone: z.string().trim().max(30).optional(),
  payMethod: z.enum(['paymob', 'instapay', 'cash']), website: z.string().optional(),
});

const errCode = (e: unknown) => (e instanceof BookingError ? `${e.code.toLowerCase()}${e.message && e.message !== e.code ? ':' + e.message : ''}` : 'generic');

export async function bookEventAction(formData: FormData) {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  const lang = isSiteLang(raw.lang) ? raw.lang : 'en';
  const slug = (raw.slug || '').replace(/[^a-z0-9-]/gi, '');
  const back = (code: string) => redirect(`/${lang}/events/${slug}?error=${encodeURIComponent(code)}${raw.date ? '&date=' + encodeURIComponent(raw.date) : ''}#book`);
  if (raw.website) redirect(`/${lang}`);
  if (!rateLimit('event:' + (await clientIp()), 8, 10 * 60_000)) return back('rate_limit');
  const p = schema.safeParse(raw);
  if (!p.success) return back('invalid_input');
  const v = p.data;
  let code: string;
  try {
    const { booking } = await createEventBooking({
      slug: v.slug, date: v.date, quantity: v.quantity, optionKey: v.option || null,
      isHotelGuest: v.hotelGuest === 'on', stayReference: v.stayRef || null,
      fullName: v.fullName, email: v.email, phone: v.phone || null, language: lang, payMethod: v.payMethod,
    });
    code = booking.ticket_code;
    if (v.payMethod === 'paymob' && booking.status === 'awaiting_payment') {
      let url: string | null = null;
      try { url = await startEventPaymob(code, await siteBase()); }
      catch (e) { console.error('[event paymob]', e); }
      if (url) redirect(url);
      redirect(`/${lang}/tickets/${code}?payment=unavailable`);
    }
  } catch (e) {
    if ((e as any)?.digest?.startsWith?.('NEXT_REDIRECT')) throw e;
    if (!(e instanceof BookingError)) console.error('[event booking]', e);
    return back(errCode(e));
  }
  redirect(`/${lang}/tickets/${code}`);
}

export async function retryEventPaymobAction(formData: FormData) {
  const lang = isSiteLang(String(formData.get('lang'))) ? String(formData.get('lang')) : 'en';
  const code = String(formData.get('code') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  let url: string | null = null;
  try { url = await startEventPaymob(code, await siteBase()); }
  catch (e) { console.error('[event paymob retry]', e); }
  if (url) redirect(url);
  redirect(`/${lang}/tickets/${code}?payment=unavailable`);
}

export async function submitEventInstapayAction(formData: FormData) {
  const lang = isSiteLang(String(formData.get('lang'))) ? String(formData.get('lang')) : 'en';
  const code = String(formData.get('code') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const name = String(formData.get('payerName') || '').trim().slice(0, 80);
  const ref = String(formData.get('payerRef') || '').trim().slice(0, 60);
  if (!rateLimit('ipe:' + (await clientIp()), 10, 10 * 60_000)) redirect(`/${lang}/tickets/${code}?error=rate_limit`);
  if (name.length < 2 || ref.length < 3) redirect(`/${lang}/tickets/${code}?error=instapay_input#pay`);
  try { await submitEventInstapay(code, name, ref); }
  catch (e) { redirect(`/${lang}/tickets/${code}?error=${encodeURIComponent(errCode(e))}`); }
  redirect(`/${lang}/tickets/${code}?payment=submitted`);
}
