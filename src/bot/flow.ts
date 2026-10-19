// Telegram conversation engine. Deterministic state machine persisted in the DB (conversations.flow/step/data).
// Gemini only transcribes voice and extracts fields; availability, prices, eligibility and booking state come from services.
import { q } from '@/lib/db';
import { env } from '@/lib/env';
import { todayLocal, addDays, isIsoDate, nightsBetween, validateStay } from '@/lib/dates';
import { fmtMoney } from '@/lib/money';
import { t, LANGS, LANG_LABEL, isLang, type Lang } from '@/i18n/bot';
import type { Keyboard, Button } from '@/services/channels';
import { getOrCreateConversation, saveState, logMessage, botSend, escalate, notifyStaff, basicSummary, type Conversation } from '@/services/conversations';
import { availabilityFor } from '@/services/availability';
import { createReservation } from '@/services/reservations';
import { requestExtension } from '@/services/extensions';
import { BookingError } from '@/services/errors';
import { activeRules, requiredFacts, evaluate, normalizeGovernorate } from '@/services/policy';
import { getSetting, localized } from '@/services/settings';
import { reschedule, cancelFollowups } from '@/services/followups';
import { payState } from '@/services/payments';
import { tg } from './telegram';
import { extract, answerFromFacts, transcribeVoice, summarize, geminiEnabled, type Extracted } from './ai';

type Data = Record<string, any>;
const ORDER = ['phoneDone', 'name', 'nationality', 'roomTypeId', 'guests', 'checkOut', 'checkIn'] as const;

/* ───────────────────────── helpers ───────────────────────── */
const toWestern = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

