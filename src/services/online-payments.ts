import { randomBytes } from 'node:crypto';
import { q, tx } from '@/lib/db';
import type { Q } from '@/lib/db';
import { folioBalance } from './pms/folio';
import { BookingError } from './errors';
import { audit } from './audit';
import { createIntention, paymobEnabled, type PaymobTxn } from './paymob';
import { getWallets, walletOn, isWallet, type WalletMethod } from './wallets';
import { tr, EVENT_COLS, type EventRow } from './events';

const newRef = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`;

/* ───────── Paymob checkout ───────── */

export async function startEventPaymob(ticketCode: string, base: string): Promise<string> {
  const b = (await q<any>('SELECT * FROM event_bookings WHERE ticket_code=$1', [ticketCode]))[0];
  if (!b) throw new BookingError('NOT_FOUND');
  if (b.status !== 'awaiting_payment' || b.total_cents <= 0) throw new BookingError('BAD_STATE');
  if (!paymobEnabled(b.currency)) throw new BookingError('INVALID_INPUT', 'paymob_off');
  const ev = (await q<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE id=$1`, [b.event_id]))[0];
  const ref = newRef('EVT');
  const op = (await q<any>(
    `INSERT INTO online_payments(merchant_ref,kind,event_booking_id,provider,amount_cents,currency,status) VALUES($1,'event',$2,'paymob',$3,$4,'created') RETURNING id`,
    [ref, b.id, b.total_cents, b.currency]))[0];
  // Give the guest a fresh 30 minutes to finish on Paymob.
  await q(`UPDATE event_bookings SET pay_method='paymob', hold_expires_at=now() + interval '30 minutes', updated_at=now() WHERE id=$1`, [b.id]);
  const it = await createIntention({
    amountCents: b.total_cents, currency: b.currency, merchantRef: ref,
    itemName: `${tr(ev.title, 'en')} × ${b.quantity}`, itemDescription: `${tr(ev.title, 'en')} — ${b.event_date} — ticket ${b.ticket_code}`, quantity: b.quantity,
    customer: { name: b.full_name, email: b.email, phone: b.phone },
    notificationUrl: `${base}/api/paymob/webhook`, redirectionUrl: `${base}/api/paymob/return`,
  });
  await q(`UPDATE online_payments SET provider_order_id=$2, raw=$3, updated_at=now() WHERE id=$1`, [op.id, it.orderId, JSON.stringify({ intention: it.intentionId })]);
  return it.checkoutUrl;
}

export async function startReservationPaymob(reference: string, base: string): Promise<string> {
  const r = (await q<any>(
    `SELECT r.*, g.full_name, g.email, g.phone, t.name AS type_name FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN room_types t ON t.id=r.room_type_id WHERE r.reference=$1`,
    [reference]))[0];
  if (!r) throw new BookingError('NOT_FOUND');
  if (!['pending', 'confirmed', 'hold'].includes(r.status)) throw new BookingError('BAD_STATE');
  const due = await reservationDue(r.id, r.total_cents);
  if (due <= 0) throw new BookingError('BAD_STATE', 'Nothing to pay');
  if (!paymobEnabled(r.currency)) throw new BookingError('INVALID_INPUT', 'paymob_off');
  if (!r.email) throw new BookingError('INVALID_INPUT', 'email');
  const ref = newRef('RES');
  const op = (await q<any>(
    `INSERT INTO online_payments(merchant_ref,kind,reservation_id,provider,amount_cents,currency,status) VALUES($1,'room',$2,'paymob',$3,$4,'created') RETURNING id`,
    [ref, r.id, due, r.currency]))[0];
  const roomName = (r.type_name && (r.type_name.en || Object.values(r.type_name)[0])) || 'Room';
  const it = await createIntention({
    amountCents: due, currency: r.currency, merchantRef: ref,
    itemName: `Villa Layla — ${roomName}`, itemDescription: `Booking ${r.reference}, ${r.check_in} → ${r.check_out}`,
    customer: { name: r.full_name, email: r.email, phone: r.phone },
    notificationUrl: `${base}/api/paymob/webhook`, redirectionUrl: `${base}/api/paymob/return`,
  });
  await q(`UPDATE online_payments SET provider_order_id=$2, raw=$3, updated_at=now() WHERE id=$1`, [op.id, it.orderId, JSON.stringify({ intention: it.intentionId })]);
  return it.checkoutUrl;
}

