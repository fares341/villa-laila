import { createHash } from 'node:crypto';
import { q } from '@/lib/db';
import { getSetting } from '../settings';
import { createOtaBooking, CHANNELS } from '../ota-bookings';
import { cancelReservation } from '../reservations';
import { capture, ensureSignedIn, lhEnv } from './browser';
import { extractBookings, dedupe, channelKeyFor, type LhBooking } from './extract';

/**
 * One read of Little Hotelier: open the bookings page, collect the bookings it loads, and copy new site bookings
 * (Booking.com, Airbnb, Hostelworld, Expedia) into "Bookings from sites". Read-only towards Little Hotelier.
 *
 * Starts in TEST mode: it only reports what it would import (Telegram + Dashboard). Set LH_SYNC_WRITE=1 once the
 * test reports look right. Changed dates / prices on an already imported booking are reported, not changed.
 */
export const writeMode = () => process.env.LH_SYNC_WRITE === '1';

async function notifyOwner(text: string) {
  try {
    const { getAdminBotConfig, adminApi } = await import('../admin-bot');
    const { token, chat_ids } = await getAdminBotConfig();
    if (!token) return;
    for (const id of chat_ids) await adminApi.send(id, text).catch(() => {});
  } catch { /* bot not available */ }
}
export { notifyOwner };

const hashOf = (b: LhBooking) => createHash('sha1').update(JSON.stringify([b.ref, b.status, b.checkIn, b.checkOut, b.total, b.roomType, b.guests])).digest('hex');
const DEPOSIT = ['deposit', 'depositamount', 'prepaid', 'prepaidamount', 'amountpaid', 'paidamount', 'paid'];
const findNum = (o: Record<string, any>, keys: string[]) => {
  for (const [k, v] of Object.entries(o)) if (keys.includes(k.toLowerCase().replace(/[^a-z0-9]/g, ''))) { const n = Number(typeof v === 'object' && v ? (v as any).amount : v); if (Number.isFinite(n)) return n; }
  return null;
};

async function roomTypeFor(name: string | null): Promise<string | null> {
  if (!name) return null;
  const map = ((await getSetting<any>('lh_room_map').catch(() => null)) ?? {}) as Record<string, string>;
  if (map[name]) return map[name];
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const types = await q<any>(`SELECT id, name, code FROM room_types WHERE active`);
  const hit = types.find((t) => [t.code, t.name?.en].some((x: string) => x && x.toLowerCase().replace(/[^a-z0-9]/g, '') === n))
    ?? types.find((t) => { const e = String(t.name?.en ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); return e && (n.includes(e) || e.includes(n)); });
  return hit?.id ?? null;
}

async function mark(b: LhBooking, status: string, detail: string | null, reservationId: string | null = null) {
  await q(`INSERT INTO lh_seen(lh_key,hash,reservation_id,status,detail,data) VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (lh_key) DO UPDATE SET hash=EXCLUDED.hash, reservation_id=COALESCE(EXCLUDED.reservation_id, lh_seen.reservation_id), status=EXCLUDED.status, detail=EXCLUDED.detail, data=EXCLUDED.data, last_seen=now()`,
    [b.key, hashOf(b), reservationId, status, detail, JSON.stringify({ ...b, raw: undefined })]);
}

