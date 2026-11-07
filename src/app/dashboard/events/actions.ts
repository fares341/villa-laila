'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { openShiftRow } from '@/services/pms/pos';
import { markEventBookingPaid, checkInTicket, updateEventSettings, moveEvent } from '@/services/events';
import { approveProofAdmin, rejectProofAdmin, confirmEventBookingAdmin, cancelEventBookingAdmin } from '@/services/event-admin';
import { saveWallets, getWallets } from '@/services/wallets';
import { saveAdminBotConfig, getAdminBotConfig, testAdminBot } from '@/services/admin-bot';
import { saveWhatsAppConfig, getWhatsAppConfig } from '@/services/whatsapp';
import { q } from '@/lib/db';

const P = '/dashboard/events';
const done = (ok: string, back = P) => { revalidatePath(P); redirect(`${back}${back.includes('?') ? '&' : '?'}ok=${encodeURIComponent(ok)}`); };
const fail = (e: unknown, back = P) => redirect(`${back}${back.includes('?') ? '&' : '?'}err=${encodeURIComponent((e as Error)?.message || 'Failed')}`);
const safeBack = (v: FormDataEntryValue | null) => { const s = String(v || ''); return s.startsWith('/') && !s.startsWith('//') ? s : P; };

export async function decideInstapayAction(formData: FormData) {
  const u = await requireUser('frontdesk.use');
  const id = String(formData.get('id'));
  const ok = formData.get('decision') === 'verify';
  let note = '';
  try {
    if (ok) { const r = await approveProofAdmin(id, u.email, u.id); note = r.b ? (r.wa.sent ? ' · confirmation sent to the guest on WhatsApp' : ' · send the guest the confirmation (WhatsApp button in the list)') : ''; }
    else await rejectProofAdmin(id, u.email, u.id);
  } catch (e) { fail(e, safeBack(formData.get('back'))); }
  revalidatePath('/dashboard/payments');
  done(ok ? 'Receipt approved · booking confirmed and paid' + note : 'Receipt rejected · the guest can send it again for 12 hours', safeBack(formData.get('back')));
}

export async function markEventPaidAction(formData: FormData) {
  const u = await requireUser('events.bookings');
  const id = String(formData.get('id'));
  const shift = await openShiftRow();
  try { await markEventBookingPaid(id, u.email, shift ? `Paid cash at the desk · shift #${shift.shift_no}` : 'Paid at the desk', { shiftId: shift?.id ?? null }); } catch (e) { fail(e); }
  done(`Paid in cash · added to the drawer of shift #${shift?.shift_no}`);
}

export async function checkInEventAction(formData: FormData) {
  const u = await requireUser('events.bookings');
  const back = safeBack(formData.get('back'));
  try { await checkInTicket(String(formData.get('id')), u.email); } catch (e) { fail(e, back); }
  done('Guest checked in', back);
}

export async function staffCheckInTicketAction(formData: FormData) {
  return checkInEventAction(formData);
}

export async function cancelEventBookingAction(formData: FormData) {
  const u = await requireUser('events.bookings');
  let sent = false;
  try { sent = (await cancelEventBookingAdmin(String(formData.get('id')), u.email, String(formData.get('reason') || '').trim() || null)).wa.sent; } catch (e) { fail(e); }
  done(sent ? 'Booking cancelled · the guest was told on WhatsApp' : 'Booking cancelled · tell the guest (WhatsApp button)');
}

export async function confirmEventBookingAction(formData: FormData) {
  const u = await requireUser('events.bookings');
  let sent = false;
  try { sent = (await confirmEventBookingAdmin(String(formData.get('id')), u.email, u.id)).wa.sent; } catch (e) { fail(e); }
  done(sent ? 'Booking confirmed · confirmation sent on WhatsApp' : 'Booking confirmed · send the guest the confirmation (WhatsApp button)');
}

/* ───────── Settings tab ───────── */
const S = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const SET = '/dashboard/events?tab=settings';

