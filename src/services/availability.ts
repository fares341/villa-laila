import type { Q } from '@/lib/db';
import { q, pool } from '@/lib/db';
import { rangeStr, nightsBetween } from '@/lib/dates';
import { quote } from './pricing';
import { BookingError } from './errors';

export type FreeUnit = { id: string; room_id: string; room_name: string; label: string; capacity: number };

const FREE_SQL = `
SELECT u.id, u.room_id, r.name AS room_name, u.label, u.capacity
FROM units u
JOIN rooms r ON r.id=u.room_id
JOIN room_types t ON t.id=r.room_type_id
WHERE t.id=$1 AND t.active AND r.active AND u.active
  AND NOT EXISTS (
    SELECT 1 FROM reservation_units ru JOIN reservations res ON res.id=ru.reservation_id
    WHERE ru.unit_id=u.id AND ru.active AND ru.during && $2::daterange
      AND ($3::uuid IS NULL OR ru.reservation_id <> $3::uuid)
      AND NOT (res.status IN ('hold','pending') AND res.hold_expires_at IS NOT NULL AND res.hold_expires_at < now()))
  AND NOT EXISTS (SELECT 1 FROM unit_blocks b WHERE b.unit_id=u.id AND b.during && $2::daterange)
ORDER BY r.name, u.label`;

export async function freeUnits(c: Q, roomTypeId: string, checkIn: string, checkOut: string, excludeReservationId: string | null = null): Promise<FreeUnit[]> {
  return (await c.query(FREE_SQL, [roomTypeId, rangeStr(checkIn, checkOut), excludeReservationId])).rows;
}

/** Choose units for N guests. Dorm: N beds (same room preferred). Private: smallest single room that fits, else greedy multi-room. */
export function pickUnits(kind: 'dorm' | 'private', free: FreeUnit[], guests: number): { unit: FreeUnit; guests: number }[] | null {
  if (guests < 1) return null;
  if (kind === 'dorm') {
    if (free.length < guests) return null;
    const byRoom = new Map<string, FreeUnit[]>();
    for (const u of free) byRoom.set(u.room_id, [...(byRoom.get(u.room_id) ?? []), u]);
    const rooms = [...byRoom.values()].sort((a, b) => b.length - a.length);
    const fit = rooms.filter((r) => r.length >= guests).sort((a, b) => a.length - b.length)[0];
    const chosen = fit ? fit.slice(0, guests) : rooms.flat().slice(0, guests);
    return chosen.map((unit) => ({ unit, guests: 1 }));
  }
  const single = free.filter((u) => u.capacity >= guests).sort((a, b) => a.capacity - b.capacity)[0];
  if (single) return [{ unit: single, guests }];
  const sorted = [...free].sort((a, b) => b.capacity - a.capacity);
  const out: { unit: FreeUnit; guests: number }[] = [];
  let left = guests;
  for (const u of sorted) { if (left <= 0) break; const g = Math.min(u.capacity, left); out.push({ unit: u, guests: g }); left -= g; }
  return left > 0 ? null : out;
}

export type TypeAvailability = {
  roomTypeId: string; code: string; kind: 'dorm' | 'private'; name: Record<string, string>; description: Record<string, string>;
  freeCount: number; canFit: boolean; nights: number; perUnitCents: number | null; totalCents: number | null; priceMissing: boolean; demoPrice: boolean;
  gender: string; photos: string[]; details: any;
};

/** Read-only availability + price for every active room type. The AI/bot/website all call this — never compute availability elsewhere. */
export async function availabilityFor(checkIn: string, checkOut: string, guests: number): Promise<TypeAvailability[]> {
  const c = pool() as unknown as Q;
  const types = await q<any>('SELECT * FROM room_types WHERE active ORDER BY sort_order, code');
  const out: TypeAvailability[] = [];
  for (const t of types) {
    const free = await freeUnits(c, t.id, checkIn, checkOut);
    const picked = pickUnits(t.kind, free, guests);
    let perUnit: number | null = null, total: number | null = null, missing = false, demo = false;
    if (picked) {
      try { const qt = await quote(c, t.id, checkIn, checkOut, picked.length); perUnit = qt.perUnitCents; total = qt.totalCents; demo = qt.demo; }
      catch (e) { if (e instanceof BookingError && e.code === 'NO_RATE') missing = true; else throw e; }
    }
    out.push({ roomTypeId: t.id, code: t.code, kind: t.kind, name: t.name, description: t.description, freeCount: free.length, canFit: !!picked, nights: nightsBetween(checkIn, checkOut), perUnitCents: perUnit, totalCents: total, priceMissing: missing, demoPrice: demo, gender: t.gender, photos: t.photos ?? [], details: t.details ?? {} });
  }
  return out;
}
