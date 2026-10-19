import { q, pool } from '@/lib/db';

export const hasDb = !!process.env.DATABASE_URL;

export async function resetDb() {
  await q(`TRUNCATE processed_updates, messages, scheduled_messages, tasks, extension_requests, payments, reservation_events, reservation_units, reservations,
    unit_blocks, rates, units, rooms, room_types, conversations, guests, audit_log, settings RESTART IDENTITY CASCADE`);
  await q(`UPDATE policy_rules SET active=false`);
}
export async function ruleDefaults() {
  const kinds = ['incomplete_booking', 'pending_reminder', 'staff_unreviewed', 'payment_followup', 'pre_arrival', 'checkin_reminder', 'checkout_reminder', 'extension_followup', 'inquiry_unanswered', 'escalation_unattended', 'expiry_notice'];
  for (const k of kinds) await q(`INSERT INTO automation_rules(kind,label,delay_minutes,max_per_day) VALUES($1,$1,0,5) ON CONFLICT (kind) DO UPDATE SET delay_minutes=0, enabled=true, max_attempts=3, retry_minutes=15, max_per_day=5`, [k]);
}

/** dorm with `beds` beds + a private double, with flat demo rates (test data only) */
export async function seedInventory(beds = 3) {
  const dorm = (await q(`INSERT INTO room_types(code,kind,name) VALUES('dorm','dorm','{"en":"Dorm"}') RETURNING id`))[0].id;
  const priv = (await q(`INSERT INTO room_types(code,kind,name) VALUES('priv','private','{"en":"Private"}') RETURNING id`))[0].id;
  const r1 = (await q(`INSERT INTO rooms(room_type_id,name) VALUES($1,'Dorm A') RETURNING id`, [dorm]))[0].id;
  const units: string[] = [];
  for (let i = 1; i <= beds; i++) units.push((await q(`INSERT INTO units(room_id,label,capacity) VALUES($1,$2,1) RETURNING id`, [r1, 'Bed ' + i]))[0].id);
  const r2 = (await q(`INSERT INTO rooms(room_type_id,name) VALUES($1,'Room 1') RETURNING id`, [priv]))[0].id;
  const pu = (await q(`INSERT INTO units(room_id,label,capacity) VALUES($1,'Room 1',2) RETURNING id`, [r2]))[0].id;
  await q(`INSERT INTO rates(room_type_id,price_cents) VALUES($1,10000),($2,30000)`, [dorm, priv]);
  return { dorm, priv, units, pu };
}
export const guest = (n = 'Test Guest', extra: Record<string, unknown> = {}) => ({ fullName: n, email: `${n.replace(/\s/g, '').toLowerCase()}@example.test`, language: 'en', ...extra });
export const closePool = () => pool().end();
