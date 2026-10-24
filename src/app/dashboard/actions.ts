'use server';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { toEmbed } from '@/content/videos';
import { q } from '@/lib/db';
import { requireUser, login, createSession, destroySession, hash } from '@/lib/auth';
import { toCents } from '@/lib/money';
import { BookingError } from '@/services/errors';
import { createReservation, confirmReservation, cancelReservation, rejectReservation, markNoShow, changeStay, reassignUnit, addNote } from '@/services/reservations';
import { checkInGuest, checkOutGuest, moveRoom } from '@/services/pms/frontdesk';
import { snapshotStay, afterStayChange } from '@/services/pms/sync';
import { requestExtension, decideExtension } from '@/services/extensions';
import { recordPayment, verifyPayment, WALLET_METHODS, type PaymentMethod } from '@/services/payments';
import { takeOver, staffSend, resolve, reopen, resumeBot, assign } from '@/services/conversations';
import { setSetting } from '@/services/settings';
import { audit } from '@/services/audit';
import { parseFile, guessMapping, commitImport, type Mapping, FIELDS } from '@/services/import';
import { notifyGuest } from '@/bot/notify';
import { normalizeNationality } from '@/bot/flow';

const enc = encodeURIComponent;
const FRIENDLY: Record<string, string> = {
  NO_AVAILABILITY: 'Those beds/rooms are not free for these dates (another reservation overlaps).', NO_RATE: 'No price is configured for these dates. Add a rate in Rooms & rates.',
  INVALID_DATES: 'Please check the dates (departure must be after arrival).', PAST_DATE: 'The arrival date is in the past.', TOO_LONG: 'That stay is longer than the allowed maximum.',
  BAD_STATE: '', PAYMENT_REQUIRED: 'A verified payment is required before confirming.', CONFLICT: '', NOT_FOUND: 'Record not found.', INVALID_INPUT: 'Please complete the required fields correctly.',
};
function friendly(e: any): string {
  if (e instanceof BookingError) return (e.message && e.message !== e.code ? e.message : FRIENDLY[e.code]) || e.code;
  if (String(e?.message).startsWith('FORBIDDEN')) return 'You do not have permission to do this.';
  if (e instanceof z.ZodError) return 'Please complete the form correctly: ' + e.issues.map((i) => i.path.join('.')).join(', ');
  if (e?.code === '23505') return 'That already exists.';
  console.error('[dashboard action]', e);
  return 'Something went wrong. Nothing was changed. If it keeps happening, tell the manager.';
}
const isRedirect = (e: any) => typeof e?.digest === 'string' && e.digest.startsWith('NEXT_REDIRECT');

/** Runs a mutation, then redirects back with a visible success or error banner. */
async function run(path: string, fn: () => Promise<string | void>): Promise<never> {
  let msg = 'Saved.';
  try { const m = await fn(); if (m) msg = m; }
  catch (e) { if (isRedirect(e)) throw e; redirect(`${path}${path.includes('?') ? '&' : '?'}err=${enc(friendly(e))}`); }
  redirect(`${path}${path.includes('?') ? '&' : '?'}ok=${enc(msg)}`);
}
const S = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const N = (f: FormData, k: string) => Number(S(f, k));
const back = (f: FormData, fallback: string) => S(f, 'back') || fallback;
const safeBack = (p: string) => (p.startsWith('/dashboard') ? p : '/dashboard');