export async function saveWalletsAction(f: FormData) {
  await requireUser('events.manage');
  try {
    await saveWallets({
      instapay: { address: S(f, 'ipAddress'), phone: S(f, 'ipPhone'), name: S(f, 'ipName'), link: S(f, 'ipLink'), enabled: f.get('ipOn') === 'on' },
      vodafone_cash: { number: S(f, 'vfNumber'), name: S(f, 'vfName'), enabled: f.get('vfOn') === 'on' },
    });
  } catch (e) { fail(e, SET); }
  revalidatePath('/en'); revalidatePath('/ar');
  done('Payment accounts saved · the website shows them now', SET);
}

export async function saveAdminBotAction(f: FormData) {
  await requireUser('settings.manage');
  const cur = await getAdminBotConfig();
  const token = S(f, 'token');
  const ids = S(f, 'chatIds').split(/[\s,]+/).filter((x) => /^-?\d{5,}$/.test(x));
  if (token && !/^\d+:[\w-]{30,}$/.test(token)) fail(new Error('That does not look like a bot token (it looks like 123456:ABC...)'), SET);
  if (token && process.env.TELEGRAM_BOT_TOKEN && token === process.env.TELEGRAM_BOT_TOKEN) fail(new Error('This is the guest bot token. Make a separate bot for the admin in @BotFather.'), SET);
  await saveAdminBotConfig({ token: token || cur.token, chat_ids: ids.length ? ids : cur.chat_ids });
  done('Admin bot saved · it starts within a minute', SET);
}

export async function testAdminBotAction() {
  await requireUser('settings.manage');
  let name = '';
  try { name = await testAdminBot(); } catch (e) { fail(e, SET); }
  done(`Test message sent by @${name}`, SET);
}

export async function saveWhatsAppAction(f: FormData) {
  await requireUser('settings.manage');
  const cur = await getWhatsAppConfig();
  await saveWhatsAppConfig({
    ...cur, // keeps the taxi-driver template names (set on the Airport taxi page)
    token: S(f, 'token') || cur.token, phone_number_id: S(f, 'phoneNumberId'), template_lang: S(f, 'templateLang') || 'ar',
    template_reminder: S(f, 'tplReminder'), template_cancel: S(f, 'tplCancel'), template_confirm: S(f, 'tplConfirm'),
  });
  done('WhatsApp settings saved', SET);
}

export async function findTicketAction(formData: FormData) {
  await requireUser('events.bookings');
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

/* ───────── Weekly dinner menu ───────── */

const MENU = '/dashboard/events/menu';
async function photoOf(v: FormDataEntryValue | null): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!v || typeof v === 'string' || !(v as File).size) return null;
  const f = v as File;
  return { bytes: Buffer.from(await f.arrayBuffer()), mime: f.type || 'image/jpeg' };
}
const mealIn = (f: FormData) => (f.get('meal') === 'breakfast' ? 'breakfast' : 'dinner') as 'breakfast' | 'dinner';
const menuBack = (f: FormData) => (mealIn(f) === 'breakfast' ? `${MENU}?meal=breakfast` : MENU);
const menuDone = (ok: string, f?: FormData) => { revalidatePath(MENU); revalidatePath('/en'); revalidatePath('/ar'); const b = f ? menuBack(f) : MENU; redirect(`${b}${b.includes('?') ? '&' : '?'}ok=${encodeURIComponent(ok)}`); };

export async function menuSaveDayAction(f: FormData) {
  const u = await requireUser('events.manage');
  try {
    const { saveDay } = await import('@/services/weekly-menu');
    await saveDay(parseInt(String(f.get('weekday')), 10), {
      titleAr: String(f.get('titleAr') || ''), titleEn: String(f.get('titleEn') || ''),
      dishesAr: String(f.get('dishesAr') || ''), dishesEn: String(f.get('dishesEn') || ''),
      descAr: String(f.get('descAr') || ''), descEn: String(f.get('descEn') || ''),
      photo: await photoOf(f.get('photo')), imageUrl: String(f.get('imageUrl') || '') || null,
    }, u.email, mealIn(f));
  } catch (e) { fail(e, menuBack(f)); }
  menuDone('Meal saved', f);
}

