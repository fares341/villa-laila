import { tx, q } from '@/lib/db';
import type { Q } from '@/lib/db';
import { BookingError } from './errors';
import { audit } from './audit';

export type PaymentMethod = 'cash' | 'bank_transfer' | 'instapay' | 'vodafone_cash' | 'card_terminal' | 'online_provider' | 'other';
export const METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'instapay', 'vodafone_cash', 'card_terminal', 'online_provider', 'other'];
/** The only money staff may record outside the POS: a receipt from a phone wallet, checked before it counts. */
export const WALLET_METHODS: PaymentMethod[] = ['instapay', 'vodafone_cash'];

/** Payments are only ever RECORDED by staff; they count toward the balance once VERIFIED by an authorised staff member.
 *  Guest messages/screenshots never create or verify a payment. There is no field for card numbers anywhere. */
export async function recordPayment(reservationId: string, amountCents: number, method: PaymentMethod, reference: string | null, note: string | null, staffUserId: string, actor: string) {
  if (!Number.isInteger(amountCents) || amountCents === 0) throw new BookingError('INVALID_INPUT', 'amount');
  if (!METHODS.includes(method)) throw new BookingError('INVALID_INPUT', 'method');
  const ex = (await q('SELECT id FROM reservations WHERE id=$1', [reservationId]))[0];
  if (!ex) throw new BookingError('NOT_FOUND');
  const r = await q('INSERT INTO payments(reservation_id,amount_cents,method,reference,note,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [reservationId, amountCents, method, reference, note, staffUserId]);
  await audit(actor, 'payment.record', 'reservation', reservationId, { amountCents, method, reference });
  return r[0];
}

export async function verifyPayment(paymentId: string, ok: boolean, staffUserId: string, actor: string) {
  await tx(async (c) => {
    const p = (await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE', [paymentId])).rows[0];
    if (!p) throw new BookingError('NOT_FOUND');
    if (p.status !== 'recorded') throw new BookingError('BAD_STATE', `Payment already ${p.status}`);
    await c.query(`UPDATE payments SET status=$2, verified_by=$3, verified_at=now() WHERE id=$1`, [paymentId, ok ? 'verified' : 'rejected', staffUserId]);
    await audit(actor, ok ? 'payment.verify' : 'payment.reject', 'payment', paymentId, { reservationId: p.reservation_id, amount: p.amount_cents }, c as unknown as Q);
  });
}

export type PayState = 'unpaid' | 'partial' | 'paid' | 'overpaid';
export function payState(totalCents: number, verifiedCents: number): PayState {
  if (verifiedCents <= 0) return 'unpaid';
  if (verifiedCents < totalCents) return 'partial';
  return verifiedCents === totalCents ? 'paid' : 'overpaid';
}
export const balance = (total: number, verified: number) => total - verified;
