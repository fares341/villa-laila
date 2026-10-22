import { q } from '@/lib/db';
import { getSetting, setSetting } from './settings';
import { BookingError } from './errors';
import { EVENT_COLS, tr, hiddenReason, eventMedia, type EventRow } from './events';
import {
  bookingDetail, bookingText, confirmEventBookingAdmin, cancelEventBookingAdmin, approveProofAdmin, rejectProofAdmin,
  updateEventBooking, ticketUrl, parseDate,
} from './event-admin';
import { addEventMedia, deleteEventMedia, setEventCover, updateEventField, setEventActive, togglePayMethod, createEventQuick, parseTime, type EventField } from './event-content';
import { walletLabel } from './wallets';
import { waLink, normalizePhone, type WaResult } from './whatsapp';
import { scheduleLabel, dateLabel } from '@/lib/event-dates';

/**
 * Telegram bot for the owner (separate from the guest bot). Every new event booking and every InstaPay /
 * Vodafone Cash receipt arrives here with buttons to approve, confirm, cancel or edit it, and events can be
 * created and edited step by step. Token and allowed chat IDs: Dashboard → Events → Settings.
 */

export type AdminBotConfig = { token: string; chat_ids: string[] };
export async function getAdminBotConfig(): Promise<AdminBotConfig> {
  const s = ((await getSetting<any>('admin_bot').catch(() => null)) ?? {}) as Partial<AdminBotConfig>;
  const ids = (s.chat_ids ?? []).map(String).filter(Boolean);
  return { token: s.token || process.env.ADMIN_BOT_TOKEN || '', chat_ids: ids.length ? ids : ['5622031108', '1815637749'] };
}
export async function saveAdminBotConfig(v: AdminBotConfig) { await setSetting('admin_bot', v); }

type Btn = { text: string; data?: string; url?: string };
type Kb = Btn[][];
export type ReplyKb = { keyboard: { text: string }[][]; resize_keyboard?: boolean; is_persistent?: boolean; one_time_keyboard?: boolean };

const markup = (kb?: Kb, replyKb?: ReplyKb) => {
  if (kb && kb.length) {
    return {
      inline_keyboard: kb
        .map((r) =>
          r
            .filter((b) => b.data || (b.url && /^https:\/\//.test(b.url)))
            .map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data!.slice(0, 64) }))
        )
        .filter((r) => r.length),
    };
  }
  if (replyKb) return replyKb;
  return undefined;
};

async function call<T = any>(token: string, method: string, body: Record<string, unknown> | FormData): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: isForm ? undefined : { 'content-type': 'application/json' }, body: isForm ? body : JSON.stringify(body) });
  const j: any = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description ?? res.status}`);
  return j.result as T;
}

export const adminApi = {
  async send(chatId: string, text: string, kb?: Kb, replyKb?: ReplyKb) {
    const { token } = await getAdminBotConfig(); if (!token) return null;
    return call(token, 'sendMessage', { chat_id: chatId, text: text.slice(0, 4000), reply_markup: markup(kb, replyKb), disable_web_page_preview: true });
  },
  async edit(chatId: string, messageId: number, text: string, kb?: Kb) {
    const { token } = await getAdminBotConfig(); if (!token) return null;
    return call(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000), reply_markup: markup(kb), disable_web_page_preview: true }).catch(() => adminApi.send(chatId, text, kb));
  },
  async file(chatId: string, kind: 'photo' | 'document', bytes: Buffer, mime: string, caption: string, kb?: Kb) {
    const { token } = await getAdminBotConfig(); if (!token) return null;
    const fd = new FormData();
    fd.append('chat_id', chatId); fd.append('caption', caption.slice(0, 1000));
    if (kb) fd.append('reply_markup', JSON.stringify(markup(kb)));
    fd.append(kind, new Blob([new Uint8Array(bytes)], { type: mime }), kind === 'photo' ? 'receipt.jpg' : mime === 'application/pdf' ? 'receipt.pdf' : 'file');
    return call(token, kind === 'photo' ? 'sendPhoto' : 'sendDocument', fd);
  },
  async answer(id: string, text?: string) {
    const { token } = await getAdminBotConfig(); if (!token) return;
    await call(token, 'answerCallbackQuery', { callback_query_id: id, text }).catch(() => {});
  },
  async download(fileId: string): Promise<Buffer> {
    const { token } = await getAdminBotConfig();
    const f = await call<{ file_path: string }>(token, 'getFile', { file_id: fileId });
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`);
    if (!res.ok) throw new Error('download failed');
    return Buffer.from(await res.arrayBuffer());
  },
};

async function toAll(text: string, kb?: Kb) {
  const { token, chat_ids } = await getAdminBotConfig();
  if (!token) return;
  for (const id of chat_ids) await adminApi.send(id, text, kb).catch((e) => console.error('[admin bot]', e.message));
}

/* ───────── Keyboards ───────── */

