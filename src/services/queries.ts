import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { payState } from './payments';

export type ResFilters = { q?: string; status?: string; source?: string; roomType?: string; payment?: string; from?: string; to?: string; sort?: string; page?: number; limit?: number };

const SORTS: Record<string, string> = { created: 'r.created_at DESC', checkin: 'r.check_in ASC, r.created_at', checkin_desc: 'r.check_in DESC', updated: 'r.updated_at DESC', balance: '(folio_charges(r.id) - p.paid) DESC' };

export async function reservationRows(f: ResFilters) {
  const where: string[] = ['TRUE']; const args: any[] = [];
  const add = (sql: string, v: any) => { args.push(v); where.push(sql.replace('?', '$' + args.length)); };
  if (f.q?.trim()) { args.push('%' + f.q.trim().toLowerCase() + '%'); const n = args.length; where.push(`(lower(r.reference) LIKE $${n} OR lower(g.full_name) LIKE $${n} OR lower(coalesce(g.email,'')) LIKE $${n} OR coalesce(g.phone,'') LIKE $${n})`); }
  if (f.status) add('r.status = ?', f.status);
  if (f.source) add('r.source = ?', f.source);
  if (f.roomType) add('r.room_type_id = ?', f.roomType);
  if (f.from) add('r.check_out > ?::date', f.from);   // stay overlaps [from,to]
  if (f.to) add('r.check_in <= ?::date', f.to);
  let having = '';
  if (f.payment) having = f.payment === 'unpaid' ? 'AND p.paid <= 0' : f.payment === 'partial' ? 'AND p.paid > 0 AND p.paid < folio_charges(r.id)' : f.payment === 'paid' ? 'AND p.paid >= folio_charges(r.id) AND folio_charges(r.id) > 0' : '';
  const limit = Math.min(f.limit ?? 50, 5000), offset = ((f.page ?? 1) - 1) * limit;
  const rows = await q<any>(
    `SELECT r.*, folio_charges(r.id)::bigint charges_cents, g.full_name, g.email, g.phone, g.language, t.name rt_name, t.kind rt_kind, p.paid, p.unverified,
       (SELECT string_agg(rm.name || ' / ' || u.label, ', ' ORDER BY rm.name, u.label) FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=r.id AND ru.active) beds
     FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN room_types t ON t.id=r.room_type_id
     LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0)::bigint paid, COALESCE(SUM(amount_cents) FILTER (WHERE status='recorded'),0)::bigint unverified FROM payments WHERE reservation_id=r.id) p ON true
     WHERE ${where.join(' AND ')} ${having} ORDER BY ${SORTS[f.sort ?? 'created'] ?? SORTS.created} LIMIT ${limit} OFFSET ${offset}`, args);
  return rows.map((r) => ({ ...r, balance: r.charges_cents - r.paid, payState: payState(r.charges_cents, r.paid) }));
}

export async function overview() {
  const today = todayLocal();
  const one = async (sql: string, args: any[] = []) => (await q<any>(sql, args))[0];
  const arrivals = await q<any>(`SELECT r.id,r.reference,r.guests_count,r.status,g.full_name FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.check_in=$1 AND r.status IN ('confirmed','checked_in') ORDER BY g.full_name`, [today]);
  const departures = await q<any>(`SELECT r.id,r.reference,r.guests_count,r.status,g.full_name FROM reservations r JOIN guests g ON g.id=r.guest_id WHERE r.check_out=$1 AND r.status IN ('confirmed','checked_in') ORDER BY g.full_name`, [today]);
  const inHouse = (await one(`SELECT COALESCE(SUM(guests_count),0)::int n, count(*)::int res FROM reservations WHERE status='checked_in'`));
  const createdToday = (await one(`SELECT count(*)::int n FROM reservations WHERE (created_at AT TIME ZONE $1)::date = $2::date`, [process.env.HOSTEL_TZ || 'Africa/Cairo', today])).n;
  const pending = (await one(`SELECT count(*)::int n FROM reservations WHERE status IN ('pending','hold')`)).n;
  // inventory tonight: units that are active, not blocked tonight; occupied = has an active allocation covering tonight
  const inv = await one(
    `SELECT count(*) FILTER (WHERE NOT blocked)::int bookable,
            count(*) FILTER (WHERE NOT blocked AND occupied)::int occupied,
            count(*) FILTER (WHERE NOT blocked AND t.kind='dorm')::int beds,
            count(*) FILTER (WHERE NOT blocked AND occupied AND t.kind='dorm')::int beds_occ
     FROM (SELECT u.id, rm.room_type_id,
             EXISTS (SELECT 1 FROM unit_blocks b WHERE b.unit_id=u.id AND b.during @> $1::date) blocked,
             EXISTS (SELECT 1 FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id WHERE ru.unit_id=u.id AND ru.active AND ru.during @> $1::date AND NOT (r.status IN ('hold','pending') AND r.hold_expires_at < now())) occupied
           FROM units u JOIN rooms rm ON rm.id=u.room_id JOIN room_types t2 ON t2.id=rm.room_type_id WHERE u.active AND rm.active AND t2.active) x
     JOIN room_types t ON t.id=x.room_type_id`, [today]);
  const outstanding = await one(`SELECT COALESCE(SUM(GREATEST(folio_charges(r.id) - p.paid,0)),0)::bigint n, count(*) FILTER (WHERE folio_charges(r.id) - p.paid > 0)::int c
     FROM reservations r LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0) paid FROM payments WHERE reservation_id=r.id) p ON true WHERE r.status IN ('confirmed','checked_in','checked_out')`);
  const review = (await one(`SELECT (SELECT count(*) FROM reservations WHERE needs_review AND status IN ('pending','hold'))::int a, (SELECT count(*) FROM conversations WHERE status='needs_staff')::int b, (SELECT count(*) FROM extension_requests WHERE status IN ('pending','conflict'))::int c, (SELECT count(*) FROM payments WHERE status='recorded')::int d`));
  const tasks = await q<any>(`SELECT * FROM tasks WHERE status='open' ORDER BY COALESCE(due_at, created_at) LIMIT 8`);
  const followups = await q<any>(`SELECT kind, run_at FROM scheduled_messages WHERE status='pending' ORDER BY run_at LIMIT 5`);
  return { today, arrivals, departures, inHouse, createdToday, pending, inv, outstanding, review, tasks, followups, occupancy: inv.bookable ? Math.round((inv.occupied / inv.bookable) * 100) : 0 };
}

