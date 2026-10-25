import { q } from '@/lib/db';
import { audit } from './audit';

/**
 * Bookings to block in the channel manager (Little Hotelier) by hand: anything that did not come in through it —
 * the website, walk-ins and bookings reception typed in for phone / WhatsApp guests. Each one stays on the
 * dashboard alert until reception ticks “Done in the channel manager”.
 */
export const CM_SOURCES = ['website', 'walk_in', 'staff', 'whatsapp', 'telegram'];

export type CmBlock = { id: string; reference: string; status: string; source: string; check_in: string; check_out: string; guests_count: number; full_name: string; room_type: string | null; beds: string | null; created_at: string };

export async function channelBlocksDue(): Promise<CmBlock[]> {
  return q<CmBlock>(`
    SELECT r.id, r.reference, r.status, r.source, r.check_in::text, r.check_out::text, r.guests_count, g.full_name, t.name->>'en' room_type,
      (SELECT string_agg(rm.name || CASE WHEN tt.kind='dorm' THEN ' · ' || u.label ELSE '' END, ', ' ORDER BY rm.name, u.label)
         FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id JOIN room_types tt ON tt.id=rm.room_type_id
        WHERE ru.reservation_id=r.id AND ru.active) beds, r.created_at
    FROM reservations r JOIN guests g ON g.id=r.guest_id LEFT JOIN room_types t ON t.id=r.room_type_id
    WHERE r.cm_done_at IS NULL AND r.source = ANY($1) AND r.status IN ('hold','pending','confirmed','checked_in') AND r.check_out > current_date
    ORDER BY r.created_at DESC LIMIT 30`, [CM_SOURCES]).catch(() => []);
}

export async function markChannelBlocked(id: string, actor: string, done = true) {
  await q(`UPDATE reservations SET cm_done_at=CASE WHEN $2 THEN now() ELSE NULL END, cm_done_by=CASE WHEN $2 THEN $3 ELSE NULL END WHERE id=$1`, [id, done, actor]);
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