export async function handleBooking(b: LhBooking, user: { id: string | null; actor: string }) {
  const prev = (await q<any>(`SELECT * FROM lh_seen WHERE lh_key=$1`, [b.key]))[0];
  const h = hashOf(b);
  if (prev && prev.hash === h && prev.status !== 'dry_run') { await q(`UPDATE lh_seen SET last_seen=now() WHERE lh_key=$1`, [b.key]); return 'same'; }
  if (prev && prev.hash === h && prev.status === 'dry_run' && !writeMode()) { await q(`UPDATE lh_seen SET last_seen=now() WHERE lh_key=$1`, [b.key]); return 'same'; }
  const ch = channelKeyFor(b);
  if (!ch) { await mark(b, 'skipped', `Not a site booking (channel "${b.channel}")`); return 'skipped'; }
  const label = CHANNELS[ch].label;

  // Cancelled in Little Hotelier
  if (b.cancelled) {
    if (prev?.reservation_id && writeMode()) {
      const r = (await q<any>(`SELECT status, reference FROM reservations WHERE id=$1`, [prev.reservation_id]))[0];
      if (r && ['confirmed', 'pending', 'hold'].includes(r.status)) {
        await cancelReservation(prev.reservation_id, `Cancelled on ${label} (read from Little Hotelier)`, user.actor);
        await mark(b, 'cancelled', null, prev.reservation_id);
        await notifyOwner(`${label} cancelled ${b.ref} (${b.guest}, ${b.checkIn} → ${b.checkOut}). The booking ${r.reference} is cancelled here too and the bed is free.`);
        return 'cancelled';
      }
      if (r?.status === 'checked_in') await notifyOwner(`${label} shows ${b.ref} as cancelled, but ${b.guest} is checked in here (${r.reference}). Please check.`);
    }
    await mark(b, prev?.reservation_id ? 'cancelled' : 'skipped', 'Cancelled in Little Hotelier', prev?.reservation_id ?? null);
    return 'cancelled';
  }

  // Already imported, something changed: tell the owner, change nothing automatically.
  if (prev?.reservation_id) {
    const old = prev.data ?? {};
    const what = [old.checkIn !== b.checkIn || old.checkOut !== b.checkOut ? `dates ${old.checkIn}→${old.checkOut} now ${b.checkIn}→${b.checkOut}` : '', old.total !== b.total ? `price ${old.total} now ${b.total}` : '', old.guests !== b.guests ? `guests ${old.guests} now ${b.guests}` : ''].filter(Boolean).join(', ');
    if (what) await notifyOwner(`${label} booking ${b.ref} (${b.guest}) changed in Little Hotelier: ${what}. Update it in Bookings from sites.`);
    await mark(b, 'imported', what || null, prev.reservation_id);
    return 'changed';
  }

  const roomTypeId = await roomTypeFor(b.roomType);
  const problems = [!roomTypeId && `room type "${b.roomType ?? '?'}" not matched`, !(b.total && b.total > 0) && 'no price', !b.guest && 'no guest name'].filter(Boolean);
  if (problems.length) {
    await mark(b, 'error', problems.join(', '));
    if (!prev || prev.detail !== problems.join(', ')) await notifyOwner(`${label} booking ${b.ref} (${b.guest || 'no name'}, ${b.checkIn} → ${b.checkOut}) was not copied: ${problems.join(', ')}. Add it by hand in Bookings from sites.`);
    return 'error';
  }
  const cur = (['USD', 'EUR'].includes(String(b.currency).toUpperCase()) ? String(b.currency).toUpperCase() : 'EGP') as any;
  const total = Math.round(b.total! * 100);
  const blob = `${b.paymentNote ?? ''} ${JSON.stringify(b.raw).slice(0, 3000)}`;
  const prepaid = ch === 'booking_com' && /payments?\s*by\s*booking|prepaid|virtual\s*card|vcc/i.test(blob);
  let deposit: number | undefined; let depositNote = '';
  if (ch === 'hostelworld') {
    const d = findNum(b.raw, DEPOSIT);
    const pct = Number((await getSetting<any>('hostelworld_deposit_pct').catch(() => null)) ?? 15);
    deposit = d && d > 0 ? Math.round(d * 100) : Math.round(total * pct / 100);
    if (!(d && d > 0)) depositNote = ` · deposit estimated at ${pct}%, check it`;
  }

  if (!writeMode()) {
    await mark(b, 'dry_run', `Would import into ${label}: ${b.roomType}, ${b.guests} guest(s), ${b.total} ${cur}${deposit ? `, deposit ${deposit / 100}` : ''}${prepaid ? ', prepaid' : ''}`);
    if (!prev) await notifyOwner(`[TEST] ${label} ${b.ref}: ${b.guest}, ${b.checkIn} → ${b.checkOut}, ${b.roomType}, ${b.guests} guest(s), ${b.total} ${cur}${prepaid ? ', paid via Booking.com' : ''}${deposit ? `, deposit ${deposit / 100}${depositNote}` : ''}. Not saved (test mode).`);
    return 'dry_run';
  }
  try {
    const r = await createOtaBooking({
      channel: ch, ref: b.ref, fullName: b.guest, phone: b.phone, email: b.email, nationality: b.nationality,
      roomTypeId: roomTypeId!, checkIn: b.checkIn, checkOut: b.checkOut, guests: b.guests, total, currency: cur,
      prepaidByChannel: prepaid, deposit, notes: `Copied from Little Hotelier${depositNote}`, actor: user.actor, userId: user.id,
    });
    await mark(b, 'imported', null, r.id);
    await notifyOwner(`New ${label} booking ${b.ref}: ${b.guest}, ${b.checkIn} → ${b.checkOut}, ${b.guests} guest(s). Saved as ${r.reference}. ${r.dueAtHostel > 0 ? `To collect at the hostel: EGP ${(r.dueAtHostel / 100).toLocaleString('en-US')}` : 'Nothing to collect at the hostel.'}${depositNote}`);
    return 'imported';
  } catch (e: any) {
    const msg = e?.message && e.message !== e.code ? e.message : e?.code ?? 'error';
    if (/already entered/.test(msg)) {
      const ex = (await q<any>(`SELECT id FROM reservations WHERE channel_ref=$1 ORDER BY created_at DESC LIMIT 1`, [b.ref.replace(/\s+/g, '')]))[0];
      await mark(b, 'imported', 'Already entered by hand', ex?.id ?? null);
      return 'same';
    }
    await mark(b, 'error', msg);
    if (!prev || prev.detail !== msg) await notifyOwner(`${label} booking ${b.ref} (${b.guest}, ${b.checkIn} → ${b.checkOut}) could not be copied: ${msg}. Add it by hand.`);
    return 'error';
  }
}

/** One read. Returns counts for the run log. */
export async function readOnce(page: any, log: (m: string) => void) {
  const url = lhEnv.bookingsUrl || lhEnv.loginUrl;
  const caps = await capture(page, () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }));
  if (!(await ensureSignedIn(page, log, notifyOwner))) throw new Error('not signed in');
  const after = caps.length && !/login|sign/i.test(page.url()) ? caps : await capture(page, () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }));
  const bookings = dedupe(after.flatMap((c) => extractBookings(c.json)));
  const user = { id: null, actor: 'little-hotelier-reader' };
  const n = { found: bookings.length, imported: 0, cancelled: 0 };
  for (const b of bookings) {
    const r = await handleBooking(b, user).catch((e) => { log(`booking ${b.key}: ${e.message}`); return 'error'; });
    if (r === 'imported') n.imported++;
    if (r === 'cancelled') n.cancelled++;
  }
  await q(`INSERT INTO lh_runs(ok,found,imported,cancelled,message) VALUES(true,$1,$2,$3,$4)`, [n.found, n.imported, n.cancelled, writeMode() ? null : 'test mode']);
  return n;
}