export async function calendarData(from: string, days: number) {
  const to = addDays(from, days);
  const units = await q<any>(`SELECT u.id, u.label, u.capacity, rm.name room, t.name tname, t.kind FROM units u JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id WHERE u.active AND rm.active ORDER BY t.sort_order, rm.name, u.label`);
  const alloc = await q<any>(
    `SELECT ru.unit_id, lower(ru.during) s, upper(ru.during) e, r.id rid, r.reference, r.status, g.full_name, r.guests_count, r.hold_expires_at
     FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id JOIN guests g ON g.id=r.guest_id
     WHERE ru.active AND ru.during && daterange($1::date,$2::date,'[)')`, [from, to]);
  const blocks = await q<any>(`SELECT unit_id, lower(during) s, upper(during) e, reason FROM unit_blocks WHERE during && daterange($1::date,$2::date,'[)')`, [from, to]);
  return { units, alloc: alloc.filter((a) => !(['hold', 'pending'].includes(a.status) && a.hold_expires_at && new Date(a.hold_expires_at) < new Date())), blocks, to };
}

export async function reportData(from: string, to: string) {
  const one = async (s: string, a: any[]) => (await q<any>(s, a))[0];
  const nights = (await one(`SELECT COALESCE(SUM(upper(ru.during) - lower(ru.during)),0)::int n FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id
     WHERE r.status IN ('confirmed','checked_in','checked_out') AND ru.during && daterange($1::date,$2::date,'[)')`, [from, to])).n;
  // nights sold clipped to the report window
  const sold = (await one(`SELECT COALESCE(SUM(upper(i) - lower(i)),0)::int n FROM (SELECT ru.during * daterange($1::date,$2::date,'[)') i FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id WHERE r.status IN ('confirmed','checked_in','checked_out') AND ru.during && daterange($1::date,$2::date,'[)')) x`, [from, to])).n;
  const unitCount = (await one(`SELECT count(*)::int n FROM units u JOIN rooms rm ON rm.id=u.room_id WHERE u.active AND rm.active`, [])).n;
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000));
  const bySource = await q<any>(`SELECT source, count(*)::int n, count(*) FILTER (WHERE status IN ('confirmed','checked_in','checked_out'))::int confirmed FROM reservations WHERE (created_at AT TIME ZONE $3)::date >= $1::date AND (created_at AT TIME ZONE $3)::date < $2::date GROUP BY source ORDER BY n DESC`, [from, to, process.env.HOSTEL_TZ || 'Africa/Cairo']);
  const cancels = await q<any>(`SELECT status, count(*)::int n FROM reservations WHERE status IN ('cancelled','rejected','expired','no_show') AND check_in >= $1::date AND check_in < $2::date GROUP BY status`, [from, to]);
  const ext = await q<any>(`SELECT status, count(*)::int n, COALESCE(SUM(extra_cents) FILTER (WHERE status='applied'),0)::bigint cents FROM extension_requests WHERE created_at >= $1::date AND created_at < $2::date GROUP BY status`, [from, to]);
  const money = await one(`SELECT
      COALESCE(SUM(r.total_cents) FILTER (WHERE r.status IN ('confirmed','checked_in','checked_out')),0)::bigint booked,
      (SELECT COALESCE(SUM(amount_cents),0)::bigint FROM payments WHERE status='verified' AND (verified_at AT TIME ZONE 'Africa/Cairo')::date >= $1::date AND (verified_at AT TIME ZONE 'Africa/Cairo')::date < $2::date) received,
      (SELECT COALESCE(SUM(amount_cents),0)::bigint FROM payments WHERE status='recorded') unverified
    FROM reservations r WHERE r.check_in >= $1::date AND r.check_in < $2::date`, [from, to]);
  const outstanding = await one(`SELECT COALESCE(SUM(GREATEST(folio_charges(r.id) - p.paid,0)),0)::bigint n FROM reservations r LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0) paid FROM payments WHERE reservation_id=r.id) p ON true WHERE r.status IN ('confirmed','checked_in','checked_out')`, []);
  return { sold, unitCount, days, occupancy: unitCount ? Math.round((sold / (unitCount * days)) * 1000) / 10 : 0, bySource, cancels, ext, money, outstanding: outstanding.n, nights };
}