export async function menuClearDayAction(f: FormData) {
  const u = await requireUser('events.manage');
  const { clearDay } = await import('@/services/weekly-menu');
  await clearDay(parseInt(String(f.get('weekday')), 10), u.email, mealIn(f));
  menuDone('Day cleared', f);
}

export async function menuCopyAction(f: FormData) {
  const u = await requireUser('events.manage');
  try {
    const { copyDay } = await import('@/services/weekly-menu');
    const to = f.getAll('to').map((x) => parseInt(String(x), 10));
    if (!to.length) throw new Error('Choose the days to copy to');
    await copyDay(parseInt(String(f.get('from')), 10), to, u.email, mealIn(f));
  } catch (e) { fail(e, menuBack(f)); }
  menuDone('Meal copied', f);
}

export async function menuImportAction(f: FormData) {
  const u = await requireUser('events.manage');
  let msg = '';
  try {
    const file = f.get('file');
    const text = file && typeof file !== 'string' && (file as File).size ? await (file as File).text() : String(f.get('json') || '');
    const json = JSON.parse(text);
    const { importMenu } = await import('@/services/weekly-menu');
    const r = await importMenu(Array.isArray(json) ? json : json.days, u.email, mealIn(f));
    msg = `Imported ${r.days} day(s)${r.imageErrors.length ? ` · photos not downloaded: ${r.imageErrors.join('; ')}` : ''}`;
  } catch (e) { fail(e instanceof SyntaxError ? new Error('That is not valid JSON') : e, menuBack(f)); }
  menuDone(msg, f);
}

export async function moveEventAction(f: FormData) {
  const u = await requireUser('events.manage');
  const dir = String(f.get('dir'));
  if (!['up', 'down', 'top', 'bottom'].includes(dir)) return;
  const peers = String(f.get('peers') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  await moveEvent(String(f.get('id')), dir as 'up', u.email, peers);
  revalidatePath(P); revalidatePath('/[lang]', 'layout');
  redirect(`${P}?tab=events#order`);
}

/** The villa's WhatsApp community link, shown next to «Events» on the website (empty = hidden). */
export async function saveCommunityAction(f: FormData) {
  await requireUser('events.manage');
  try {
    const { setSetting, waGroupLink } = await import('@/services/settings');
    const raw = S(f, 'community');
    const link = waGroupLink(raw);
    if (raw && !link) throw new Error('The community link must look like https://chat.whatsapp.com/…');
    await setSetting('whatsapp_community', link ?? '');
  } catch (e) { fail(e, SET); }
  revalidatePath('/en'); revalidatePath('/ar');
  done('WhatsApp community link saved', SET);
}

/** Cancel an event on one day: every booking is cancelled and the guests get the owner's message. */
export async function cancelEventDayAction(f: FormData) {
  const u = await requireUser('events.manage');
  const back = safeBack(f.get('back'));
  let r: import('@/services/event-admin').DayCancelResult;
  try {
    const { cancelEventDay } = await import('@/services/event-admin');
    r = await cancelEventDay(S(f, 'eventId'), S(f, 'date'), { en: String(f.get('msgEn') ?? ''), ar: String(f.get('msgAr') ?? '') }, u.email, f.get('keepOpen') === 'on');
  } catch (e) { return fail(e, back); }
  const parts = [`Event cancelled · ${r.bookings} booking(s), ${r.people} people`];
  if (r.waSent) parts.push(`${r.waSent} told on WhatsApp`);
  if (r.emailed) parts.push(`${r.emailed} by e-mail`);
  if (r.toTell) parts.push(`${r.toTell} still to send on WhatsApp: tap the green button next to each one, the message is ready`);
  if (r.paid) parts.push(`${r.paid} had paid: refund them`);
  done(parts.join(' · '), back);
}

export async function reopenEventDayAction(f: FormData) {
  const u = await requireUser('events.manage');
  const back = safeBack(f.get('back'));
  try { const { reopenEventDay } = await import('@/services/event-admin'); await reopenEventDay(S(f, 'eventId'), S(f, 'date'), u.email); } catch (e) { return fail(e, back); }
  done('The day is open for bookings again', back);
}
