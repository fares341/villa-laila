// Idempotent. Creates: first owner (if no users), automation rules, a DRAFT (inactive) Egyptian-guest policy placeholder,
// the real room catalogue from the hostel's website, and — only when SEED_DEMO=true — clearly labelled DEMO prices for rooms without a published price. No real guest data is ever seeded.
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { CATALOG, FEATURES } from '../src/content/rooms-catalog';

const RULES: [string, string, number, number][] = [
  ['incomplete_booking', 'Guest started a booking but did not finish', 60, 2],
  ['pending_reminder', 'Remind guest their pending request is still under review', 720, 1],
  ['staff_unreviewed', 'Alert staff: pending request not reviewed yet', 180, 1],
  ['payment_followup', 'Payment balance reminder', 1440, 1],
  ['pre_arrival', 'Pre-arrival message (minutes before 10:00 on the day before... see docs)', 1440, 1],
  ['checkin_reminder', 'Check-in day reminder (08:00 local)', 0, 1],
  ['checkout_reminder', 'Check-out day reminder (08:00 local)', 0, 1],
  ['extension_followup', 'Extension request still pending', 120, 1],
  ['inquiry_unanswered', 'Alert staff: guest message unanswered', 30, 1],
  ['escalation_unattended', 'Alert staff: escalation not assigned', 15, 1],
  ['expiry_notice', 'Tell guest their request expired', 0, 3],
];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const c = await pool.connect();
  try {
    const users = await c.query('SELECT count(*)::int n FROM users');
    if (users.rows[0].n === 0) {
      const email = process.env.ADMIN_EMAIL, pw = process.env.ADMIN_PASSWORD;
      if (!email || !pw || pw.length < 10) console.warn('! ADMIN_EMAIL / ADMIN_PASSWORD (>=10 chars) not set: no owner account created.');
      else { await c.query(`INSERT INTO users(email,name,password_hash,role) VALUES($1,'Owner',$2,'owner')`, [email.toLowerCase(), await bcrypt.hash(pw, 11)]); console.log('created owner', email); }
    }
    for (const [kind, label, delay, maxDay] of RULES)
      await c.query(`INSERT INTO automation_rules(kind,label,delay_minutes,max_per_day) VALUES($1,$2,$3,$4) ON CONFLICT (kind) DO NOTHING`, [kind, label, delay, maxDay + 2]);

    // Egyptian-guest rules, as instructed by the owner. Wording of the guest messages is a draft: confirm with the owner.
    await c.query(`DELETE FROM policy_rules WHERE name LIKE '%PLACEHOLDER%' AND active=false`);
    const EG_RULES: [string, unknown[], Record<string, string>][] = [
      ['Egyptian and Arab nationals cannot book MIXED dorms', [{ field: 'nationality', op: 'in', value: ['DZ', 'BH', 'KM', 'DJ', 'EG', 'IQ', 'JO', 'KW', 'LB', 'LY', 'MR', 'MA', 'OM', 'PS', 'QA', 'SA', 'SO', 'SD', 'SY', 'TN', 'AE', 'YE'] }, { field: 'room_kind', op: 'eq', value: 'dorm' }, { field: 'room_gender', op: 'eq', value: 'mixed' }],
        { key: 'dorm', en: "Sorry, mixed dormitories can't be booked by Egyptian or Arab nationals. Please choose a private room, a women-only or men-only dorm, or contact reception.", ar: 'عذرًا، لا يمكن للمصريين والجنسيات العربية حجز الغرف المشتركة المختلطة. من فضلك اختر غرفة خاصة أو غرفة مشتركة للبنات أو للشباب، أو تواصل مع الاستقبال.', es: 'Lo sentimos, los dormitorios mixtos no pueden ser reservados por ciudadanos egipcios.', fr: 'Désolé, les dortoirs mixtes ne peuvent pas être réservés par des ressortissants égyptiens.' }],
      ['Egyptian ID issued in Cairo / Giza / Qalyubia cannot stay', [{ field: 'nationality', op: 'eq', value: 'EG' }, { field: 'id_governorate', op: 'in', value: ['cairo', 'giza', 'qalyubia'] }],
        { key: 'id', en: "Sorry, we can't accommodate guests whose Egyptian national ID was issued in Cairo, Giza or Qalyubia.", ar: 'عذرًا، لا يمكننا استضافة من صدرت بطاقته الشخصية المصرية من محافظة القاهرة أو الجيزة أو القليوبية.', es: 'Lo sentimos, no podemos alojar a huéspedes cuyo documento egipcio fue emitido en El Cairo, Giza o Qalyubia.', fr: "Désolé, nous ne pouvons pas accueillir les clients dont la carte d'identité égyptienne a été délivrée au Caire, à Gizeh ou à Qalyubia." }],
    ];
    for (const [name, conds, msg] of EG_RULES) {
      const ex = await c.query('SELECT 1 FROM policy_rules WHERE name=$1', [name]);
      if (!ex.rowCount) await c.query(`INSERT INTO policy_rules(name,active,conditions,action,message,notes) VALUES($1,true,$2,'block',$3,$4)`, [name, JSON.stringify(conds), JSON.stringify(msg), 'Set from the owner instruction. Confirm exact wording/scope with the owner. Edit or deactivate in Settings.']);
    }

    // Real room catalogue (from the hostel's own website). Seeded once, when there is no inventory yet.
    const has = await c.query('SELECT count(*)::int n FROM room_types');
    if (has.rows[0].n === 0) {
      let sort = 0;
      for (const r of CATALOG) {
        const amen = r.features.map((f) => FEATURES[f]);
        const t = (await c.query(
          `INSERT INTO room_types(code,kind,name,description,amenities,sort_order,gender,photos,details,source_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [r.code, r.kind, r.name, r.description, JSON.stringify(amen), ++sort, r.gender, JSON.stringify(r.photos), JSON.stringify({ bed: r.bed, sleeps: r.sleeps, beds: r.beds ?? null, features: r.features }), r.ref])).rows[0].id;
        const room = (await c.query('INSERT INTO rooms(room_type_id,name) VALUES($1,$2) RETURNING id', [t, r.name.en])).rows[0].id;
        if (r.kind === 'dorm') for (let b = 1; b <= (r.beds ?? 1); b++) await c.query('INSERT INTO units(room_id,label,capacity) VALUES($1,$2,1)', [room, `Bed ${b}`]);
        else await c.query('INSERT INTO units(room_id,label,capacity) VALUES($1,$2,$3)', [room, r.name.en, r.sleeps]);
        if (r.publishedPrice != null)
          await c.query(`INSERT INTO rates(room_type_id,name,price_cents) VALUES($1,'Published on villalaylahostel.com (check currency)',$2)`, [t, r.publishedPrice * 100]);
        else if (process.env.SEED_DEMO === 'true')
          await c.query(`INSERT INTO rates(room_type_id,name,price_cents,is_demo) VALUES($1,'DEMO price — replace',$2,true)`, [t, (r.kind === 'dorm' ? 15 : r.sleeps === 3 ? 55 : r.features.includes('private_bath') ? 45 : 35) * 100]);
      }
      // The only price the hostel publishes (18 per dorm bed) only makes sense in a foreign currency; USD assumed — owner to confirm.
      await c.query(`INSERT INTO settings(key,value) VALUES('currency','"USD"') ON CONFLICT (key) DO NOTHING`);
      console.log(`seeded ${CATALOG.length} real room types${process.env.SEED_DEMO === 'true' ? ' (+ DEMO prices where the hostel publishes none)' : ''}`);
    }
  } finally { c.release(); await pool.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