/** Tonight's occupancy per room type, and the next 7 nights overall (units booked ÷ bookable units). */
export async function houseView() {
  const today = todayLocal();
  const OCC = `EXISTS (SELECT 1 FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id WHERE ru.unit_id=u.id AND ru.active AND ru.during @> d.day AND NOT (r.status IN ('hold','pending') AND r.hold_expires_at < now()))`;
  const BLK = `EXISTS (SELECT 1 FROM unit_blocks b WHERE b.unit_id=u.id AND b.during @> d.day)`;
  const byType = await q<any>(`SELECT t.id, t.name, t.kind, count(*) FILTER (WHERE NOT ${BLK})::int total, count(*) FILTER (WHERE NOT ${BLK} AND ${OCC})::int booked
     FROM units u JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id, (SELECT $1::date AS day) d
     WHERE u.active AND rm.active AND t.active GROUP BY t.id, t.name, t.kind, t.sort_order ORDER BY t.kind DESC, t.sort_order`, [today]);
  const week = await q<any>(`SELECT d.day::text AS day, count(*) FILTER (WHERE NOT ${BLK})::int total, count(*) FILTER (WHERE NOT ${BLK} AND ${OCC})::int booked
     FROM (SELECT g::date AS day FROM generate_series($1::date, $1::date + 6, interval '1 day') g) d
     CROSS JOIN units u JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id
     WHERE u.active AND rm.active AND t.active GROUP BY d.day ORDER BY d.day`, [today]);
  const recent = await q<any>(`SELECT r.id, r.reference, r.source, r.status, r.check_in, r.check_out, r.guests_count, r.needs_review, r.created_at, g.full_name, t.name tname
     FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN room_types t ON t.id=r.room_type_id WHERE r.status IN ('pending','hold') ORDER BY r.created_at DESC LIMIT 6`);
  return { byType, week, recent };
}

/** Small counters for the sidebar. */
export async function navCounts() {
  return (await q<any>(`SELECT (SELECT count(*) FROM reservations WHERE status IN ('pending','hold') AND (hold_expires_at IS NULL OR hold_expires_at > now()))::int pending,
    (SELECT count(*) FROM conversations WHERE status='needs_staff')::int inbox, (SELECT count(*) FROM payments WHERE status='recorded')::int payments,
    (SELECT count(*) FROM extension_requests WHERE status IN ('pending','conflict'))::int extensions,
    (SELECT count(*) FROM online_payments WHERE provider='instapay' AND status='submitted')::int instapay,
    (SELECT count(*) FROM reservations WHERE status IN ('pending','confirmed','hold') AND check_in = (now() AT TIME ZONE 'Africa/Cairo')::date)::int arrivals,
    (SELECT count(*) FROM rooms WHERE active AND hk_status='dirty')::int dirty,
    (SELECT count(*) FROM products WHERE is_active AND track_stock AND stock_quantity <= low_stock_threshold)::int lowstock,
    (SELECT count(*) FROM cash_shortages WHERE status='open')::int shortages,
    (SELECT count(*) FROM taxi_bookings WHERE status='booked' AND confirmed_at IS NULL AND scheduled_at > now() AND scheduled_at < now() + interval '36 hours')::int taxis,
    (SELECT count(*) FROM tasks WHERE status='open')::int tasks,
    (SELECT count(*) FROM reservations WHERE needs_review AND status IN ('pending','hold'))::int flagged,
    (SELECT count(*) FROM reservations WHERE status='checked_in' AND check_out <= (now() AT TIME ZONE 'Africa/Cairo')::date)::int departures`))[0];
}