/** Amount still owed on a reservation after verified payments and Paymob payments already received. */
export async function reservationDue(reservationId: string, _totalCents?: number): Promise<number> {
  // Same number the front desk sees: the folio balance (room nights + extras − credits − verified payments).
  const f = await folioBalance(reservationId);
  return Math.max(0, f.balance);
}

/** Where to send the guest after Paymob: their ticket or booking page. */
export async function landingFor(op: { kind: string; event_booking_id: string | null; reservation_id: string | null }, lang = 'en'): Promise<string> {
  if (op.kind === 'event' && op.event_booking_id) {
    const b = (await q<any>('SELECT ticket_code, language FROM event_bookings WHERE id=$1', [op.event_booking_id]))[0];
    return b ? `/${b.language || lang}/tickets/${b.ticket_code}` : `/${lang}`;
  }
  if (op.reservation_id) {
    const r = (await q<any>('SELECT r.reference, g.language FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.id=$1', [op.reservation_id]))[0];
    return r ? `/${r.language || lang}/booked/${r.reference}` : `/${lang}`;
  }
  return `/${lang}`;
}

/**
 * Apply a Paymob transaction whose HMAC has ALREADY been verified by the caller. Idempotent: the webhook and the
 * browser redirect can both arrive, in any order. Returns the online_payments row (or null if unknown).
 */
