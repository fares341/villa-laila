import { q } from '@/lib/db';
import { audit } from './audit';

/**
 * Bookings to block in the channel manager (Little Hotelier) by hand: anything that did not come in through it —
 * the website, walk-ins and bookings reception typed in for phone / WhatsApp guests. Each one stays on the
 * dashboard alert until reception ticks “Done in the channel manager”.
 */
export const CM_SOURCES = ['website', 'walk_in', 'staff', 'whatsapp', 'telegram'];

export type CmBlock = { paid_cents?: number; ext_from?: string | null; ext_to?: string | null; id: string; reference: string; status: string; source: string; check_in: string; check_out: string; guests_count: number; full_name: string; room_type: string | null; beds: string | null; created_at: string };

export async function channelBlocksDue(): Promise<CmBlock[]> {
  return q<CmBlock>(`
    SELECT r.id, r.reference, r.status, r.source, r.check_in::text, r.check_out::text, r.guests_count, g.full_name, t.name->>'en' room_type,
      CASE WHEN r.cm_done_at IS NOT NULL OR NOT (r.source = ANY($1)) THEN r.cm_ext_from::text END ext_from, CASE WHEN r.cm_done_at IS NOT NULL OR NOT (r.source = ANY($1)) THEN r.cm_ext_to::text END ext_to,
      (SELECT COALESCE(sum(p.amount_cents),0)::bigint FROM payments p WHERE p.reservation_id=r.id AND p.status='verified') paid_cents,
      (SELECT string_agg(rm.name || CASE WHEN tt.kind='dorm' THEN ' · ' || u.label ELSE '' END, ', ' ORDER BY rm.name, u.label)
         FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id JOIN room_types tt ON tt.id=rm.room_type_id
        WHERE ru.reservation_id=r.id AND ru.active) beds, r.created_at
    FROM reservations r JOIN guests g ON g.id=r.guest_id LEFT JOIN room_types t ON t.id=r.room_type_id
    WHERE ((r.cm_done_at IS NULL AND r.source = ANY($1)) OR r.cm_ext_to IS NOT NULL) AND r.status IN ('hold','pending','confirmed','checked_in') AND r.check_out > current_date
    ORDER BY r.created_at DESC LIMIT 30`, [CM_SOURCES]).catch(() => []);
}

export async function markChannelBlocked(id: string, actor: string, done = true) {
  // An extension only: just clear it (the original booking was already blocked or came through the channel manager).
  await q(`UPDATE reservations SET cm_done_at=CASE WHEN NOT $2 THEN NULL WHEN cm_done_at IS NULL AND source = ANY($4) THEN now() ELSE cm_done_at END,
    cm_done_by=CASE WHEN NOT $2 THEN NULL WHEN cm_done_at IS NULL AND source = ANY($4) THEN $3 ELSE cm_done_by END,
    cm_ext_from=CASE WHEN $2 THEN NULL ELSE cm_ext_from END, cm_ext_to=CASE WHEN $2 THEN NULL ELSE cm_ext_to END WHERE id=$1`, [id, done, actor, CM_SOURCES]);
  await audit(actor, done ? 'reservation.cm_blocked' : 'reservation.cm_unblocked', 'reservation', id, {});
}

/** Blocked bookings that were cancelled / rejected / no-show afterwards: open those dates again in the channel manager. */
export async function channelReleasesDue(): Promise<CmBlock[]> {
  return q<CmBlock>(`
    SELECT r.id, r.reference, r.status, r.source, r.check_in::text, r.check_out::text, r.guests_count, g.full_name, t.name->>'en' room_type, NULL::text beds, r.created_at
    FROM reservations r JOIN guests g ON g.id=r.guest_id LEFT JOIN room_types t ON t.id=r.room_type_id
    WHERE r.cm_done_at IS NOT NULL AND r.cm_done_by <> 'migration' AND r.cm_released_at IS NULL AND r.source = ANY($1)
      AND r.status IN ('cancelled','rejected','no_show','expired') AND r.check_out > current_date
    ORDER BY r.updated_at DESC NULLS LAST LIMIT 30`, [CM_SOURCES]).catch(() => []);
}

export async function markChannelReleased(id: string, actor: string) {
  await q(`UPDATE reservations SET cm_released_at=now() WHERE id=$1`, [id]);
  await audit(actor, 'reservation.cm_released', 'reservation', id, {});
}