/* ───── auth ───── */
export async function loginAction(f: FormData) {
  const h = await headers(); const ip = (h.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  const r = await login(S(f, 'email'), String(f.get('password') ?? ''), ip);
  if ('error' in r) redirect('/dashboard/login?err=' + enc(r.error));
  await createSession(r);
  await audit(r.email, 'auth.login');
  redirect('/dashboard');
}
export async function logoutAction() { await destroySession(); redirect('/dashboard/login'); }

/* ───── reservations ───── */
export async function createReservationAction(f: FormData) {
  const u = await requireUser('reservation.create');
  let id = '';
  return run('/dashboard/reservations/new', async () => {
    const status = z.enum(['hold', 'pending', 'confirmed']).parse(S(f, 'status'));
    if (status === 'confirmed') await requireUser('reservation.confirm');
    const res = await createReservation({
      guest: { fullName: S(f, 'fullName'), phone: S(f, 'phone') || null, email: S(f, 'email') || null, nationality: S(f, 'nationality') ? normalizeNationality(S(f, 'nationality')) : null, language: (S(f, 'language') || 'en') as any },
      roomTypeId: S(f, 'roomTypeId'), checkIn: S(f, 'checkIn'), checkOut: S(f, 'checkOut'), guestsCount: N(f, 'guests'), source: 'staff', status,
      staffNotes: S(f, 'notes') || undefined, createdBy: u.id, actor: u.email, facts: { nationality: S(f, 'nationality') ? normalizeNationality(S(f, 'nationality')) : undefined },
    });
    id = res.id;
    const unit = S(f, 'unitId');
    if (unit) { const ru = (await q<any>('SELECT id FROM reservation_units WHERE reservation_id=$1', [res.id])); if (ru.length === 1) { try { await reassignUnit(ru[0].id, unit, u.email); } catch { /* kept auto-assigned bed */ } } }
  }).catch((e) => { if (isRedirect(e) && id) redirect(`/dashboard/reservations/${id}?ok=${enc('Reservation created.')}`); throw e; });
}
export async function confirmAction(f: FormData) {
  const u = await requireUser('reservation.confirm'); const id = S(f, 'id');
  return run(`/dashboard/reservations/${id}`, async () => {
    await confirmReservation(id, u.email, u.id);
    const sent = await notifyGuest(id, 'confirmed');
    return sent ? 'Confirmed. The guest was notified on Telegram.' : 'Confirmed. (Guest has no Telegram chat — contact them by phone/email.)';
  });
}
export async function rejectAction(f: FormData) {
  const u = await requireUser('reservation.confirm'); const id = S(f, 'id');
  return run(`/dashboard/reservations/${id}`, async () => { await rejectReservation(id, S(f, 'reason') || null, u.email); const s = await notifyGuest(id, 'rejected'); return s ? 'Request rejected and guest notified.' : 'Request rejected.'; });
}
export async function cancelAction(f: FormData) {
  const u = await requireUser('reservation.cancel'); const id = S(f, 'id');
  return run(`/dashboard/reservations/${id}`, async () => { await cancelReservation(id, S(f, 'reason') || null, u.email); const s = await notifyGuest(id, 'cancelled'); return s ? 'Cancelled and guest notified.' : 'Cancelled.'; });
}
// Check-in / out go through the front-desk service so the folio, housekeeping and Little Hotelier stay in step.
export async function checkInAction(f: FormData) { const u = await requireUser('reservation.edit'); const id = S(f, 'id'); return run(`/dashboard/reservations/${id}`, async () => { await checkInGuest(id, u.email, u.id); return 'Checked in. The nights are on the bill.'; }); }
export async function checkOutAction(f: FormData) { const u = await requireUser('reservation.edit'); const id = S(f, 'id'); return run(`/dashboard/reservations/${id}`, async () => { await checkOutGuest(id, u.email); return 'Checked out. Room marked dirty.'; }); }
export async function noShowAction(f: FormData) { const u = await requireUser('reservation.edit'); const id = S(f, 'id'); return run(`/dashboard/reservations/${id}`, async () => { await markNoShow(id, u.email); return 'Marked as no-show.'; }); }
export async function changeDatesAction(f: FormData) {
  const u = await requireUser('reservation.edit'); const id = S(f, 'id');
  return run(`/dashboard/reservations/${id}`, async () => { const before = await snapshotStay(id); const r = await changeStay(id, S(f, 'checkIn'), S(f, 'checkOut'), u.email); await afterStayChange(id, before, u.id, 'reservation.change_dates'); return `Dates changed. New total ${(r.totalCents / 100).toFixed(2)}.`; });
}
export async function reassignAction(f: FormData) {
  const u = await requireUser('reservation.edit'); const id = S(f, 'id');
  // Same service as the folio's Move room: the old room goes to housekeeping if the guest was in it.
  return run(`/dashboard/reservations/${id}`, async () => { await moveRoom({ reservationUnitId: S(f, 'ruId'), reservationId: id, newUnitId: S(f, 'unitId'), actor: u.email, userId: u.id }); return 'Bed assignment changed.'; });
}
export async function addNoteAction(f: FormData) {
  const u = await requireUser('reservation.edit'); const id = S(f, 'id');
  return run(`/dashboard/reservations/${id}`, async () => { if (!S(f, 'note')) throw new BookingError('INVALID_INPUT'); await addNote(id, S(f, 'note'), u.name); return 'Note added.'; });
}

/* ───── payments ───── */
export async function recordPaymentAction(f: FormData) {
  const u = await requireUser('payment.record'); const id = S(f, 'id');
  return run(`/dashboard/reservations/${id}`, async () => {
    // Cash and card taken at the desk go through the folio so they land in the open shift drawer.
    // Cash and card are taken on the POS only. Here: an InstaPay / Vodafone Cash receipt, checked before it counts.
    if (!WALLET_METHODS.includes(S(f, 'method') as PaymentMethod)) throw new BookingError('INVALID_INPUT', 'Cash or card: take it on the POS.');
    if (S(f, 'reference').length < 4) throw new BookingError('INVALID_INPUT', 'Write the transaction number from the receipt');
    await recordPayment(id, toCents(S(f, 'amount')), S(f, 'method') as PaymentMethod, S(f, 'reference'), S(f, 'note') || null, u.id, u.email);
    return 'Receipt added. It counts as paid after a manager checks the money arrived.';
  });
}
export async function verifyPaymentAction(f: FormData) {
  const u = await requireUser('payment.verify'); const ok = S(f, 'decision') === 'verify';
  return run(safeBack(back(f, '/dashboard/payments')), async () => { await verifyPayment(S(f, 'id'), ok, u.id, u.email); return ok ? 'Payment verified.' : 'Payment rejected.'; });
}

/* ───── extensions ───── */
export async function createExtensionAction(f: FormData) {
  const u = await requireUser('reservation.edit'); const id = S(f, 'id');
  return run(`/dashboard/reservations/${id}`, async () => {
    const { extendStay } = await import('@/services/pms/extend');
    const nights = parseInt(S(f, 'nights'), 10);
    const r = await extendStay(id, nights > 0 ? { nights } : { newCheckOut: S(f, 'newCheckOut') }, u.email, u.id);
    return `Stay extended to ${r.newCheckOut} (+${r.nights} night${r.nights === 1 ? '' : 's'}, EGP ${(r.extraCents / 100).toLocaleString('en-US')} added to the bill).${r.balance > 0 ? ` Still to pay: EGP ${(r.balance / 100).toLocaleString('en-US')} on the POS.` : ''}`;
  });
}
export async function decideExtensionAction(f: FormData) {
  const u = await requireUser('extension.decide'); const dec = S(f, 'decision') === 'approve' ? 'approve' : 'reject';
  return run(safeBack(back(f, '/dashboard/extensions')), async () => {
    const extRes = (await q<any>('SELECT reservation_id FROM extension_requests WHERE id=$1', [S(f, 'id')]))[0];
    const before = extRes ? await snapshotStay(extRes.reservation_id) : null;
    const r = await decideExtension(S(f, 'id'), dec, u.email, u.id);
    if (r.status === 'conflict') return `Cannot extend: ${r.detail}. Nothing was changed.`;
    if (r.status === 'applied') await afterStayChange(r.reservationId, before, u.id, 'extension.apply');
    const sent = await notifyGuest(r.reservationId, r.status === 'applied' ? 'extension_applied' : 'extension_rejected', { extraCents: r.extra_cents });
    return (r.status === 'applied' ? 'Extension applied.' : 'Extension rejected.') + (sent ? ' Guest notified.' : '');
  });
}

/* ───── inbox ───── */
export async function takeOverAction(f: FormData) { const u = await requireUser('inbox.use'); const id = S(f, 'id'); return run(`/dashboard/inbox/${id}`, async () => { await takeOver(id, u.id, u.name); return 'You now own this conversation. Automatic replies are paused.'; }); }
export async function replyAction(f: FormData) { const u = await requireUser('inbox.use'); const id = S(f, 'id'); return run(`/dashboard/inbox/${id}`, async () => { const t = S(f, 'text'); if (!t) throw new BookingError('INVALID_INPUT'); await staffSend(id, u.id, u.name, t); return 'Message sent.'; }); }
export async function resolveAction(f: FormData) { const u = await requireUser('inbox.use'); const id = S(f, 'id'); return run(`/dashboard/inbox/${id}`, async () => { await resolve(id, u.email); return 'Marked as resolved.'; }); }
export async function reopenAction(f: FormData) { const u = await requireUser('inbox.use'); const id = S(f, 'id'); return run(`/dashboard/inbox/${id}`, async () => { await reopen(id, u.email); return 'Reopened.'; }); }
export async function resumeBotAction(f: FormData) { const u = await requireUser('inbox.use'); const id = S(f, 'id'); return run(`/dashboard/inbox/${id}`, async () => { await resumeBot(id, u.email); return 'Automatic replies resumed.'; }); }
export async function assignAction(f: FormData) { const u = await requireUser('inbox.use'); const id = S(f, 'id'); return run(`/dashboard/inbox/${id}`, async () => { await assign(id, S(f, 'userId') || null, u.email); return 'Assignment updated.'; }); }
export async function completeTaskAction(f: FormData) { await requireUser('dashboard.view'); return run(safeBack(back(f, '/dashboard')), async () => { await q(`UPDATE tasks SET status='done', completed_at=now() WHERE id=$1`, [S(f, 'id')]); return 'Task done.'; }); }

/* ───── rooms & rates ───── */
const loc = (f: FormData, p: string) => Object.fromEntries(['en', 'es', 'fr', 'ar'].map((l) => [l, S(f, `${p}_${l}`)]).filter(([, v]) => v));
export async function saveRoomTypeAction(f: FormData) {
  const u = await requireUser('inventory.manage');
  return run('/dashboard/rooms', async () => {
    const name = loc(f, 'name'); if (!name.en) throw new BookingError('INVALID_INPUT', 'English name is required');
    const amen = S(f, 'amenities').split('\n').map((s) => s.trim()).filter(Boolean).map((en) => ({ en }));
    const id = S(f, 'id');
    if (id) await q('UPDATE room_types SET name=$2, description=$3, amenities=$4, sort_order=$5, gender=$6, photos=$7 WHERE id=$1', [id, name, loc(f, 'desc'), JSON.stringify(amen), N(f, 'sort') || 0, z.enum(['mixed', 'female', 'male']).catch('mixed').parse(S(f, 'gender')), JSON.stringify(S(f, 'photos').split('\n').map((x) => x.trim()).filter((x) => /^https:\/\//.test(x)))]);
    else await q('INSERT INTO room_types(code,kind,name,description,amenities,sort_order,gender) VALUES($1,$2,$3,$4,$5,$6,$7)', [S(f, 'code').toLowerCase().replace(/[^a-z0-9-]+/g, '-') || 'type-' + Date.now(), z.enum(['dorm', 'private']).parse(S(f, 'kind')), name, loc(f, 'desc'), JSON.stringify(amen), N(f, 'sort') || 0, z.enum(['mixed', 'female', 'male']).catch('mixed').parse(S(f, 'gender'))]);
    await audit(u.email, 'inventory.room_type', 'room_type', id || null, name);
    return 'Room type saved.';
  });
}
export async function addRoomAction(f: FormData) {
  const u = await requireUser('inventory.manage');
  return run('/dashboard/rooms', async () => {
    const r = (await q<any>('INSERT INTO rooms(room_type_id,name) VALUES($1,$2) RETURNING id', [S(f, 'roomTypeId'), S(f, 'name')]))[0];
    const n = Math.max(0, Math.min(40, N(f, 'units') || 0)); const cap = Math.max(1, N(f, 'capacity') || 1); const prefix = S(f, 'prefix') || 'Bed';
    for (let i = 1; i <= n; i++) await q('INSERT INTO units(room_id,label,capacity) VALUES($1,$2,$3)', [r.id, n === 1 && prefix === 'Room' ? S(f, 'name') : `${prefix} ${i}`, cap]);
    await audit(u.email, 'inventory.room_add', 'room', r.id, { units: n });
    return `Room added with ${n} bookable unit(s).`;
  });
}
export async function addUnitsAction(f: FormData) {
  const u = await requireUser('inventory.manage');
  return run('/dashboard/rooms', async () => {
    const start = (await q<any>('SELECT count(*)::int n FROM units WHERE room_id=$1', [S(f, 'roomId')]))[0].n;
    const n = Math.max(1, Math.min(20, N(f, 'count') || 1));
    for (let i = 1; i <= n; i++) await q('INSERT INTO units(room_id,label,capacity) VALUES($1,$2,$3)', [S(f, 'roomId'), `${S(f, 'prefix') || 'Bed'} ${start + i}`, Math.max(1, N(f, 'capacity') || 1)]);
    await audit(u.email, 'inventory.units_add', 'room', S(f, 'roomId'), { n });
    return `${n} unit(s) added.`;
  });
}
export async function toggleActiveAction(f: FormData) {
  const u = await requireUser('inventory.manage'); const table = z.enum(['room_types', 'rooms', 'units']).parse(S(f, 'table'));
  return run('/dashboard/rooms', async () => { await q(`UPDATE ${table} SET active = NOT active WHERE id=$1`, [S(f, 'id')]); await audit(u.email, 'inventory.toggle', table, S(f, 'id')); return 'Updated. Existing reservations are not affected.'; });
}
export async function addRateAction(f: FormData) {
  const u = await requireUser('inventory.manage');
  return run('/dashboard/rooms', async () => {
    const from = S(f, 'from') || null, to = S(f, 'to') || null;
    if (from && to && to <= from) throw new BookingError('INVALID_DATES');
    await q(`INSERT INTO rates(room_type_id,name,price_cents,valid_during,priority) VALUES($1,$2,$3,daterange($4::date,$5::date,'[)'),$6)`, [S(f, 'roomTypeId'), S(f, 'name') || (from ? 'Seasonal' : 'Base'), toCents(S(f, 'price')), from, to, from || to ? 10 : 0]);
    await audit(u.email, 'inventory.rate_add', 'room_type', S(f, 'roomTypeId'), { price: S(f, 'price'), from, to });
    return 'Rate added. It applies to new quotes only; existing reservations keep their price.';
  });
}
export async function deleteRateAction(f: FormData) { const u = await requireUser('inventory.manage'); return run('/dashboard/rooms', async () => { await q('DELETE FROM rates WHERE id=$1', [S(f, 'id')]); await audit(u.email, 'inventory.rate_delete', 'rate', S(f, 'id')); return 'Rate removed.'; }); }
export async function addBlockAction(f: FormData) {
  const u = await requireUser('blocks.manage');
  return run('/dashboard/rooms', async () => {
    const from = S(f, 'from'), to = S(f, 'to'); if (!from || !to || to <= from) throw new BookingError('INVALID_DATES');
    const clash = (await q<any>(`SELECT r.reference FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id WHERE ru.unit_id=$1 AND ru.active AND ru.during && daterange($2::date,$3::date,'[)') LIMIT 1`, [S(f, 'unitId'), from, to]))[0];
    if (clash) throw new BookingError('CONFLICT', `Cannot block: reservation ${clash.reference} already uses this bed in those dates. Move that guest first.`);
    await q(`INSERT INTO unit_blocks(unit_id,during,reason,created_by) VALUES($1,daterange($2::date,$3::date,'[)'),$4,$5)`, [S(f, 'unitId'), from, to, S(f, 'reason') || null, u.id]);
    await audit(u.email, 'inventory.block_add', 'unit', S(f, 'unitId'), { from, to });
    return 'Maintenance block added.';
  });
}
export async function deleteBlockAction(f: FormData) { const u = await requireUser('blocks.manage'); return run('/dashboard/rooms', async () => { await q('DELETE FROM unit_blocks WHERE id=$1', [S(f, 'id')]); await audit(u.email, 'inventory.block_delete', 'unit_block', S(f, 'id')); return 'Block removed.'; }); }

/* ───── guests ───── */
export async function updateGuestAction(f: FormData) {
  const u = await requireUser('guest.edit'); const id = S(f, 'id');
  return run(`/dashboard/guests/${id}`, async () => {
    await q('UPDATE guests SET full_name=$2, email=$3, phone=$4, nationality=$5, language=$6, notes=$7, opted_out=$8, updated_at=now() WHERE id=$1',
      [id, S(f, 'fullName'), S(f, 'email').toLowerCase() || null, S(f, 'phone') || null, S(f, 'nationality') || null, z.enum(['en', 'es', 'fr', 'ar']).parse(S(f, 'language')), S(f, 'notes') || null, f.get('optedOut') === 'on']);
    await audit(u.email, 'guest.update', 'guest', id);
    return 'Guest saved.';
  });
}

/* ───── automation + settings ───── */
export async function saveRuleAction(f: FormData) {
  const u = await requireUser('automation.manage');
  return run('/dashboard/automation', async () => {
    await q('UPDATE automation_rules SET enabled=$2, delay_minutes=$3, max_attempts=$4, retry_minutes=$5, max_per_day=$6 WHERE kind=$1', [S(f, 'kind'), f.get('enabled') === 'on', Math.max(0, N(f, 'delay')), Math.max(1, N(f, 'attempts')), Math.max(1, N(f, 'retry')), Math.max(1, N(f, 'perDay'))]);
    await audit(u.email, 'automation.rule', 'rule', S(f, 'kind'));
    return 'Rule saved.';
  });
}
export async function saveHostelAction(f: FormData) {
  const u = await requireUser('settings.manage');
  return run('/dashboard/settings', async () => {
    const v = (k: string) => S(f, k) || null;
    await setSetting('hostel', { name: S(f, 'name') || 'Villa Layla Hostel', city: S(f, 'city') || 'Cairo, Egypt', address: v('address'), phone: v('phone'), email: v('email'), whatsapp: v('whatsapp'), map_url: v('map_url'), checkin_time: v('checkin_time'), checkout_time: v('checkout_time') });
    await setSetting('currency', S(f, 'currency') || 'EGP');
    await audit(u.email, 'settings.hostel');
    return 'Hostel details saved.';
  });
}
export async function saveTextsAction(f: FormData) {
  const u = await requireUser('settings.manage');
  return run('/dashboard/settings', async () => {
    for (const k of ['payment_instructions', 'cancellation_policy', 'house_rules']) await setSetting(k, Object.fromEntries(['en', 'es', 'fr', 'ar'].map((l) => [l, S(f, `${k}_${l}`) || null])));
    await audit(u.email, 'settings.texts');
    return 'Policies and payment instructions saved. They are now shown on the website and in the Telegram bot.';
  });
}
export async function saveBookingRulesAction(f: FormData) {
  const u = await requireUser('settings.manage');
  return run('/dashboard/settings', async () => {
    await setSetting('pending_hold_hours', Math.max(1, N(f, 'holdHours'))); await setSetting('temp_hold_minutes', Math.max(5, N(f, 'holdMinutes')));
    await setSetting('max_nights', Math.max(1, Math.min(365, N(f, 'maxNights')))); await setSetting('confirm_requires_deposit_cents', Math.max(0, toCents(S(f, 'deposit') || '0')));
    await audit(u.email, 'settings.booking_rules');
    return 'Booking rules saved.';
  });
}
export async function saveFaqAction(f: FormData) {
  const u = await requireUser('settings.manage');
  return run('/dashboard/settings', async () => {
    const raw = S(f, 'faq');
    if (!raw) { await q(`DELETE FROM settings WHERE key='faq'`); return 'FAQ reset to the default list.'; }
    const parsed = z.array(z.object({ q: z.record(z.string()), a: z.record(z.string()) })).parse(JSON.parse(raw));
    await setSetting('faq', parsed); await audit(u.email, 'settings.faq'); return 'FAQ saved.';
  });
}
export async function saveGuestVideosAction(f: FormData) {
  const u = await requireUser('settings.manage');
  return run('/dashboard/settings', async () => {
    const urls = [S(f, 'v1'), S(f, 'v2'), S(f, 'v3')].filter(Boolean);
    const bad = urls.filter((x) => !toEmbed(x));
    if (bad.length) throw new BookingError('INVALID_INPUT', `Not a supported video link: ${bad[0]}. Use an Instagram reel, TikTok, YouTube or .mp4 link.`);
    await setSetting('guest_videos', urls); await audit(u.email, 'settings.guest_videos', undefined, null, { count: urls.length });
    return urls.length ? `Saved ${urls.length} guest video(s). They now show on the homepage.` : 'Guest videos cleared.';
  });
}
export async function createUserAction(f: FormData) {
  const u = await requireUser('users.manage');
  return run('/dashboard/settings', async () => {
    const pw = String(f.get('password') ?? ''); if (pw.length < 10) throw new BookingError('INVALID_INPUT', 'Password must be at least 10 characters.');
    await q('INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4)', [S(f, 'email').toLowerCase(), S(f, 'name'), await hash(pw), z.enum(['owner', 'manager', 'receptionist']).parse(S(f, 'role'))]);
    await audit(u.email, 'users.create', 'user', S(f, 'email'), { role: S(f, 'role') });
    return 'Staff account created.';
  });
}
export async function updateUserAction(f: FormData) {
  const u = await requireUser('users.manage'); const id = S(f, 'id');
  return run('/dashboard/settings', async () => {
    if (id === u.id && (f.get('active') !== 'on' || S(f, 'role') !== 'owner')) throw new BookingError('CONFLICT', 'You cannot deactivate or demote yourself.');
    await q('UPDATE users SET role=$2, active=$3 WHERE id=$1', [id, z.enum(['owner', 'manager', 'receptionist']).parse(S(f, 'role')), f.get('active') === 'on']);
    const pw = String(f.get('password') ?? ''); if (pw) { if (pw.length < 10) throw new BookingError('INVALID_INPUT', 'Password must be at least 10 characters.'); await q('UPDATE users SET password_hash=$2 WHERE id=$1', [id, await hash(pw)]); }
    await audit(u.email, 'users.update', 'user', id);
    return 'Staff account updated.';
  });
}
export async function savePolicyRuleAction(f: FormData) {
  const u = await requireUser('policy.manage');
  return run('/dashboard/settings', async () => {
    const conditions = z.array(z.object({ field: z.string(), op: z.enum(['eq', 'neq', 'in', 'exists', 'missing']), value: z.any().optional() })).parse(JSON.parse(S(f, 'conditions') || '[]'));
    const msg = Object.fromEntries(['en', 'es', 'fr', 'ar'].map((l) => [l, S(f, `message_${l}`)]).filter(([, v]) => v));
    const action = z.enum(['ask', 'review', 'require_approval', 'inform', 'block']).parse(S(f, 'action')); const id = S(f, 'id');
    if (id) { const old = (await q<any>('SELECT message FROM policy_rules WHERE id=$1', [id]))[0]; if (old?.message?.key) (msg as any).key = old.message.key; }
    if (id) await q('UPDATE policy_rules SET name=$2, conditions=$3, action=$4, message=$5, notes=$6, version=version+1, active=$7, updated_by=$8, updated_at=now() WHERE id=$1', [id, S(f, 'name'), JSON.stringify(conditions), action, msg, S(f, 'notes') || null, f.get('active') === 'on', u.id]);
    else await q('INSERT INTO policy_rules(name,conditions,action,message,notes,active,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7)', [S(f, 'name'), JSON.stringify(conditions), action, msg, S(f, 'notes') || null, f.get('active') === 'on', u.id]);
    await audit(u.email, 'policy.save', 'policy_rule', id || null, { name: S(f, 'name'), active: f.get('active') === 'on' });
    return 'Rule saved (new version recorded). Only ACTIVE rules affect bookings.';
  });
}

/* ───── import ───── */
export async function uploadImportAction(f: FormData) {
  const u = await requireUser('import.run');
  const file = f.get('file') as File | null;
  let id = '';
  return run('/dashboard/import', async () => {
    if (!file || !file.size) throw new BookingError('INVALID_INPUT', 'Choose a .csv or .xlsx file.');
    if (file.size > 8 * 1024 * 1024) throw new BookingError('INVALID_INPUT', 'File is larger than 8 MB.');
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new BookingError('INVALID_INPUT', 'Only .csv, .xlsx or .xls files are supported.');
    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseFile(buf);
    const r = await q<any>('INSERT INTO import_batches(filename,uploaded_by,original,total_rows,mapping,report) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [file.name, u.id, buf, parsed.rows.length, JSON.stringify(guessMapping(parsed.headers)), JSON.stringify({ headers: parsed.headers, rows: parsed.rows, truncated: parsed.truncated })]);
    id = r[0].id; await audit(u.email, 'import.upload', 'import_batch', id, { file: file.name, rows: parsed.rows.length });
  }).catch((e) => { if (isRedirect(e) && id) redirect(`/dashboard/import/${id}?ok=${enc('File read. Check the column mapping and the preview below.')}`); throw e; });
}
export async function remapImportAction(f: FormData) {
  await requireUser('import.run'); const id = S(f, 'id');
  return run(`/dashboard/import/${id}`, async () => {
    const m: Mapping = {}; for (const k of FIELDS) { const v = S(f, `map_${k}`); m[k] = v === '' ? null : Number(v); }
    await q(`UPDATE import_batches SET mapping=$2 WHERE id=$1 AND status='previewed'`, [id, JSON.stringify(m)]);
    return 'Mapping updated — preview refreshed.';
  });
}
export async function commitImportAction(f: FormData) {
  const u = await requireUser('import.run'); const id = S(f, 'id');
  return run(`/dashboard/import/${id}`, async () => {
    const b = (await q<any>(`SELECT * FROM import_batches WHERE id=$1 AND status='previewed'`, [id]))[0];
    if (!b) throw new BookingError('BAD_STATE', 'This import was already completed.');
    const r = await commitImport(id, b.report.rows, b.mapping, { defaultRoomTypeId: S(f, 'defaultRoomTypeId') || null, paidVerified: f.get('paidVerified') === 'on' }, u.id, u.email);
    return `Imported ${r.imported} reservation(s). ${r.rejected.length} row(s) were rejected — see the list below.`;
  });
}