export const MAIN_MENU_KEYBOARD: ReplyKb = {
  keyboard: [
    [{ text: '📅 حجوزات اليوم' }, { text: '📋 الحجوزات القادمة' }],
    [{ text: '🎪 استعراض الفعاليات' }, { text: '➕ فعالية جديدة' }],
    [{ text: 'ℹ️ المساعدة' }, { text: '❌ إلغاء' }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

export const MAIN_INLINE_KB: Kb = [
  [{ text: '📅 حجوزات اليوم', data: 'cmd:today' }, { text: '📋 الحجوزات القادمة', data: 'cmd:bookings' }],
  [{ text: '🎪 استعراض الفعاليات', data: 'cmd:events' }, { text: '➕ إنشاء فعالية جديدة', data: 'n:start' }],
  [{ text: '🌐 فتح الداش بورد بالموقع', url: 'https://villalayla.168.231.81.69.sslip.io/dashboard/events' }],
];

async function bookingKb(b: any): Promise<Kb> {
  const open = !['cancelled', 'expired'].includes(b.status);
  const phone = normalizePhone(b.phone);
  const rows: Kb = [];
  if (open && b.status === 'pending_verification' && b.proof_id) rows.push([{ text: 'تأكيد الإيصال والحجز', data: `p:ok:${b.proof_id}` }, { text: 'رفض الإيصال', data: `p:no:${b.proof_id}` }]);
  else if (open && !b.confirmed_at) rows.push([{ text: 'تأكيد الحجز', data: `b:c:${b.id}` }]);
  if (open) rows.push([{ text: 'تعديل', data: `b:e:${b.id}` }, { text: 'إلغاء الحجز', data: `b:x:${b.id}` }]);
  rows.push([{ text: 'واتساب الضيف', url: phone ? `https://wa.me/${phone}` : '' }, { text: 'التذكرة', url: await ticketUrl(b) }]);
  return rows;
}

const waNote = (wa: WaResult, what: string) => wa.sent ? `\n${what} اتبعتت للضيف على واتساب.` : wa.link ? `\nابعت ${what} للضيف من الزرار (الرسالة مكتوبة جاهزة).` : '\nالضيف مش كاتب رقم موبايل.';
const waKb = (wa: WaResult, label: string): Kb => (!wa.sent && wa.link ? [[{ text: label, url: wa.link }]] : []);

/* ───────── Notifications (called by the website and the worker) ───────── */

export async function notifyNewEventBooking(bookingId: string) {
  const { token } = await getAdminBotConfig();
  if (!token) return;
  const b = await bookingDetail(bookingId);
  if (b.admin_notified_at) return;
  await q(`UPDATE event_bookings SET admin_notified_at=now() WHERE id=$1`, [bookingId]);
  const hint = b.pay_method === 'instapay' || b.pay_method === 'vodafone_cash'
    ? (b.status === 'pending_verification' ? '\nالإيصال وصل في رسالة لوحده.' : `\nاختار ${walletLabel(b.pay_method, true)} ولسه مارفعش الإيصال.`)
    : b.pay_method === 'paymob' && b.status === 'awaiting_payment' ? '\nبيدفع بالبطاقة دلوقتي (Paymob).' : '';
  await toAll(bookingText(b, 'حجز جديد') + hint, await bookingKb(b));
}

export async function notifyWalletProof(onlinePaymentId: string) {
  const { token, chat_ids } = await getAdminBotConfig();
  if (!token) return;
  const op = (await q<any>(`SELECT id, event_booking_id, provider, payer_name, payer_reference, proof, proof_mime, amount_cents, currency FROM online_payments WHERE id=$1`, [onlinePaymentId]))[0];
  if (!op?.event_booking_id) return;
  const b = await bookingDetail(op.event_booking_id);
  const caption = `إيصال ${walletLabel(op.provider, true)} · ${b.ticket_code}\n${tr(b.title, 'ar')} · ${b.event_date} · ${b.quantity} فرد\nالمبلغ: ${(Number(op.amount_cents) / 100).toLocaleString('en-US')} ${op.currency}\nالمحوِّل: ${op.payer_name || '—'}${op.payer_reference ? ` · رقم العملية ${op.payer_reference}` : ''}\nراجع الفلوس في التطبيق، وبعدها أكد.`;
  const kb: Kb = [[{ text: 'تأكيد الإيصال والحجز', data: `p:ok:${op.id}` }, { text: 'رفض', data: `p:no:${op.id}` }], [{ text: 'تفاصيل الحجز', data: `b:v:${b.id}` }]];
  for (const id of chat_ids) {
    if (op.proof) await adminApi.file(id, String(op.proof_mime).startsWith('image/') && !/heic|heif/.test(op.proof_mime) ? 'photo' : 'document', op.proof, op.proof_mime, caption, kb).catch((e) => console.error('[admin bot proof]', e.message));
    else await adminApi.send(id, caption, kb).catch(() => {});
  }
}

export async function notifyAttendance(bookingId: string) {
  const b = await bookingDetail(bookingId);
  await toAll(`${b.full_name} أكد إنه جاي · ${tr(b.title, 'ar')} ${b.start_time} · ${b.quantity} فرد (${b.ticket_code})`);
}

export async function notifyReminder(b: any, wa: WaResult) {
  if (wa.sent) return; // sent automatically; nothing for the owner to do
  await toAll(`تذكير الحضور لـ ${b.full_name} (${tr(b.title, 'ar')} ${b.start_time}).${wa.link ? ' اضغط الزرار وابعته على واتساب.' : ' الضيف مش كاتب رقم.'}`, waKb(wa, 'ابعت التذكير على واتساب'));
}

/* ───────── Conversation state ───────── */

type State = { step?: string; eventId?: string; bookingId?: string; field?: string; draft?: Record<string, any>; mediaKind?: string; added?: number };
const getState = async (chat: string): Promise<State> => ((await q<any>(`SELECT state FROM admin_bot_state WHERE chat_id=$1`, [chat]))[0]?.state ?? {}) as State;
const setState = (chat: string, s: State) => q(`INSERT INTO admin_bot_state(chat_id,state,updated_at) VALUES($1,$2,now()) ON CONFLICT (chat_id) DO UPDATE SET state=EXCLUDED.state, updated_at=now()`, [chat, JSON.stringify(s)]);
const clearState = (chat: string) => setState(chat, {});

const HELP = [
  '🌿 لوحة تحكم بوت إدارة فعاليات فيلا ليلى',
  '',
  'الأوامر السريعة بالأزرار:',
  '• 📅 حجوزات اليوم · قائمة حجوزات وتذاكر اليوم',
  '• 📋 الحجوزات القادمة · حجوزات الأيام القادمة',
  '• 🎪 استعراض الفعاليات · تعديل البيانات، الأسعار، الصور والفيديوهات',
  '• ➕ فعالية جديدة · إضافة فعالية جديدة خطوة بخطوة',
  '• ❌ إلغاء · إلغاء أي خطوة حالية',
  '',
  'كل حجز جديد وكل إيصال تحويل (InstaPay / فودافون كاش) بيوصلك هنا فوراً بأزرار التأكيد أو الإلغاء.',
].join('\n');

const EV_FIELDS: [EventField | string, string][] = [
  ['title_ar', 'الاسم عربي'], ['title_en', 'الاسم إنجليزي'], ['description_ar', 'الوصف عربي'], ['description_en', 'الوصف إنجليزي'],
  ['summary_ar', 'سطر مختصر عربي'], ['summary_en', 'سطر مختصر إنجليزي'], ['includes', 'بيشمل إيه'],
  ['date', 'التاريخ'], ['weekdays', 'أيام التكرار'], ['ends_on', 'آخر يوم للتكرار'], ['start_time', 'وقت البداية'], ['end_time', 'وقت النهاية'],
  ['price', 'السعر'], ['guest_price', 'سعر النزلاء'], ['cost', 'التكلفة للفرد'], ['capacity', 'عدد الأماكن'],
];
const FIELD_HINT: Record<string, string> = {
  date: 'اكتب التاريخ، مثلاً 2026-11-05 أو 5/11 (الفعالية هتبقى يوم واحد).',
  weekdays: 'اكتب الأيام، مثلاً: الجمعة السبت. أو اكتب: يومي.',
  ends_on: 'اكتب آخر تاريخ للتكرار، أو - لو مفيش نهاية.',
  start_time: 'اكتب الوقت، مثلاً 19:00 أو 7 م.', end_time: 'اكتب الوقت، مثلاً 22:30 أو 10:30 م.',
  price: 'اكتب السعر بالجنيه، مثلاً 350.', guest_price: 'اكتب سعر نزلاء الفندق، أو - لو نفس السعر.', cost: 'اكتب تكلفة الفرد بالجنيه.',
  capacity: 'اكتب عدد الأماكن في اليوم، أو 0 لو مفتوح.', includes: 'اكتب كل حاجة في سطر.',
};

async function eventRow(id: string) { return (await q<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE id=$1`, [id]))[0]; }

async function eventCard(e: EventRow): Promise<{ text: string; kb: Kb }> {
  const media = await eventMedia(e.id);
  const meals = media.filter((m) => m.kind === 'meal').length, videos = media.filter((m) => m.kind === 'video').length;
  const hidden = hiddenReason(e);
  const sched = scheduleLabel(e, 'ar', (d) => dateLabel(d, 'ar', { weekday: 'long', day: 'numeric', month: 'long' }));
  const text = [
    `${tr(e.title, 'ar')}${e.title?.en && e.title.en !== e.title.ar ? ` / ${e.title.en}` : ''}`,
    `${sched} · ${e.start_time}–${e.end_time}`,
    `السعر: ${Number(e.price_cents) / 100} جنيه${e.guest_price_cents != null ? ` · النزلاء ${Number(e.guest_price_cents) / 100}` : ''} · الأماكن: ${e.capacity ?? 'مفتوح'}`,
    `الدفع: ${(e.pay_methods ?? []).map((m) => (m === 'cash' ? 'كاش في المكان' : m === 'paymob' ? 'بطاقة' : walletLabel(m, true))).join('، ') || '—'}`,
    `الصور: غلاف ${e.image ? 'موجود' : 'مفيش'} · صور وجبات ${meals} · فيديو ${videos}`,
    hidden ? `مش ظاهرة على الموقع: ${hidden}` : '🟢 ظاهرة على الموقع',
    tr(e.description, 'ar') ? `\n${tr(e.description, 'ar').slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');
  const kb: Kb = [
    [{ text: '✏️ تعديل البيانات', data: `e:f:${e.id}` }, { text: '📋 الحجوزات', data: `e:b:${e.id}` }],
    [{ text: '🖼️ صورة الغلاف', data: `e:m:cover:${e.id}` }, { text: '🌅 شكل صفحة الفعالية', data: `e:m:hero:${e.id}` }],
    [{ text: '🍽️ صور الوجبات', data: `e:m:meal:${e.id}` }, { text: '🎬 فيديو', data: `e:m:video:${e.id}` }],
    [{ text: '💳 طرق الدفع', data: `e:p:${e.id}` }, { text: '🗑️ حذف وسائط', data: `e:d:${e.id}` }],
    [{ text: e.active ? '👁️ إخفاء من الموقع' : '🟢 نشر على الموقع', data: `e:a:${e.id}` }, { text: '🌐 فتح بالموقع', url: `${(await ticketUrl({ ticket_code: '' })).replace(/\/tickets\/$/, '')}/events/${e.slug}` }],
    [{ text: '🔙 قائمة الفعاليات', data: 'cmd:events' }, { text: '🏠 الرئيسية', data: 'cmd:help' }],
  ];
  return { text, kb };
}

async function listBookings(chat: string, from: string, to: string, eventId?: string) {
  const rows = await q<any>(`SELECT b.id FROM event_bookings b WHERE b.event_date BETWEEN $1 AND $2 AND b.status NOT IN ('cancelled','expired')
     AND NOT (b.status='awaiting_payment' AND b.hold_expires_at < now()) AND ($3::uuid IS NULL OR b.event_id=$3) ORDER BY b.event_date, b.created_at LIMIT 30`, [from, to, eventId ?? null]);
  if (!rows.length) {
    return adminApi.send(chat, `مفيش حجوزات في الفترة من ${from} لـ ${to}.`, [
      [{ text: '📅 حجوزات اليوم', data: 'cmd:today' }, { text: '📋 الحجوزات القادمة', data: 'cmd:bookings' }],
      [{ text: '🎪 استعراض الفعاليات', data: 'cmd:events' }, { text: '🏠 الرئيسية', data: 'cmd:help' }],
    ]);
  }
  await adminApi.send(chat, `📋 ${rows.length} حجز من ${from} لـ ${to}:`);
  for (const r of rows) { const b = await bookingDetail(r.id); await adminApi.send(chat, bookingText(b, 'حجز'), await bookingKb(b)); }
}

const todayCairo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
const plusDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

async function sendWelcome(chat: string) {
  await adminApi.send(chat, 'أهلاً بك في بوت إدارة فعاليات فيلا ليلى 🌿\nلوحة المفاتيح السريعة مفعّلة في الأسفل ⬇️', undefined, MAIN_MENU_KEYBOARD);
  return adminApi.send(chat, HELP, MAIN_INLINE_KB);
}

/* ───────── Update handler ───────── */

export async function handleAdminUpdate(u: any) {
  const { chat_ids } = await getAdminBotConfig();
  const msg = u.message ?? u.callback_query?.message;
  const chat = String(msg?.chat?.id ?? u.callback_query?.from?.id ?? '');
  if (!chat) return;
  if (!chat_ids.includes(chat)) {
    if (u.message) await adminApi.send(chat, `البوت ده للإدارة بس. رقم المحادثة بتاعك: ${chat}`).catch(() => {});
    return;
  }
  const actor = `telegram:${chat}`;
  try {
    if (u.callback_query) return await onCallback(chat, actor, u.callback_query);
    if (u.message) return await onMessage(chat, actor, u.message);
  } catch (e: any) {
    const m = e instanceof BookingError ? (e.message && e.message !== e.code ? e.message : e.code) : 'حصل خطأ، جرب تاني.';
    if (!(e instanceof BookingError)) console.error('[admin bot]', e);
    if (u.callback_query) await adminApi.answer(u.callback_query.id, String(m).slice(0, 180));
    await adminApi.send(chat, `مقدرتش: ${m}`, undefined, MAIN_MENU_KEYBOARD).catch(() => {});
  }
}

async function onCallback(chat: string, actor: string, cq: any) {
  const data: string = cq.data ?? '';
  const mid: number = cq.message?.message_id;
  const [k, a, x, y] = data.split(':');
  await adminApi.answer(cq.id);

  if (k === 'cmd') {
    if (a === 'today') { const t = todayCairo(); return listBookings(chat, t, t); }
    if (a === 'bookings') { const t = todayCairo(); return listBookings(chat, t, plusDays(t, 14)); }
    if (a === 'events') return listEvents(chat);
    if (a === 'help') return sendWelcome(chat);
    if (a === 'cancel') {
      await clearState(chat);
      return adminApi.send(chat, 'تمام، تم الإلغاء والرجوع للقائمة.', MAIN_INLINE_KB, MAIN_MENU_KEYBOARD);
    }
  }

  if (k === 'n') return startNew(chat);
  if (k === 'p') { // receipt
    if (a === 'ok') {
      const { b, wa } = await approveProofAdmin(x, actor);
      await adminApi.send(chat, `${bookingText(b, 'اتأكد الإيصال والحجز')}${waNote(wa, 'رسالة التأكيد')}`, [...waKb(wa, 'ابعت التأكيد على واتساب'), ...(await bookingKb(b))]);
    } else {
      const b = await rejectProofAdmin(x, actor);
      if (b) {
        const ar = b.language === 'ar';
        const text = ar ? `أهلاً ${b.full_name.split(/\s+/)[0]}، مش لاقيين التحويل الخاص بحجز ${b.ticket_code}. ممكن تبعت الإيصال تاني من هنا: ${await ticketUrl(b)}` : `Hi ${b.full_name.split(/\s+/)[0]}, we couldn't find your transfer for booking ${b.ticket_code}. Please send the receipt again here: ${await ticketUrl(b)}`;
        await adminApi.send(chat, `اترفض الإيصال (${b.ticket_code}). الضيف يقدر يرفعه تاني خلال 12 ساعة.`, [[{ text: 'بلّغ الضيف على واتساب', url: waLink(normalizePhone(b.phone), text) ?? '' }]]);
      }
    }
    return;
  }

  if (k === 'b') { // booking
    const id = x;
    if (a === 'v') { const b = await bookingDetail(id); return adminApi.send(chat, bookingText(b), await bookingKb(b)); }
    if (a === 'c') {
      const { b, wa } = await confirmEventBookingAdmin(id, actor);
      return adminApi.edit(chat, mid, `${bookingText(b, 'اتأكد الحجز')}${waNote(wa, 'رسالة التأكيد')}`, [...waKb(wa, 'ابعت التأكيد على واتساب'), ...(await bookingKb(b))]);
    }
    if (a === 'x') return adminApi.send(chat, 'أكيد عايز تلغي الحجز ده؟ الضيف هيتبعتله رسالة على واتساب.', [[{ text: 'أيوه، الغي', data: `b:xx:${id}` }, { text: 'إلغاء مع كتابة السبب', data: `b:xr:${id}` }], [{ text: 'لا', data: `b:v:${id}` }]]);
    if (a === 'xr') { await setState(chat, { step: 'cancel_reason', bookingId: id }); return adminApi.send(chat, 'اكتب سبب الإلغاء (هيتبعت للضيف).', [[{ text: '❌ تراجع', data: 'cmd:cancel' }]]); }
    if (a === 'xx') return doCancel(chat, actor, id, null);
    if (a === 'e') return adminApi.send(chat, 'تعدل إيه في الحجز؟', [
      [{ text: 'التاريخ', data: `bf:date:${id}` }, { text: 'العدد', data: `bf:quantity:${id}` }],
      [{ text: 'الاسم', data: `bf:full_name:${id}` }, { text: 'الموبايل', data: `bf:phone:${id}` }, { text: 'الإيميل', data: `bf:email:${id}` }],
      [{ text: '❌ إلغاء', data: `b:v:${id}` }],
    ]);
  }
  if (k === 'bf') {
    await setState(chat, { step: 'booking_field', bookingId: x, field: a });
    return adminApi.send(chat, a === 'date' ? 'اكتب التاريخ الجديد، مثلاً 2026-11-05 أو 5/11.' : a === 'quantity' ? 'اكتب العدد الجديد (السعر هيتحسب تاني).' : 'اكتب القيمة الجديدة.', [[{ text: '❌ إلغاء', data: `b:v:${x}` }]]);
  }

  if (k === 'e') { // event
    if (a === 'l') return listEvents(chat);
    if (a === 'v') { const e = await eventRow(x); const c = await eventCard(e); return adminApi.send(chat, c.text, c.kb); }
    if (a === 'f') return adminApi.send(chat, 'اختار اللي عايز تعدله:', [...chunk(EV_FIELDS.map(([f, l]) => ({ text: l, data: `ef:${f}:${x}` })), 2), [{ text: '🔙 رجوع للفعالية', data: `e:v:${x}` }]]);
    if (a === 'b') { const t = todayCairo(); return listBookings(chat, t, plusDays(t, 60), x); }
    if (a === 'a') { const e = await eventRow(x); await setEventActive(x, !e.active, actor); const c = await eventCard(await eventRow(x)); return adminApi.edit(chat, mid, c.text, c.kb); }
    if (a === 'p') return payMenu(chat, x);
    if (a === 'pt') { await togglePayMethod(y, x, actor); return payMenu(chat, y, mid); }
    if (a === 'm') { // x = cover|meal|video, y = id
      await setState(chat, { step: 'media', eventId: y, mediaKind: x, added: 0 });
      return adminApi.send(chat, x === 'cover' ? 'ابعت صورة الغلاف (اللي بتظهر في قايمة الفعاليات).' : x === 'hero' ? 'ابعت صور أو فيديو لأعلى صفحة الفعالية (مختلفين عن صورة الغلاف). لما تخلص اضغط "تم الانتهاء".' : x === 'meal' ? 'ابعت صور الوجبات (ممكن أكتر من صورة). لما تخلص اضغط "تم الانتهاء".' : 'ابعت الفيديو (من تليجرام لحد 20 ميجا، الأكبر ارفعه من الداش بورد) أو لينك يوتيوب / إنستجرام.', [
        [{ text: '✅ تم الانتهاء', data: `m:done:${y}` }, { text: '❌ إلغاء', data: `e:v:${y}` }]
      ]);
    }
    if (a === 'd') {
      const media = await eventMedia(x);
      if (!media.length) return adminApi.send(chat, 'مفيش صور وجبات أو فيديوهات على الفعالية دي.', [[{ text: '🔙 رجوع للفعالية', data: `e:v:${x}` }]]);
      return adminApi.send(chat, 'اختار اللي عايز تحذفه:', [...chunk(media.map((m, i) => ({ text: `${m.kind === 'meal' ? 'صورة وجبة' : m.kind === 'video' ? 'فيديو' : m.kind === 'hero' ? 'شكل الصفحة' : 'صورة'} ${i + 1}`, data: `md:${m.id}` })), 2), [{ text: '🔙 رجوع', data: `e:v:${x}` }]]);
    }
  }
  if (k === 'ef') {
    await setState(chat, { step: 'event_field', eventId: x, field: a });
    return adminApi.send(chat, FIELD_HINT[a] ?? 'اكتب القيمة الجديدة.', [[{ text: '❌ إلغاء', data: `e:v:${x}` }]]);
  }
  if (k === 'md') {
    const evId = await deleteEventMedia(a, actor);
    return adminApi.send(chat, 'اتحذف.', evId ? [[{ text: 'رجوع للفعالية', data: `e:v:${evId}` }]] : undefined);
  }
  if (k === 'm' && a === 'done') {
    const id = x;
    await clearState(chat);
    if (id) {
      const c = await eventCard(await eventRow(id));
      return adminApi.send(chat, 'تمام، تم حفظ الوسائط.\n\n' + c.text, c.kb);
    }
    return adminApi.send(chat, 'تمام، تم الانتهاء والرجوع للقائمة.', MAIN_INLINE_KB, MAIN_MENU_KEYBOARD);
  }
}

async function doCancel(chat: string, actor: string, id: string, reason: string | null) {
  const { b, wa } = await cancelEventBookingAdmin(id, actor, reason);
  await adminApi.send(chat, `${bookingText(b, 'اتلغى الحجز')}${waNote(wa, 'رسالة الإلغاء')}`, waKb(wa, 'ابعت الإلغاء على واتساب'));
}

async function payMenu(chat: string, id: string, mid?: number) {
  const e = await eventRow(id);
  const on = (m: string) => (e.pay_methods ?? []).includes(m as any);
  const kb: Kb = [
    [{ text: `${on('instapay') ? '[x]' : '[ ]'} إنستا باي`, data: `e:pt:instapay:${id}` }, { text: `${on('vodafone_cash') ? '[x]' : '[ ]'} فودافون كاش`, data: `e:pt:vodafone_cash:${id}` }],
    [{ text: `${on('cash') ? '[x]' : '[ ]'} كاش في المكان`, data: `e:pt:cash:${id}` }, { text: `${on('paymob') ? '[x]' : '[ ]'} بطاقة`, data: `e:pt:paymob:${id}` }],
    [{ text: '🔙 رجوع للفعالية', data: `e:v:${id}` }],
  ];
  const text = 'طرق الدفع المتاحة للفعالية دي (اضغط عشان تشغل أو تقفل):';
  return mid ? adminApi.edit(chat, mid, text, kb) : adminApi.send(chat, text, kb);
}

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

async function listEvents(chat: string) {
  const rows = await q<EventRow>(`SELECT ${EVENT_COLS} FROM events ORDER BY active DESC, sort_order, slug`);
  if (!rows.length) return adminApi.send(chat, 'مفيش فعاليات لسه. ابدأ بإنشاء واحدة:', [[{ text: '➕ فعالية جديدة', data: 'n:start' }]]);
  return adminApi.send(chat, '🎪 الفعاليات المتاحة:\n(اضغط على اسم الفعالية لتعديلها أو إدارة الصور والفيديوهات)', [
    ...rows.map((e) => [{ text: `${e.active && !hiddenReason(e) ? '🟢' : '⚪ (مخفية)'} ${tr(e.title, 'ar')}`, data: `e:v:${e.id}` }]),
    [{ text: '➕ إنشاء فعالية جديدة', data: 'n:start' }],
    [{ text: '🏠 القائمة الرئيسية', data: 'cmd:help' }],
  ]);
}

const NEW_STEPS: [string, string][] = [
  ['title', 'اسم الفعالية؟'],
  ['date', 'التاريخ؟ مثلاً 2026-11-05 أو 5/11'],
  ['start', 'بتبدأ الساعة كام؟ مثلاً 19:00 أو 7 م'],
  ['end', 'بتخلص الساعة كام؟'],
  ['price', 'سعر التذكرة للفرد بالجنيه؟'],
  ['capacity', 'عدد الأماكن؟ (0 لو مفتوح)'],
  ['description', 'اكتب وصف الفعالية (الأكل، البرنامج، أي تفاصيل).'],
];

async function onMessage(chat: string, actor: string, m: any) {
  const text: string = (m.text ?? m.caption ?? '').trim();
  const st = await getState(chat);

  if (/^\/(start|help)/.test(text) || text === 'ℹ️ المساعدة' || text === 'المساعدة' || text === 'مساعدة') {
    await clearState(chat);
    return sendWelcome(chat);
  }
  if (/^\/cancel/.test(text) || text === '❌ إلغاء' || text === 'إلغاء') {
    await clearState(chat);
    return adminApi.send(chat, 'تمام، تم الإلغاء والرجوع للقائمة.', MAIN_INLINE_KB, MAIN_MENU_KEYBOARD);
  }
  if (/^\/events/.test(text) || text === '🎪 استعراض الفعاليات' || text === '🎪 الفعاليات' || text === 'الفعاليات') {
    await clearState(chat);
    return listEvents(chat);
  }
  if (/^\/today/.test(text) || text === '📅 حجوزات اليوم' || text === 'حجوزات اليوم') {
    await clearState(chat);
    const t = todayCairo();
    return listBookings(chat, t, t);
  }
  if (/^\/bookings/.test(text) || text === '📋 الحجوزات القادمة' || text === 'الحجوزات القادمة' || text === 'الحجوزات') {
    await clearState(chat);
    const t = todayCairo();
    return listBookings(chat, t, plusDays(t, 14));
  }
  if (/^\/new/.test(text) || text === '➕ فعالية جديدة' || text === 'فعالية جديدة' || text === 'n:start') {
    return startNew(chat);
  }

  if (st.step === 'media' && st.eventId) return onMedia(chat, actor, m, st, text);
  if (st.step === 'new' && st.draft) return onNewStep(chat, actor, st, m, text);
  if (st.step === 'event_field' && st.eventId && st.field) {
    if (!text) return adminApi.send(chat, 'اكتب القيمة نص.');
    const e = await updateEventField(st.eventId, st.field as EventField, text, actor);
    await clearState(chat);
    const c = await eventCard(e);
    return adminApi.send(chat, 'اتحفظ واتحدث على الموقع.\n\n' + c.text, c.kb);
  }
  if (st.step === 'booking_field' && st.bookingId && st.field) {
    const b = await updateEventBooking(st.bookingId, st.field as any, text, actor);
    await clearState(chat);
    return adminApi.send(chat, bookingText(b, 'اتعدل الحجز'), await bookingKb(b));
  }
  if (st.step === 'cancel_reason' && st.bookingId) { await clearState(chat); return doCancel(chat, actor, st.bookingId, text.slice(0, 300)); }
  return sendWelcome(chat);
}

async function startNew(chat: string) {
  await setState(chat, { step: 'new', draft: { i: 0 } });
  return adminApi.send(chat, `➕ إنشاء فعالية جديدة (1/${NEW_STEPS.length}):\n${NEW_STEPS[0][1]}`, [[{ text: '❌ إلغاء', data: 'cmd:cancel' }]]);
}

async function onNewStep(chat: string, actor: string, st: State, m: any, text: string) {
  if (text === '❌ إلغاء' || text === 'إلغاء' || text === '/cancel') {
    await clearState(chat);
    return adminApi.send(chat, 'تم إلغاء إنشاء الفعالية.', MAIN_INLINE_KB, MAIN_MENU_KEYBOARD);
  }
  const d = st.draft!;
  const [key] = NEW_STEPS[d.i];
  const bad = (msg: string) => adminApi.send(chat, msg, [[{ text: '❌ إلغاء', data: 'cmd:cancel' }]]);
  if (key === 'title') { if (text.length < 2) return bad('اكتب اسم الفعالية.'); d.title = text; }
  if (key === 'date') { const v = parseDate(text); if (!v) return bad('مش فاهم التاريخ. اكتبه كده: 2026-11-05 أو 5/11'); d.date = v; }
  if (key === 'start' || key === 'end') { const t = parseTime(text); if (!t) return bad('اكتب الوقت كده: 19:00 أو 7 م'); d[key] = t; }
  if (key === 'price') { const n = Number(text.replace(/[^\d.]/g, '')); if (!(n >= 0) || text.replace(/[^\d.]/g, '') === '') return bad('اكتب رقم، مثلاً 350'); d.price = Math.round(n * 100); }
  if (key === 'capacity') { const n = parseInt(text.replace(/\D/g, '') || '0', 10); d.capacity = n > 0 ? n : null; }
  if (key === 'description') d.description = text;
  d.i += 1;
  if (d.i < NEW_STEPS.length) {
    await setState(chat, { step: 'new', draft: d });
    return adminApi.send(chat, `(${d.i + 1}/${NEW_STEPS.length}) ${NEW_STEPS[d.i][1]}`, [[{ text: '❌ إلغاء', data: 'cmd:cancel' }]]);
  }
  const id = await createEventQuick({ title: d.title, date: d.date, start: d.start, end: d.end, priceCents: d.price, capacity: d.capacity, description: d.description || '' }, actor);
  await setState(chat, { step: 'media', eventId: id, mediaKind: 'cover', added: 0 });
  return adminApi.send(chat, 'اتعملت الفعالية واتنشرت على الموقع. ابعت صورة الغلاف دلوقتي (أو اضغط "تم" لو هتضيفها بعدين).', [
    [{ text: '✅ تم (إضافة لاحقاً)', data: `m:done:${id}` }]
  ]);
}

async function onMedia(chat: string, actor: string, m: any, st: State, text: string) {
  const id = st.eventId!;
  const kind = st.mediaKind as 'cover' | 'meal' | 'video' | 'hero';
  const done = async () => { await clearState(chat); const c = await eventCard(await eventRow(id)); return adminApi.send(chat, (st.added ? `اتضاف ${st.added}.\n\n` : '') + c.text, c.kb); };
  if (/^(تم|خلاص|done|ok)$/i.test(text) && !m.photo && !m.video && !m.document) return done();

  const photo = m.photo?.length ? m.photo[m.photo.length - 1] : null;
  const doc = m.document && /^(image|video)\//.test(m.document.mime_type ?? '') ? m.document : null;
  const vid = m.video ?? (doc && /^video\//.test(doc.mime_type) ? doc : null);
  const img = photo ?? (doc && /^image\//.test(doc.mime_type) ? doc : null);

  if (kind === 'video' || (kind === 'hero' && vid)) {
    if (vid) {
      if (vid.file_size && vid.file_size > 20 * 1024 * 1024) return adminApi.send(chat, 'تليجرام مش بيسمح للبوتات تنزّل فيديو أكبر من 20 ميجا. ارفعه من الداش بورد (أي حجم) من صفحة الفعالية، أو ابعت لينك يوتيوب / إنستجرام.');
      const bytes = await adminApi.download(vid.file_id);
      const tall = vid.width && vid.height ? vid.height > vid.width : false;
      await addEventMedia(id, kind === 'hero' ? 'hero' : 'video', { bytes, mime: vid.mime_type || 'video/mp4' }, null, actor, null, tall ? 'portrait' : 'landscape');
    } else if (/^https?:\/\//.test(text)) await addEventMedia(id, 'video', null, text, actor);
    else return adminApi.send(chat, 'ابعت فيديو أو لينك، أو اضغط "تم الانتهاء".', [[{ text: '✅ تم الانتهاء', data: `m:done:${id}` }]]);
  } else {
    if (!img) return adminApi.send(chat, 'ابعت صورة، أو اضغط "تم الانتهاء".', [[{ text: '✅ تم الانتهاء', data: `m:done:${id}` }]]);
    const bytes = await adminApi.download(img.file_id);
    const file = { bytes, mime: img.mime_type || 'image/jpeg' };
    if (kind === 'cover') { await setEventCover(id, file, actor); st.added = (st.added ?? 0) + 1; return done(); }
    await addEventMedia(id, kind === 'hero' ? 'hero' : 'meal', file, null, actor, m.caption ?? null);
  }
  st.added = (st.added ?? 0) + 1;
  await setState(chat, st);
  return adminApi.send(chat, `اتضاف (${st.added}). ابعت كمان أو اضغط تم:`, [
    [{ text: '✅ تم الانتهاء', data: `m:done:${id}` }]
  ]);
}

/* ───────── Polling (worker) ───────── */

export async function adminPollLoop(log: (...a: unknown[]) => void) {
  let token = '';
  let offset = 0;
  for (;;) {
    const cfg = await getAdminBotConfig().catch(() => ({ token: '', chat_ids: [] }));
    if (!cfg.token) { await new Promise((r) => setTimeout(r, 60_000)); continue; }
    if (cfg.token !== token) {
      token = cfg.token;
      try { const me = await call<{ username: string }>(token, 'getMe', {}); await call(token, 'deleteWebhook', { drop_pending_updates: false }); log('Admin bot connected as @' + me.username); }
      catch (e) { log('Admin bot token not working:', (e as Error).message); await new Promise((r) => setTimeout(r, 60_000)); token = ''; continue; }
      const last = (await q<any>(`SELECT max(update_id) m FROM processed_updates WHERE channel='admin_telegram'`))[0]?.m;
      offset = last ? Number(last) + 1 : 0;
    }
    try {
      const updates = await call<any[]>(token, 'getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        const fresh = await q(`INSERT INTO processed_updates(channel, update_id) VALUES('admin_telegram',$1) ON CONFLICT DO NOTHING RETURNING 1`, [u.update_id]);
        if (fresh.length) await handleAdminUpdate(u).catch((e) => console.error('[admin update]', e));
      }
    } catch (e) { console.error('[admin poll]', (e as Error).message); await new Promise((r) => setTimeout(r, 5000)); }
  }
}

/** Send a test message (Settings page button). */
export async function testAdminBot(): Promise<string> {
  const { token, chat_ids } = await getAdminBotConfig();
  if (!token) throw new BookingError('INVALID_INPUT', 'Paste the bot token first');
  const me = await call<{ username: string }>(token, 'getMe', {});
  for (const id of chat_ids) {
    await adminApi.send(id, `بوت إدارة فعاليات فيلا ليلى شغال (@${me.username}) 🌿\nلوحة المفاتيح مفعّلة في الأسفل:`, undefined, MAIN_MENU_KEYBOARD);
    await adminApi.send(id, 'اختر من الأزرار التالية للتحكم السريع:', MAIN_INLINE_KB);
  }
  return me.username;
}
