// Guest notifications sent AFTER a staff decision has been committed. Used by dashboard actions.
import { q } from '@/lib/db';
import { fmtMoney } from '@/lib/money';
import { t, type Lang } from '@/i18n/bot';
import { botSend } from '@/services/conversations';

type Kind = 'confirmed' | 'rejected' | 'cancelled' | 'extension_applied' | 'extension_rejected';

/** Returns true if a chat message was delivered. Never throws into the staff action. */
export async function notifyGuest(reservationId: string, kind: Kind, extra: { extraCents?: number } = {}): Promise<boolean> {
  try {
    const r = (await q<any>(
      `SELECT r.*, g.language gl, COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.reservation_id=r.id AND p.status='verified'),0)::bigint paid
       FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.id=$1`, [reservationId]))[0];
    if (!r) return false;
    const conv = (await q<any>(`SELECT * FROM conversations WHERE guest_id=$1 AND channel='telegram' ORDER BY updated_at DESC LIMIT 1`, [r.guest_id]))[0];
    if (!conv) return false; // website-only guest: staff contacts them by phone/email
    const lang = (conv.language ?? r.gl ?? 'en') as Lang;
    const vars = { ref: r.reference, checkin: r.check_in, checkout: r.check_out, total: fmtMoney(r.total_cents, r.currency), balance: fmtMoney(r.total_cents - r.paid, r.currency), newout: r.check_out, extra: fmtMoney(extra.extraCents ?? 0, r.currency) };
    const key = { confirmed: 'n_confirmed', rejected: 'n_rejected', cancelled: 'n_cancelled', extension_applied: 'ext_applied', extension_rejected: 'ext_rejected' }[kind];
    return await botSend(conv, t(lang, key, vars), undefined, { allowHuman: true });
  } catch (e) {
    console.error('[notifyGuest]', (e as Error).message);
    return false;
  }
}