export function parseDateText(raw: string, today: string): string | null {
  const s = toWestern(raw.trim());
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) { const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`; return isIsoDate(iso) ? iso : null; }
  m = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/.exec(s);
  if (m) {
    const d = m[1].padStart(2, '0'), mo = m[2].padStart(2, '0');
    let y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : today.slice(0, 4);
    let iso = `${y}-${mo}-${d}`;
    if (!isIsoDate(iso)) return null;
    if (!m[3] && iso < today) { iso = `${+y + 1}-${mo}-${d}`; if (!isIsoDate(iso)) return null; }
    return iso;
  }
  return null;
}

export function normalizeNationality(s: string): string {
  const x = s.trim().toLowerCase();
  if (/^(eg|egy|egypt|egyptian|egipto|egipcio|egipcia|égypte|egypte|égyptien|egyptien|égyptienne|مصر|مصري|مصرية|مصريه)$/.test(x)) return 'EG';
  return s.trim().toUpperCase().slice(0, 40);
}

function keywordIntent(text: string): Extracted['intent'] {
  const x = text.toLowerCase();
  if (/(human|person|agent|reception|recepci|réception|استقبال|موظف|شخص)/.test(x)) return 'reception';
  if (/(extend|prolong|ampli|alarg|تمديد|مدد|زود)/.test(x)) return 'extend';
  if (/(book|reserv|réserv|حجز|احجز)/.test(x)) return 'new_booking';
  if (/(avail|dispon|متاح|متوفر)/.test(x)) return 'availability';
  if (/(price|prix|precio|tarif|سعر|أسعار|اسعار)/.test(x)) return 'rooms';
  if (/(pay|pago|paiement|دفع|تحويل)/.test(x)) return 'payment';
  if (/(language|idioma|langue|لغة|لغه)/.test(x)) return 'change_language';
  if (/^(hi|hello|hola|bonjour|salut|مرحبا|اهلا|أهلا|سلام)/.test(x)) return 'greeting';
  return 'other';
}

const fmtDay = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : lang, { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
const fmtWhen = (d: Date, lang: Lang) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : lang, { timeZone: env.tz, dateStyle: 'medium', timeStyle: 'short' }).format(d);
const localName = (obj: Record<string, string> | null | undefined, lang: Lang) => (obj?.[lang] || obj?.en || Object.values(obj ?? {})[0] || '?') as string;
const rows = (btns: Button[], per: number): Button[][] => { const out: Button[][] = []; for (let i = 0; i < btns.length; i += per) out.push(btns.slice(i, i + per)); return out; };
const L = (c: Conversation): Lang => (c.language ?? 'en') as Lang;
const navRow = (lang: Lang, back = true): Button[] => [...(back ? [{ text: t(lang, 'nav_back'), data: 'nav:back' }] : []), { text: t(lang, 'nav_cancel'), data: 'nav:cancel' }];
const humanBtn = (lang: Lang): Button => ({ text: t(lang, 'nav_human'), data: 'm:reception' });

async function reply(conv: Conversation, text: string, kb?: Keyboard) {
  try { await botSend(conv, text, kb); } catch (e) { console.error('[bot send]', (e as Error).message); }
}

function mainMenu(lang: Lang): Keyboard {
  const items: [string, string][] = [['new_booking', 'menu_new_booking'], ['availability', 'menu_availability'], ['my_reservation', 'menu_my_reservation'], ['extend', 'menu_extend'], ['rooms', 'menu_rooms'], ['info', 'menu_info'], ['payment', 'menu_payment'], ['reception', 'menu_reception'], ['language', 'menu_language']];
  return { inline: rows(items.map(([a, k]) => ({ text: t(lang, k), data: 'm:' + a })), 2) };
}
const languageKb = (): Keyboard => ({ inline: [LANGS.map((l) => ({ text: LANG_LABEL[l], data: 'lang:' + l }))] });
const showMenu = (conv: Conversation, intro = 'welcome') => reply(conv, t(L(conv), intro), mainMenu(L(conv)));

async function resetFlow(conv: Conversation) { await saveState(conv.id, { flow: 'idle', step: 'start', data: {} }); }

/* ───────────────────────── booking flow ───────────────────────── */
function missingStep(d: Data, needNationality: boolean, needGov = false): string {
  if (!d.checkIn) return 'checkin';
  if (!d.checkOut) return 'checkout';
  if (!d.guests) return 'guests';
  if (!d.roomTypeId) return 'room';
  if (needNationality && !d.nationality) return 'nationality';
  if (needGov && !d.idGov) return 'idgov';
  if (!d.name) return 'name';
  if (!d.phoneDone) return 'phone';
  return 'review';
}

async function needsNationality(conv: Conversation): Promise<boolean> {
  const facts = requiredFacts(await activeRules());
  if (!facts.includes('nationality')) return false;
  if (conv.guest_id) { const g = (await q<any>('SELECT nationality FROM guests WHERE id=$1', [conv.guest_id]))[0]; if (g?.nationality) return false; }
  return true;
}

async function storedNationality(conv: Conversation, d: Data): Promise<string | undefined> {
  if (d.nationality) return d.nationality;
  if (conv.guest_id) return (await q<any>('SELECT nationality FROM guests WHERE id=$1', [conv.guest_id]))[0]?.nationality ?? undefined;
  return undefined;
}

/** Egyptian guests must also tell us the governorate on their ID, but only if an active rule depends on it. */
async function needsGov(conv: Conversation, d: Data): Promise<boolean> {
  if (!requiredFacts(await activeRules()).includes('id_governorate')) return false;
  return (await storedNationality(conv, d)) === 'EG';
}

/** Early refusal so the guest does not fill the whole form first. Returns true if the booking was refused. */
async function policyGate(conv: Conversation, d: Data): Promise<boolean> {
  if (!d.roomTypeId) return false;
  const rt = (await q<any>('SELECT kind, gender FROM room_types WHERE id=$1', [d.roomTypeId]))[0];
  if (!rt) return false;
  const out = evaluate(await activeRules(), { nationality: await storedNationality(conv, d), id_governorate: d.idGov, room_kind: rt.kind, room_gender: rt.gender });
  if (!out.blocked) return false;
  const lang = L(conv);
  const key = (out.blocked.message as any)?.key;
  await reply(conv, t(lang, key === 'dorm' ? 'blocked_dorm' : key === 'id' ? 'blocked_id' : 'blocked_generic'), { inline: [[{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] });
  if (key === 'dorm') { d.roomTypeId = null; await saveState(conv.id, { step: 'room', data: d }); } // let them pick another room
  else await resetFlow(conv);
  return true;
}

async function persistBookingActivity(conv: Conversation, d: Data) {
  const delay = (await q<any>(`SELECT delay_minutes, enabled FROM automation_rules WHERE kind='incomplete_booking'`))[0];
  if (delay?.enabled && d.startedAt) await reschedule('incomplete_booking', new Date(Date.now() + delay.delay_minutes * 60_000), `incomplete:${conv.id}:${d.startedAt}`, { conversationId: conv.id, guestId: conv.guest_id });
}

async function advance(conv: Conversation, d: Data, tgUser?: { first_name?: string }): Promise<void> {
  const lang = L(conv);
  const needNat = await needsNationality(conv);
  if (!d.startedAt) d.startedAt = Date.now();
  const step = missingStep(d, needNat, await needsGov(conv, d));
  if (['name', 'phone', 'review'].includes(step) && (await policyGate(conv, d))) { return d.roomTypeId === null ? advance(conv, d, tgUser) : undefined; }
  await saveState(conv.id, { flow: 'booking', step, data: d });
  await persistBookingActivity(conv, d);
  const today = todayLocal();

  if (step === 'checkin') {
    const days = Array.from({ length: 6 }, (_, i) => addDays(today, i));
    const btns: Button[] = days.map((iso, i) => ({ text: i === 0 ? t(lang, 'today') : i === 1 ? t(lang, 'tomorrow') : fmtDay(iso, lang), data: 'd:' + iso }));
    return reply(conv, t(lang, 'ask_checkin'), { inline: [...rows(btns, 3), [{ text: t(lang, 'other_date'), data: 'x:checkin' }], navRow(lang, false)] });
  }
  if (step === 'checkout') {
    const btns: Button[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ text: t(lang, 'nights_n', { n }), data: 'n:' + n }));
    return reply(conv, t(lang, 'ask_checkout'), { inline: [...rows(btns, 3), [{ text: t(lang, 'other_date'), data: 'x:checkout' }], navRow(lang)] });
  }
  if (step === 'guests') {
    const btns: Button[] = [1, 2, 3, 4, 5, 6].map((n) => ({ text: String(n), data: 'g:' + n }));
    return reply(conv, t(lang, 'ask_guests'), { inline: [...rows(btns, 6), [{ text: t(lang, 'guests_more'), data: 'x:guests' }], navRow(lang)] });
  }
  if (step === 'room') return showOptions(conv, d);
  if (step === 'nationality') return reply(conv, t(lang, 'ask_nationality'), { inline: [navRow(lang)] });
  if (step === 'idgov') return reply(conv, t(lang, 'ask_governorate'), { inline: [navRow(lang)] });
  if (step === 'name') {
    const fn = tgUser?.first_name?.trim();
    const kb: Button[][] = fn ? [[{ text: t(lang, 'use_name', { name: fn }), data: 'u:name' }]] : [];
    d.suggestedName = fn;
    await saveState(conv.id, { data: d });
    return reply(conv, t(lang, 'ask_name'), { inline: [...kb, navRow(lang)] });
  }
  if (step === 'phone') return reply(conv, t(lang, 'ask_phone'), { reply: [[{ text: t(lang, 'share_phone'), requestContact: true }], [{ text: t(lang, 'skip') }]] });
  return showReview(conv, d);
}

async function showOptions(conv: Conversation, d: Data): Promise<void> {
  const lang = L(conv);
  await reply(conv, t(lang, 'searching'));
  const av = await availabilityFor(d.checkIn, d.checkOut, d.guests);
  const ok = av.filter((a) => a.canFit);
  if (!ok.length) {
    await saveState(conv.id, { step: 'room', data: d });
    return reply(conv, t(lang, 'none_available'), { inline: [[{ text: t(lang, 'try_other_dates'), data: 'm:new_booking' }], [humanBtn(lang)], navRow(lang)] });
  }
  const cur = await getSetting<string>('currency');
  const lines = ok.map((a) => (a.totalCents != null ? t(lang, 'option_line', { name: localName(a.name, lang), total: fmtMoney(a.totalCents, cur) }) : t(lang, 'option_no_price', { name: localName(a.name, lang) })));
  const text = t(lang, 'options_header', { checkin: d.checkIn, checkout: d.checkOut, nights: nightsBetween(d.checkIn, d.checkOut), guests: d.guests }) + '\n\n' + lines.join('\n');
  await saveState(conv.id, { step: 'room', data: d });
  await reply(conv, text, { inline: [...ok.map((a) => [{ text: localName(a.name, lang), data: 'r:' + a.roomTypeId }]), navRow(lang)] });
}

async function showReview(conv: Conversation, d: Data): Promise<void> {
  const lang = L(conv);
  const av = (await availabilityFor(d.checkIn, d.checkOut, d.guests)).find((a) => a.roomTypeId === d.roomTypeId);
  if (!av?.canFit) { d.roomTypeId = null; await saveState(conv.id, { data: d }); await reply(conv, t(lang, 'availability_gone')); return advance(conv, d); }
  const cur = await getSetting<string>('currency');
  const nights = nightsBetween(d.checkIn, d.checkOut);
  const lines = av.totalCents != null ? '' : '⚠️ ' + t(lang, 'option_no_price', { name: localName(av.name, lang) });
  const total = av.totalCents != null ? fmtMoney(av.totalCents, cur) : '—';
  d.quotedTotal = av.totalCents;
  await saveState(conv.id, { step: 'review', data: d });
  await reply(conv, t(lang, 'review_title') + '\n\n' + t(lang, 'review_body', { checkin: d.checkIn, checkout: d.checkOut, nights, guests: d.guests, room: localName(av.name, lang), total, lines, name: d.name }),
    { inline: [[{ text: t(lang, 'send_request'), data: 'a:submit' }], [{ text: t(lang, 'edit'), data: 'm:new_booking' }], navRow(lang)] });
}

async function submit(conv: Conversation, d: Data, from: any): Promise<void> {
  const lang = L(conv);
  if (!d.checkIn || !d.checkOut || !d.guests || !d.roomTypeId || !d.name) return advance(conv, d, from);
  try {
    const nat = d.nationality ?? (conv.guest_id ? (await q<any>('SELECT nationality FROM guests WHERE id=$1', [conv.guest_id]))[0]?.nationality : undefined);
    const res = await createReservation({
      guest: { fullName: d.name, phone: d.phone ?? null, nationality: nat ?? null, language: lang, telegramChatId: Number(conv.external_id) },
      roomTypeId: d.roomTypeId, checkIn: d.checkIn, checkOut: d.checkOut, guestsCount: d.guests, source: 'telegram', status: 'pending',
      facts: { nationality: nat ?? undefined, id_governorate: d.idGov }, actor: 'bot',
    });
    await saveState(conv.id, { flow: 'idle', step: 'start', data: { lastReservationId: res.id }, guest_id: res.guest_id, reservation_id: res.id });
    await cancelFollowups({ conversationId: conv.id, kinds: ['incomplete_booking'] });
    const pay = localized(await getSetting('payment_instructions'), lang);
    let msg = t(lang, 'request_created', { ref: res.reference, until: res.hold_expires_at ? fmtWhen(new Date(res.hold_expires_at), lang) : '—' });
    if (res.needs_review) msg += '\n\n' + t(lang, 'needs_review_note');
    msg += '\n\n' + (pay ? pay + '\n' + t(lang, 'payment_help_note') : t(lang, 'payment_pending_info'));
    await reply(conv, msg, mainMenu(lang));
    await notifyStaff(`🆕 New Telegram booking request ${res.reference}: ${d.name}, ${d.checkIn} → ${d.checkOut}, ${d.guests} guest(s)${res.needs_review ? ' (needs review)' : ''}`);
  } catch (e) {
    if (e instanceof BookingError && e.code === 'NO_AVAILABILITY') { d.roomTypeId = null; await saveState(conv.id, { data: d }); await reply(conv, t(lang, 'availability_gone')); return advance(conv, d, from); }
    if (e instanceof BookingError && e.code === 'POLICY_BLOCKED') { const k = (e.detail as any)?.key; await reply(conv, t(lang, k === 'dorm' ? 'blocked_dorm' : k === 'id' ? 'blocked_id' : 'blocked_generic'), mainMenu(lang)); return resetFlow(conv); }
    if (e instanceof BookingError && ['NO_RATE'].includes(e.code)) { await handoff(conv, 'Price not configured for requested dates', 'Quote the stay manually'); return; }
    if (e instanceof BookingError && ['PAST_DATE', 'INVALID_DATES', 'TOO_LONG'].includes(e.code)) { await reply(conv, t(lang, e.code === 'TOO_LONG' ? 'too_long' : 'past_date')); return restartDates(conv, d); }
    console.error('[submit]', e);
    await handoff(conv, 'Technical problem creating a booking request', 'Contact the guest and create the booking manually');
  }
}
async function restartDates(conv: Conversation, d: Data) { delete d.checkIn; delete d.checkOut; d.roomTypeId = null; return advance(conv, d); }

/* ───────────────────────── other flows ───────────────────────── */
async function handoff(conv: Conversation, reason: string, recommended: string, priority: 'low' | 'normal' | 'high' = 'normal') {
  const lang = L(conv);
  const transcript = await basicSummary(conv.id);
  const summary = (await summarize(transcript)) ?? transcript;
  await saveState(conv.id, { flow: 'reception', step: 'waiting' });
  await escalate(conv.id, reason, { priority, recommended, summary, missing: conv.flow === 'booking' ? `Booking in progress: ${JSON.stringify(conv.data)}` : undefined });
  await reply(conv, t(lang, 'reception_ask'), { inline: [[{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] });
}

async function guestReservations(conv: Conversation, statuses: string[]) {
  return q<any>(`SELECT r.*, COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.reservation_id=r.id AND p.status='verified'),0)::bigint paid
    FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE g.telegram_chat_id=$1 AND r.status = ANY($2::text[]) ORDER BY r.check_in DESC LIMIT 6`, [Number(conv.external_id), statuses]);
}

async function showReservation(conv: Conversation, r: any) {
  const lang = L(conv);
  await reply(conv, t(lang, 'res_details', { ref: r.reference, status: t(lang, 'status_' + r.status), checkin: r.check_in, checkout: r.check_out, guests: r.guests_count, total: fmtMoney(r.total_cents, r.currency), paid: fmtMoney(r.paid, r.currency), balance: fmtMoney(r.total_cents - r.paid, r.currency) }),
    { inline: [...(['confirmed', 'checked_in'].includes(r.status) ? [[{ text: t(lang, 'menu_extend'), data: 'e:' + r.id }]] : []), [{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] });
}

async function lookupByReference(conv: Conversation, refRaw: string): Promise<any | 'notyours' | null> {
  const ref = refRaw.trim().toUpperCase().replace(/\s+/g, '');
  const r = (await q<any>(`SELECT r.*, g.telegram_chat_id tgc, COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.reservation_id=r.id AND p.status='verified'),0)::bigint paid FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.reference=$1`, [ref]))[0];
  if (!r) return null;
  if (r.tgc && Number(r.tgc) !== Number(conv.external_id)) return 'notyours';
  if (!r.tgc) { await q('UPDATE guests SET telegram_chat_id=$2 WHERE id=$1 AND telegram_chat_id IS NULL', [r.guest_id, Number(conv.external_id)]); await saveState(conv.id, { guest_id: r.guest_id }); }
  return r;
}

async function startExtend(conv: Conversation, reservationId?: string) {
  const lang = L(conv);
  const list = (await guestReservations(conv, ['confirmed', 'checked_in'])).filter((r) => r.check_out >= todayLocal());
  const pick = reservationId ? list.find((r) => r.id === reservationId) : list.length === 1 ? list[0] : null;
  if (pick) {
    const d: Data = { extReservationId: pick.id, extCheckOut: pick.check_out };
    await saveState(conv.id, { flow: 'extension', step: 'ext_date', data: d });
    const btns: Button[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ text: t(lang, 'ext_extra_n', { n }), data: 'en:' + n }));
    return reply(conv, t(lang, 'ext_ask_date', { checkout: pick.check_out }), { inline: [...rows(btns, 4), [{ text: t(lang, 'other_date'), data: 'x:extdate' }], navRow(lang, false)] });
  }
  if (list.length > 1) return reply(conv, t(lang, 'ext_pick'), { inline: [...list.map((r) => [{ text: `${r.reference} · ${r.check_in} → ${r.check_out}`, data: 'e:' + r.id }]), navRow(lang, false)] });
  await saveState(conv.id, { flow: 'lookup', step: 'reference', data: { then: 'extend' } });
  return reply(conv, t(lang, 'ext_none') + '\n\n' + t(lang, 'ask_reference'), { inline: [[humanBtn(lang)], navRow(lang, false)] });
}

async function doExtension(conv: Conversation, newOut: string) {
  const lang = L(conv);
  const d = conv.data;
  if (!d.extReservationId) return showMenu(conv, 'help_hint');
  if (!isIsoDate(newOut) || newOut <= d.extCheckOut) return reply(conv, t(lang, 'bad_order'));
  try {
    const ext = await requestExtension(d.extReservationId, newOut, 'telegram');
    const r = (await q<any>('SELECT reference, currency FROM reservations WHERE id=$1', [d.extReservationId]))[0];
    await saveState(conv.id, { flow: 'idle', step: 'start', data: {} });
    if (ext.status === 'pending') {
      await reply(conv, t(lang, 'ext_created_ok', { newout: newOut, nights: ext.extra_nights, extra: fmtMoney(ext.extra_cents, r.currency) }), mainMenu(lang));
      await notifyStaff(`➕ Extension request for ${r.reference} → ${newOut} (+${ext.extra_nights} night(s)). Approve in the dashboard.`);
    } else {
      await reply(conv, t(lang, 'ext_created_conflict'), mainMenu(lang));
      await notifyStaff(`⚠️ Extension request for ${r.reference} → ${newOut} has a conflict: ${ext.conflict_detail}`);
    }
  } catch (e) {
    if (e instanceof BookingError) { await reply(conv, e.code === 'TOO_LONG' ? t(lang, 'too_long') : e.code === 'CONFLICT' ? t(lang, 'reception_notified') : t(lang, 'unsupported'), { inline: [[humanBtn(lang)]] }); return; }
    console.error('[extension]', e);
    await handoff(conv, 'Technical problem handling an extension', 'Handle the extension manually');
  }
}

async function showRooms(conv: Conversation) {
  const lang = L(conv);
  const types = await q<any>('SELECT * FROM room_types WHERE active ORDER BY sort_order, code');
  const cur = await getSetting<string>('currency');
  const today = todayLocal();
  const lines: string[] = [];
  for (const rt of types) {
    const rate = (await q<any>(`SELECT price_cents FROM rates WHERE room_type_id=$1 AND valid_during @> $2::date ORDER BY priority DESC, price_cents LIMIT 1`, [rt.id, today]))[0];
    lines.push(rate ? t(lang, 'rooms_line', { name: localName(rt.name, lang), price: fmtMoney(rate.price_cents, cur) }) : t(lang, 'rooms_line_noprice', { name: localName(rt.name, lang) }));
  }
  await reply(conv, [t(lang, 'rooms_header'), ...lines, '', t(lang, 'rooms_footer')].join('\n'), { inline: [[{ text: t(lang, 'menu_new_booking'), data: 'm:new_booking' }], [{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] });
}

async function approvedFacts(lang: Lang) {
  const h = await getSetting<any>('hostel');
  const facts: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h ?? {})) if (v) facts['hostel_' + k] = v;
  for (const k of ['house_rules', 'cancellation_policy', 'payment_instructions']) { const v = localized(await getSetting(k), lang); if (v) facts[k] = v; }
  return facts;
}

async function showInfo(conv: Conversation, question?: string) {
  const lang = L(conv);
  const facts = await approvedFacts(lang);
  if (question && geminiEnabled()) {
    try { const a = await answerFromFacts(question, facts, lang); if (a) return reply(conv, a, { inline: [[{ text: t(lang, 'nav_menu'), data: 'm:menu' }], [humanBtn(lang)]] }); } catch (e) { console.error('[answer]', (e as Error).message); }
    return reply(conv, t(lang, 'info_missing'), { inline: [[humanBtn(lang)], [{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] });
  }
  const h = await getSetting<any>('hostel');
  const extra = Object.entries(facts).filter(([k]) => k.startsWith('hostel_') && !['hostel_name', 'hostel_city'].includes(k)).map(([k, v]) => `${k.replace('hostel_', '')}: ${v}`);
  await reply(conv, [t(lang, 'info_body', { name: h?.name ?? 'Villa Layla Hostel', city: h?.city ?? 'Cairo' }), ...extra, '', t(lang, 'info_missing')].join('\n'), { inline: [[humanBtn(lang)], [{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] });
}

async function showPayment(conv: Conversation) {
  const lang = L(conv);
  const pay = localized(await getSetting('payment_instructions'), lang);
  await reply(conv, (pay ?? t(lang, 'payment_help_missing')) + '\n\n' + t(lang, 'payment_help_note'), { inline: [[humanBtn(lang)], [{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] });
}

/* ───────────────────────── input routing ───────────────────────── */
async function startBooking(conv: Conversation, from: any, prefill: Data = {}) {
  const d: Data = { ...prefill, startedAt: Date.now() };
  await advance(conv, d, from);
}

function applyExtracted(d: Data, ex: Extracted, today: string): string | null {
  if (ex.checkIn && isIsoDate(ex.checkIn)) { if (ex.checkIn < today) return 'past_date'; d.checkIn = ex.checkIn; }
  if (ex.checkOut && isIsoDate(ex.checkOut)) { const base = d.checkIn; if (!base || ex.checkOut > base) d.checkOut = ex.checkOut; else return 'bad_order'; }
  if (ex.guests && ex.guests >= 1 && ex.guests <= 40) d.guests = ex.guests;
  if (ex.name && !d.name) d.name = ex.name;
  if (ex.nationality && !d.nationality) d.nationality = normalizeNationality(ex.nationality);
  return null;
}

async function handleCallback(conv: Conversation, data: string, from: any): Promise<void> {
  const lang = L(conv);
  const d: Data = { ...conv.data };
  const today = todayLocal();
  const [kind, arg] = [data.split(':')[0], data.split(':').slice(1).join(':')];

  if (kind === 'lang') {
    if (!isLang(arg)) return;
    await saveState(conv.id, { language: arg });
    if (conv.guest_id) await q('UPDATE guests SET language=$2 WHERE id=$1', [conv.guest_id, arg]);
    const fresh = { ...conv, language: arg as Lang };
    const pending = conv.data.pendingText as string | undefined;
    if (conv.language) await reply(fresh, t(arg as Lang, 'lang_changed'));
    if (pending) { await saveState(conv.id, { data: { ...conv.data, pendingText: null } }); return handleText(fresh, pending, from); }
    return showMenu(fresh);
  }
  if (kind === 'm') {
    if (arg === 'menu') { await resetFlow(conv); await cancelFollowups({ conversationId: conv.id, kinds: ['incomplete_booking'] }); return showMenu(conv, 'help_hint'); }
    if (arg === 'new_booking' || arg === 'availability') return startBooking(conv, from);
    if (arg === 'my_reservation') {
      const list = await guestReservations(conv, ['hold', 'pending', 'confirmed', 'checked_in', 'checked_out']);
      if (!list.length) { await saveState(conv.id, { flow: 'lookup', step: 'reference', data: {} }); return reply(conv, t(lang, 'my_res_none') + '\n\n' + t(lang, 'ask_reference'), { inline: [navRow(lang, false)] }); }
      if (list.length === 1) return showReservation(conv, list[0]);
      return reply(conv, t(lang, 'menu_my_reservation'), { inline: [...list.map((r) => [{ text: `${r.reference} · ${r.check_in} → ${r.check_out}`, data: 'v:' + r.id }]), [{ text: t(lang, 'type_reference'), data: 'x:ref' }], navRow(lang, false)] });
    }
    if (arg === 'extend') return startExtend(conv);
    if (arg === 'rooms') return showRooms(conv);
    if (arg === 'info') return showInfo(conv);
    if (arg === 'payment') return showPayment(conv);
    if (arg === 'reception') return handoff(conv, 'Guest asked for a person', 'Reply to the guest', 'normal');
    if (arg === 'language') return reply(conv, t(lang, 'choose_language'), languageKb());
    return;
  }
  if (kind === 'v') { const r = (await guestReservations(conv, ['hold', 'pending', 'confirmed', 'checked_in', 'checked_out'])).find((x) => x.id === arg); return r ? showReservation(conv, r) : showMenu(conv); }
  if (kind === 'e') return startExtend(conv, arg);
  if (kind === 'en') {
    if (conv.flow !== 'extension') return showMenu(conv);
    return doExtension(conv, addDays(d.extCheckOut, Number(arg)));
  }
  if (kind === 'x') {
    const prompts: Record<string, [string, string]> = { checkin: ['await_checkin', 'ask_date_hint'], checkout: ['await_checkout', 'ask_date_hint'], guests: ['await_guests', 'ask_guests_number'], extdate: ['await_extdate', 'ask_date_hint'], ref: ['reference', 'ask_reference'] };
    const p = prompts[arg]; if (!p) return;
    if (arg === 'ref') await saveState(conv.id, { flow: 'lookup', step: 'reference', data: {} });
    else await saveState(conv.id, { step: p[0] });
    return reply(conv, t(lang, p[1]));
  }
  if (kind === 'nav') {
    if (arg === 'cancel') { await resetFlow(conv); await cancelFollowups({ conversationId: conv.id, kinds: ['incomplete_booking'] }); await reply(conv, t(lang, 'cancelled_flow')); return showMenu(conv, 'help_hint'); }
    if (arg === 'back') {
      if (conv.flow !== 'booking') return showMenu(conv, 'help_hint');
      const last = ORDER.find((k) => d[k]);
      if (last) delete d[last];
      if (last === 'phoneDone') delete d.phone;
      return advance(conv, d, from);
    }
  }
  if (conv.flow === 'booking' || ['d', 'n', 'g', 'r', 'u', 'a'].includes(kind)) {
    if (kind === 'd') { if (arg < today) return reply(conv, t(lang, 'past_date')); d.checkIn = arg; delete d.checkOut; return advance(conv, d, from); }
    if (kind === 'n') { d.checkOut = addDays(d.checkIn ?? today, Number(arg)); return advance(conv, d, from); }
    if (kind === 'g') { d.guests = Number(arg); d.roomTypeId = null; return advance(conv, d, from); }
    if (kind === 'r') { d.roomTypeId = arg; return advance(conv, d, from); }
    if (kind === 'u' && arg === 'name') { d.name = d.suggestedName; return advance(conv, d, from); }
    if (kind === 'a' && arg === 'submit') return submit(conv, d, from);
    if (kind === 'a' && arg === 'resume') { if (conv.flow === 'booking') return advance(conv, d, from); return showMenu(conv); }
  }
  return showMenu(conv, 'help_hint');
}

async function handleText(conv: Conversation, text: string, from: any, contactPhone?: string): Promise<void> {
  const lang = L(conv);
  const today = todayLocal();
  const d: Data = { ...conv.data };
  const step = conv.step;

  // reply-keyboard phone step
  if (conv.flow === 'booking' && step === 'phone') {
    if (contactPhone) d.phone = contactPhone;
    else if (text === t(lang, 'skip')) d.phone = null;
    else d.phone = text.trim().slice(0, 30);
    d.phoneDone = true;
    await reply(conv, '👍', { remove: true });
    return advance(conv, d, from);
  }
  if (conv.flow === 'reception') {
    await q(`UPDATE conversations SET status='needs_staff', updated_at=now() WHERE id=$1`, [conv.id]);
    return reply(conv, t(lang, 'reception_notified'), { inline: [[{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] });
  }

  // step-specific free-text answers
  if (conv.flow === 'booking') {
    if (['checkin', 'await_checkin'].includes(step) || ['checkout', 'await_checkout'].includes(step)) {
      let iso = parseDateText(text, today);
      if (!iso && geminiEnabled()) { try { const ex = await extract(text, today, lang); const err = applyExtracted(d, ex, today); if (err) return reply(conv, t(lang, err)); if (d.checkIn || d.checkOut) return advance(conv, d, from); } catch (e) { console.error('[extract]', (e as Error).message); } }
      if (!iso) return reply(conv, t(lang, 'bad_date'));
      if (step.endsWith('checkin')) { if (iso < today) return reply(conv, t(lang, 'past_date')); d.checkIn = iso; delete d.checkOut; }
      else { if (iso <= d.checkIn) return reply(conv, t(lang, 'bad_order')); d.checkOut = iso; }
      const v = validateStay(d.checkIn, d.checkOut ?? addDays(d.checkIn, 1), today, await getSetting<number>('max_nights'));
      if (!v.ok && v.code === 'too_long') { delete d.checkOut; await reply(conv, t(lang, 'too_long')); return advance(conv, d, from); }
      return advance(conv, d, from);
    }
    if (['guests', 'await_guests'].includes(step)) {
      const n = parseInt(toWestern(text), 10);
      if (!n || n < 1 || n > 40) return reply(conv, t(lang, 'ask_guests_number'));
      d.guests = n; d.roomTypeId = null; return advance(conv, d, from);
    }
    if (step === 'nationality') { d.nationality = normalizeNationality(text); return advance(conv, d, from); }
    if (step === 'idgov') { d.idGov = normalizeGovernorate(text); return advance(conv, d, from); }
    if (step === 'name') { d.name = text.trim().slice(0, 80); return advance(conv, d, from); }
  }
  if (conv.flow === 'lookup' && step === 'reference') {
    const r = await lookupByReference(conv, text);
    if (r === 'notyours') { await reply(conv, t(lang, 'res_not_yours'), { inline: [[humanBtn(lang)]] }); return; }
    if (!r) {
      d.refFails = (d.refFails ?? 0) + 1; await saveState(conv.id, { data: d });
      if (d.refFails >= 4) return handoff(conv, 'Guest cannot find their reservation reference', 'Look the guest up manually');
      return reply(conv, t(lang, 'res_not_found'), { inline: [[humanBtn(lang)], navRow(lang, false)] });
    }
    if (d.then === 'extend') { await resetFlow(conv); return startExtend({ ...conv, guest_id: r.guest_id }, r.id); }
    await resetFlow(conv); return showReservation(conv, r);
  }
  if (conv.flow === 'extension' && ['ext_date', 'await_extdate'].includes(step)) {
    const iso = parseDateText(text, today);
    if (!iso) return reply(conv, t(lang, 'bad_date'));
    return doExtension(conv, iso);
  }

  // free text -> intent (Gemini if configured, keywords otherwise). The model only classifies/extracts.
  let ex: Extracted = { intent: keywordIntent(text) };
  if (geminiEnabled()) { try { ex = await extract(text, today, lang); } catch (e) { console.error('[extract]', (e as Error).message); } }
  switch (ex.intent) {
    case 'greeting': return showMenu(conv);
    case 'cancel': return handleCallback(conv, 'nav:cancel', from);
    case 'change_language': return reply(conv, t(lang, 'choose_language'), languageKb());
    case 'reception': return handoff(conv, 'Guest asked for a person', 'Reply to the guest');
    case 'rooms': return showRooms(conv);
    case 'payment': return showPayment(conv);
    case 'extend': return startExtend(conv);
    case 'my_reservation': return handleCallback(conv, 'm:my_reservation', from);
    case 'new_booking': case 'availability': {
      const nd: Data = { startedAt: Date.now() };
      const err = applyExtracted(nd, ex, today); if (err) await reply(conv, t(lang, err));
      return advance(conv, nd, from);
    }
    case 'info': return showInfo(conv, text);
  }
  if (geminiEnabled()) { const facts = await approvedFacts(lang); try { const a = await answerFromFacts(text, facts, lang); if (a) return reply(conv, a, { inline: [[{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] }); } catch { /* fall through */ } }
  return reply(conv, t(lang, 'unsupported'), { inline: [[humanBtn(lang)], [{ text: t(lang, 'nav_menu'), data: 'm:menu' }]] });
}

/* ───────────────────────── entry point ───────────────────────── */
export async function handleTelegramUpdate(u: any) {
  const claimed = await q(`INSERT INTO processed_updates(channel, update_id) VALUES('telegram',$1) ON CONFLICT DO NOTHING RETURNING 1`, [u.update_id]);
  if (!claimed[0]) return; // already handled (restart / redelivery)

  const msg = u.message, cb = u.callback_query;
  const chatId = msg?.chat?.id ?? cb?.message?.chat?.id;
  if (!chatId || (msg?.chat?.type && msg.chat.type !== 'private')) return;
  const from = msg?.from ?? cb?.from ?? {};
  let conv = await getOrCreateConversation('telegram', String(chatId));
  if (!conv.guest_id) {
    const g = (await q<any>('SELECT id, language FROM guests WHERE telegram_chat_id=$1', [chatId]))[0];
    if (g) { await saveState(conv.id, { guest_id: g.id, language: conv.language ?? g.language }); conv = { ...conv, guest_id: g.id, language: conv.language ?? g.language }; }
  }

  if (cb) {
    await tg.answerCallback(cb.id);
    await logMessage(conv.id, 'in', 'guest', `[button] ${cb.data}`);
    if (conv.mode === 'human') return; // staff handles it; no automated replies
    if (!conv.language && !String(cb.data).startsWith('lang:')) return reply(conv, t(null, 'choose_language'), languageKb());
    return handleCallback(conv, cb.data, from);
  }

  let text: string | undefined = msg.text?.trim();
  let isVoice = false;
  const contactPhone: string | undefined = msg.contact?.phone_number;

  // Voice notes: transcribed by the AI provider (OpenRouter or Gemini). If it is the first message, the detected language becomes the guest's language.
  if (msg.voice || msg.audio) {
    isVoice = true;
    const media = msg.voice ?? msg.audio;
    try {
      if (!geminiEnabled()) throw new Error('no AI key');
      const file = await tg.downloadFile(media.file_id);
      const mime = (media.mime_type as string | undefined)?.split(';')[0] || 'audio/ogg';
      const r = await transcribeVoice(file.data, mime);
      if (!r.transcript) throw new Error('empty transcript');
      text = r.transcript;
      await logMessage(conv.id, 'in', 'guest', text, { kind: 'voice', externalMsgId: String(msg.message_id) });
      if (conv.mode === 'human') return;
      if (!conv.language) {
        if (r.language === 'other') { await saveState(conv.id, { data: { ...conv.data, pendingText: text } }); return reply(conv, t(null, 'choose_language'), languageKb()); }
        await saveState(conv.id, { language: r.language }); conv = { ...conv, language: r.language };
        if (conv.guest_id) await q('UPDATE guests SET language=$2 WHERE id=$1', [conv.guest_id, r.language]);
      }
      await reply(conv, t(L(conv), 'voice_heard', { text }));
    } catch (e) {
      console.error('[voice]', (e as Error).message);
      await logMessage(conv.id, 'in', 'guest', '[voice message — could not be transcribed]', { kind: 'voice' }).catch(() => {});
      if (conv.mode === 'human') return;
      if (!conv.language) return reply(conv, t(null, 'choose_language'), languageKb());
      return reply(conv, t(L(conv), 'voice_failed'), { inline: [[humanBtn(L(conv))]] });
    }
  } else {
    if (!text && !contactPhone) return; // photos, stickers etc. are ignored by the bot but visible to staff
    await logMessage(conv.id, 'in', 'guest', text ?? `[contact] ${contactPhone}`, { externalMsgId: String(msg.message_id) });
    if (conv.mode === 'human') { await q(`UPDATE conversations SET status='needs_staff' WHERE id=$1 AND status='resolved'`, [conv.id]); return; }
  }

  if (text === '/start' || text === '/menu') { if (!conv.language) return reply(conv, t(null, 'choose_language'), languageKb()); await resetFlow(conv); return showMenu(conv); }
  if (text === '/language') return reply(conv, t(null, 'choose_language'), languageKb());
  if (!conv.language) { await saveState(conv.id, { data: { ...conv.data, pendingText: isVoice ? text : null } }); return reply(conv, t(null, 'choose_language'), languageKb()); }
  return handleText(conv, text ?? '', from, contactPhone);
}
