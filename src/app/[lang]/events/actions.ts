'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { isSiteLang } from '@/i18n/site';
import { rateLimit } from '@/lib/ratelimit';
import { siteBase, clientIp } from '@/lib/base-url';
import { createEventBooking } from '@/services/events';
import { startEventPaymob, submitEventWalletProof } from '@/services/online-payments';
import { confirmAttendance, bookingWhatsAppLink } from '@/services/event-admin';
import { notifyNewEventBooking, notifyWalletProof } from '@/services/admin-bot';
import { isWallet } from '@/services/wallets';
import { BookingError } from '@/services/errors';

const schema = z.object({
  lang: z.string(), slug: z.string().min(1).max(80), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quantity: z.coerce.number().int().min(1).max(20), option: z.string().max(40).optional(),
  hotelGuest: z.string().optional(), dinner: z.string().optional(), stayRef: z.string().trim().max(20).optional(),
  fullName: z.string().trim().min(2).max(80), email: z.string().trim().email().max(120), phone: z.string().trim().min(6).max(30),
  payMethod: z.enum(['paymob', 'instapay', 'vodafone_cash', 'cash']), website: z.string().optional(), payerRef: z.string().trim().max(60).optional(),
});

async function readProof(v: FormDataEntryValue | null): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!v || typeof v === 'string' || !(v as File).size) return null;
  const f = v as File;
  return { bytes: Buffer.from(await f.arrayBuffer()), mime: f.type || 'application/octet-stream' };
}

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
  let bookingId: string;
  try {
    const { booking } = await createEventBooking({
      slug: v.slug, date: v.date, quantity: v.quantity, optionKey: v.option || null,
      isHotelGuest: v.hotelGuest === 'on', stayReference: v.stayRef || null, dinner: v.dinner === 'on',
      fullName: v.fullName, email: v.email, phone: v.phone || null, language: lang, payMethod: v.payMethod,
    });
    code = booking.ticket_code;
    bookingId = booking.id;
    // Wallet payments: the receipt can be uploaded right in the booking form (otherwise on the ticket page).
    let proofId: string | null = null;
    if (isWallet(v.payMethod) && booking.status === 'awaiting_payment') {
      const proof = await readProof(formData.get('proof'));
      if (proof) {
        try { proofId = await submitEventWalletProof(code, v.payMethod, v.fullName, v.payerRef || '', proof); }
        catch (e) { console.error('[event wallet proof]', e); }
      }
    }
    await notifyNewEventBooking(booking.id).catch((e) => console.error('[admin bot]', e));
    if (proofId) await notifyWalletProof(proofId).catch((e) => console.error('[admin bot]', e));
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
  // Booking saved (dashboard, POS, Telegram). The guest goes straight to the villa's WhatsApp with a ready message.
  let wa: string | null = null;
  try { wa = await bookingWhatsAppLink(bookingId); } catch (e) { console.error('[event wa link]', e); }
  redirect(wa ?? `/${lang}/tickets/${code}`);
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
  return submitEventWalletAction(formData);
}

/** Receipt for InstaPay or Vodafone Cash sent from the ticket page. */
export async function submitEventWalletAction(formData: FormData) {
  const lang = isSiteLang(String(formData.get('lang'))) ? String(formData.get('lang')) : 'en';
  const code = String(formData.get('code') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const method = String(formData.get('method') || 'instapay');
  const name = String(formData.get('payerName') || '').trim().slice(0, 80);
  const ref = String(formData.get('payerRef') || '').trim().slice(0, 60);
  if (!rateLimit('ipe:' + (await clientIp()), 10, 10 * 60_000)) redirect(`/${lang}/tickets/${code}?error=rate_limit`);
  if (!isWallet(method)) redirect(`/${lang}/tickets/${code}?error=generic#pay`);
  if (name.length < 2) redirect(`/${lang}/tickets/${code}?error=instapay_input#pay`);
  const proof = await readProof(formData.get('proof'));
  if (!proof) redirect(`/${lang}/tickets/${code}?error=proof_required#pay`);
  let id = '';
  try { id = await submitEventWalletProof(code, method, name, ref, proof); }
  catch (e) { redirect(`/${lang}/tickets/${code}?error=${encodeURIComponent(errCode(e))}`); }
  await notifyWalletProof(id).catch((e) => console.error('[admin bot]', e));
  redirect(`/${lang}/tickets/${code}?payment=submitted`);
}

/** Guest taps "I'm coming" (link sent in the reminder before the event). */
export async function confirmAttendanceAction(formData: FormData) {
  const lang = isSiteLang(String(formData.get('lang'))) ? String(formData.get('lang')) : 'en';
  const code = String(formData.get('code') || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
  try { await confirmAttendance(code); } catch { redirect(`/${lang}/tickets/${code}?error=generic`); }
  redirect(`/${lang}/tickets/${code}?attend=ok`);
}