export async function applyPaymobTxn(t: PaymobTxn, raw: unknown): Promise<any | null> {
  return tx(async (c) => {
    const op = (await c.query(
      `SELECT * FROM online_payments WHERE provider='paymob' AND ((merchant_ref=$1 AND $1 <> '') OR (provider_order_id=$2 AND $2 <> '')) ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [t.merchantRef ?? '', t.orderId])).rows[0];
    if (!op) { console.warn('[paymob] unknown order', t.orderId, t.merchantRef); return null; }
    if (op.status === 'paid') return op;

    const amountOk = t.amountCents === Number(op.amount_cents) && t.currency.toUpperCase() === String(op.currency).toUpperCase();
    if (!t.success || t.pending || !amountOk) {
      if (!t.pending) {
        await c.query(`UPDATE online_payments SET status='failed', provider_txn_id=$2, raw=$3, updated_at=now() WHERE id=$1 AND status='created'`, [op.id, t.txnId, JSON.stringify(raw)]);
      }
      if (t.success && !amountOk) console.error('[paymob] amount mismatch', op.merchant_ref, t.amountCents, t.currency);
      return { ...op, status: t.pending ? op.status : 'failed' };
    }

    await c.query(`UPDATE online_payments SET status='paid', provider_txn_id=$2, provider_order_id=COALESCE(provider_order_id,$3), raw=$4, updated_at=now() WHERE id=$1`,
      [op.id, t.txnId, t.orderId, JSON.stringify(raw)]);
    if (op.kind === 'event') {
      await c.query(`UPDATE event_bookings SET status='paid', paid_at=now(), hold_expires_at=NULL, pay_method='paymob', updated_at=now() WHERE id=$1 AND status <> 'cancelled'`, [op.event_booking_id]);
    } else {
      // Paid by card/wallet through Paymob: the provider confirmed it (HMAC-verified), so it counts as verified.
      const dup = (await c.query(`SELECT 1 FROM payments WHERE reservation_id=$1 AND method='online_provider' AND reference=$2`, [op.reservation_id, 'paymob:' + t.txnId])).rows[0];
      if (!dup) {
        await c.query(`INSERT INTO payments(reservation_id,amount_cents,method,reference,status,note,verified_at) VALUES($1,$2,'online_provider',$3,'verified',$4,now())`,
          [op.reservation_id, op.amount_cents, 'paymob:' + t.txnId, 'Paymob online payment (order ' + t.orderId + ')']);
      }
      await c.query(`INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,'paymob','payment.online',$2)`,
        [op.reservation_id, JSON.stringify({ amount: op.amount_cents, txn: t.txnId })]);
    }
    await audit('paymob', 'payment.paymob', op.kind === 'event' ? 'event_booking' : 'reservation', op.event_booking_id ?? op.reservation_id, { amount: op.amount_cents, txn: t.txnId }, c as unknown as Q);
    return { ...op, status: 'paid' };
  });
}

/* ───────── InstaPay (guest-submitted, staff-verified) ───────── */

export type Proof = { bytes: Buffer; mime: string };
const MAX_PROOF = 5 * 1024 * 1024;
function checkProof(p: Proof | null | undefined) {
  if (!p || !p.bytes?.length) throw new BookingError('INVALID_INPUT', 'proof_required');
  if (p.bytes.length > MAX_PROOF) throw new BookingError('INVALID_INPUT', 'proof_too_big');
  if (!/^image\/(png|jpe?g|webp|heic|heif)$|^application\/pdf$/.test(p.mime)) throw new BookingError('INVALID_INPUT', 'proof_type');
}

/** The guest sent the money by InstaPay or Vodafone Cash and uploaded the receipt: it waits for a person to check. */
export async function submitEventWalletProof(ticketCode: string, method: WalletMethod, payerName: string, payerRef: string, proof: Proof | null): Promise<string> {
  checkProof(proof);
  if (!isWallet(method)) throw new BookingError('INVALID_INPUT', 'pay_method');
  const b = (await q<any>('SELECT * FROM event_bookings WHERE ticket_code=$1', [ticketCode]))[0];
  if (!b) throw new BookingError('NOT_FOUND');
  if (!['awaiting_payment', 'pending_verification'].includes(b.status)) throw new BookingError('BAD_STATE');
  if (!walletOn(await getWallets(), method, b.currency)) throw new BookingError('INVALID_INPUT', 'wallet_off');
  const id = await tx(async (c) => {
    await c.query(`UPDATE online_payments SET status='rejected', updated_at=now() WHERE event_booking_id=$1 AND provider IN ('instapay','vodafone_cash') AND status='submitted'`, [b.id]);
    const op = (await c.query(`INSERT INTO online_payments(merchant_ref,kind,event_booking_id,provider,amount_cents,currency,status,payer_name,payer_reference,proof,proof_mime)
                   VALUES($1,'event',$2,$3,$4,$5,'submitted',$6,$7,$8,$9) RETURNING id`, [newRef(method === 'instapay' ? 'IPE' : 'VFE'), b.id, method, b.total_cents, b.currency, payerName, payerRef || null, proof!.bytes, proof!.mime])).rows[0];
    await c.query(`UPDATE event_bookings SET status='pending_verification', pay_method=$2, hold_expires_at=NULL, updated_at=now() WHERE id=$1`, [b.id, method]);
    return op.id as string;
  });
  await audit('website', method + '.submit', 'event_booking', b.id, { payerRef });
  return id;
}

export const submitEventInstapay = (ticketCode: string, payerName: string, payerRef: string, proof: Proof | null) =>
  submitEventWalletProof(ticketCode, 'instapay', payerName, payerRef, proof);

export async function submitReservationInstapay(reference: string, payerName: string, payerRef: string, proof: Proof | null) {
  checkProof(proof);
  const r = (await q<any>('SELECT * FROM reservations WHERE reference=$1', [reference]))[0];
  if (!r) throw new BookingError('NOT_FOUND');
  if (!['pending', 'confirmed', 'hold'].includes(r.status)) throw new BookingError('BAD_STATE');
  if (!walletOn(await getWallets(), 'instapay', r.currency)) throw new BookingError('INVALID_INPUT', 'instapay_off');
  const due = await reservationDue(r.id, r.total_cents);
  if (due <= 0) throw new BookingError('BAD_STATE');
  const open = (await q<any>(`SELECT 1 FROM online_payments WHERE reservation_id=$1 AND provider='instapay' AND status='submitted'`, [r.id]))[0];
  if (open) return; // already waiting for staff
  await q(`INSERT INTO online_payments(merchant_ref,kind,reservation_id,provider,amount_cents,currency,status,payer_name,payer_reference,proof,proof_mime)
           VALUES($1,'room',$2,'instapay',$3,$4,'submitted',$5,$6,$7,$8)`, [newRef('IPR'), r.id, due, r.currency, payerName, payerRef, proof!.bytes, proof!.mime]);
  await q(`INSERT INTO reservation_events(reservation_id,actor,action,detail) VALUES($1,'website','instapay.submitted',$2)`, [r.id, JSON.stringify({ payerRef, amount: due })]);
}

export async function listInstapaySubmissions() {
  return q<any>(`
    SELECT op.id, op.kind, op.provider, op.amount_cents, op.currency, op.payer_name, op.payer_reference, op.created_at, (op.proof IS NOT NULL) has_proof, op.proof_mime,
           eb.ticket_code, eb.full_name AS event_guest, eb.event_date, ev.title AS event_title,
           r.reference AS res_ref, g.full_name AS res_guest
    FROM online_payments op
    LEFT JOIN event_bookings eb ON eb.id = op.event_booking_id
    LEFT JOIN events ev ON ev.id = eb.event_id
    LEFT JOIN reservations r ON r.id = op.reservation_id
    LEFT JOIN guests g ON g.id = r.guest_id
    WHERE op.provider IN ('instapay','vodafone_cash') AND op.status='submitted'
    ORDER BY op.created_at`);
}

/** A manager checked the InstaPay app: money arrived (ok) or not. */
export async function decideInstapay(onlinePaymentId: string, ok: boolean, staffUserId: string | null, actor: string) {
  await tx(async (c) => {
    const op = (await c.query(`SELECT * FROM online_payments WHERE id=$1 AND provider IN ('instapay','vodafone_cash') FOR UPDATE`, [onlinePaymentId])).rows[0];
    if (!op) throw new BookingError('NOT_FOUND');
    if (op.status !== 'submitted') throw new BookingError('BAD_STATE');
    await c.query(`UPDATE online_payments SET status=$2, verified_by=$3, verified_at=now(), updated_at=now() WHERE id=$1`, [op.id, ok ? 'verified' : 'rejected', staffUserId]);
    if (op.kind === 'event') {
      await c.query(ok
        ? `UPDATE event_bookings SET status='paid', paid_at=now(), confirmed_at=COALESCE(confirmed_at, now()), updated_at=now() WHERE id=$1`
        : `UPDATE event_bookings SET status='awaiting_payment', hold_expires_at=now() + interval '12 hours', updated_at=now() WHERE id=$1`, [op.event_booking_id]);
    } else if (ok) {
      await c.query(`INSERT INTO payments(reservation_id,amount_cents,method,reference,status,note,recorded_by,verified_by,verified_at) VALUES($1,$2,'instapay',$3,'verified',$4,$5,$5,now())`,
        [op.reservation_id, op.amount_cents, op.payer_reference, 'InstaPay transfer checked in the app (' + (op.payer_name || '') + ')', staffUserId]);
    }
    await audit(actor, ok ? 'instapay.verify' : 'instapay.reject', 'online_payment', op.id, { kind: op.kind, amount: op.amount_cents }, c as unknown as Q);
  });
}

/** Payment summary for the public booking page (no personal data). */
export async function reservationPaymentInfo(reservationId: string, totalCents: number) {
  const due = await reservationDue(reservationId, totalCents);
  const pendingInstapay = !!(await q<any>(`SELECT 1 FROM online_payments WHERE reservation_id=$1 AND provider='instapay' AND status='submitted'`, [reservationId]))[0];
  return { due, paid: totalCents > 0 && due === 0, pendingInstapay };
}
