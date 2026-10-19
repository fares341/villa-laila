import { q } from '@/lib/db';
import { todayLocal } from '@/lib/dates';

export type PublicRoom = {
  id: string; code: string; kind: 'dorm' | 'private'; gender: 'mixed' | 'female' | 'male';
  name: Record<string, string>; description: Record<string, string>; amenities: Record<string, string>[];
  photos: string[]; details: { bed?: Record<string, string>; sleeps?: number; beds?: number | null; features?: string[] };
  priceCents: number | null; demoPrice: boolean; units: number; capacity: number | null;
};

/** Active room types with today's base price, for public listing pages. */
export async function publicRooms(): Promise<PublicRoom[]> {
  const rows = await q<any>(`
    SELECT t.*, pr.price_cents, pr.is_demo AS demo_price,
      (SELECT count(*)::int FROM units u JOIN rooms r ON r.id=u.room_id WHERE r.room_type_id=t.id AND u.active AND r.active) AS units,
      (SELECT max(u.capacity) FROM units u JOIN rooms r ON r.id=u.room_id WHERE r.room_type_id=t.id AND u.active) AS capacity
    FROM room_types t
    LEFT JOIN LATERAL (SELECT price_cents, is_demo FROM rates r WHERE r.room_type_id=t.id AND r.valid_during @> $1::date ORDER BY priority DESC, price_cents LIMIT 1) pr ON true
    WHERE t.active ORDER BY t.sort_order, t.code`, [todayLocal()]);
  return rows.map((t) => ({ id: t.id, code: t.code, kind: t.kind, gender: t.gender ?? 'mixed', name: t.name, description: t.description ?? {}, amenities: Array.isArray(t.amenities) ? t.amenities : [],
    photos: Array.isArray(t.photos) ? t.photos : [], details: t.details ?? {}, priceCents: t.price_cents ?? null, demoPrice: !!t.demo_price, units: t.units, capacity: t.capacity }));
}
