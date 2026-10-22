'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { openShiftRow } from '@/services/pms/pos';
import { markEventBookingPaid, checkInTicket, updateEventSettings } from '@/services/events';
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
  } catch (e) { fail(e); }
  done(ok ? 'Receipt approved · booking confirmed and paid' + note : 'Receipt rejected · the guest can send it again for 12 hours');
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
  let sent = false;
  try { sent = (await cancelEventBookingAdmin(String(formData.get('id')), u.email, String(formData.get('reason') || '').trim() || null)).wa.sent; } catch (e) { fail(e); }
  done(sent ? 'Booking cancelled · the guest was told on WhatsApp' : 'Booking cancelled · tell the guest (WhatsApp button)');
}

export async function confirmEventBookingAction(formData: FormData) {
  const u = await requireUser('tours.manage');
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
    token: S(f, 'token') || cur.token, phone_number_id: S(f, 'phoneNumberId'), template_lang: S(f, 'templateLang') || 'ar',
    template_reminder: S(f, 'tplReminder'), template_cancel: S(f, 'tplCancel'), template_confirm: S(f, 'tplConfirm'),
  });
  done('WhatsApp settings saved', SET);
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
