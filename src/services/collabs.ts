import { randomUUID } from 'node:crypto';
import { q, tx } from '@/lib/db';
import { saveBuffer } from '@/lib/uploads';
import { audit } from './audit';
import { BookingError } from './errors';

/**
 * Collaboration events: an event made together with a partner. It has its own page (/c/<slug>) made to be shared on
 * Instagram stories: our logo & the partner's logo, the partner's name, the description, photos, the meals of the
 * night, then a short form to say "I'm coming". Managed in Dashboard → Collab events.
 */
export type Loc = { ar?: string; en?: string };
export type CollabMeal = { title: Loc; points: Loc; img: string | null };
export type Collab = {
  id: string; slug: string; active: boolean; partner_name: string; partner_logo: string | null; partner_link: string | null;
  title: Loc; description: Loc; event_date: string | null; start_time: string | null; end_time: string | null; place: Loc; price_note: Loc;
  capacity: number | null; accent: string; photos: string[]; meals: CollabMeal[]; ask_email: boolean; created_at: string; updated_at: string;
};

const COLS = `id, slug, active, partner_name, partner_logo, partner_link, title, description, event_date::text event_date, start_time, end_time, place, price_note,
  capacity, accent, photos, meals, ask_email, created_at, updated_at`;
const clean = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'collab';
const MAX_IMG = 10 * 1024 * 1024;

export type Upload = { bytes: Buffer; mime: string; name?: string };

/** Saves a photo in the uploads folder and returns its address on the site. */
export async function savePhoto(f: Upload): Promise<string> {
  if (!/^image\/(jpeg|png|webp|avif|gif)$/.test(f.mime)) throw new BookingError('INVALID_INPUT', 'Photos must be JPG, PNG or WebP');
  if (f.bytes.length > MAX_IMG) throw new BookingError('INVALID_INPUT', 'Each photo must be under 10 MB');
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' } as Record<string, string>)[f.mime];
  const id = randomUUID();
  await saveBuffer(`site/${id}.${ext}`, f.bytes);
  return `/api/media/site/${id}.${ext}`;
}

export async function listCollabs(): Promise<(Collab & { going: number; people: number })[]> {
  return q<any>(`SELECT ${COLS},
      (SELECT count(*)::int FROM collab_rsvps r WHERE r.collab_id=c.id AND r.status='going') going,
      (SELECT COALESCE(sum(people),0)::int FROM collab_rsvps r WHERE r.collab_id=c.id AND r.status='going') people
    FROM collabs c ORDER BY COALESCE(event_date, created_at::date) DESC, created_at DESC`).catch(() => []);
}
export async function getCollab(id: string): Promise<Collab | null> {
  return (await q<Collab>(`SELECT ${COLS} FROM collabs WHERE id=$1`, [id]))[0] ?? null;
}
export async function getCollabBySlug(slug: string): Promise<Collab | null> {
  return (await q<Collab>(`SELECT ${COLS} FROM collabs WHERE slug=$1`, [slug]).catch(() => []))[0] ?? null;
}

/** People who said they are coming (sum of each sign-up's people). */
export async function peopleGoing(collabId: string): Promise<number> {
  return (await q<any>(`SELECT COALESCE(sum(people),0)::int n FROM collab_rsvps WHERE collab_id=$1 AND status='going'`, [collabId]))[0]?.n ?? 0;
}

export type CollabInput = {
  id?: string | null; active: boolean; partnerName: string; partnerLink?: string; titleAr?: string; titleEn?: string; descAr?: string; descEn?: string;
  date?: string; startTime?: string; endTime?: string; placeAr?: string; placeEn?: string; priceAr?: string; priceEn?: string;
  capacity?: number | null; accent?: string; askEmail?: boolean;
  logo?: Upload | null; newPhotos?: Upload[]; keepPhotos?: string[];
  meals?: { titleAr: string; titleEn: string; pointsAr: string; pointsEn: string; img: string | null; photo?: Upload | null; remove?: boolean }[];
};

const points = (s: unknown) => String(s ?? '').split(/\r?\n/).map((x) => x.trim().replace(/^[-•*·]\s*/, '').slice(0, 160)).filter(Boolean).slice(0, 6).join('\n');

export async function saveCollab(v: CollabInput, actor: string): Promise<string> {
  const partner = clean(v.partnerName, 80);
  if (!partner) throw new BookingError('INVALID_INPUT', 'Write the partner’s name');
  const title = { ar: clean(v.titleAr, 120), en: clean(v.titleEn, 120) };
  if (!title.ar && !title.en) throw new BookingError('INVALID_INPUT', 'Write the event title');
  const date = v.date && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null;
  const time = (t?: string) => (t && /^\d{2}:\d{2}$/.test(t) ? t : null);
  const accent = /^#[0-9a-f]{6}$/i.test(v.accent || '') ? v.accent! : '#D29A45';
  const link = /^https?:\/\/\S+$/i.test(v.partnerLink || '') ? clean(v.partnerLink, 300) : v.partnerLink ? `https://instagram.com/${clean(v.partnerLink, 60).replace(/^@/, '')}` : null;
  const old = v.id ? await getCollab(v.id) : null;
  if (v.id && !old) throw new BookingError('NOT_FOUND');
  const logo = v.logo ? await savePhoto(v.logo) : old?.partner_logo ?? null;
  const photos = [...(v.keepPhotos ?? old?.photos ?? []).filter((p) => (old?.photos ?? []).includes(p))];
  for (const f of v.newPhotos ?? []) photos.push(await savePhoto(f));
  const meals: CollabMeal[] = [];
  for (const m of v.meals ?? []) {
    if (m.remove) continue;
    const t = { ar: clean(m.titleAr, 80), en: clean(m.titleEn, 80) };
    if (!t.ar && !t.en) continue;
    meals.push({ title: t, points: { ar: points(m.pointsAr), en: points(m.pointsEn) }, img: m.photo ? await savePhoto(m.photo) : m.img });
  }
  const row = [partner, logo, link, JSON.stringify(title), JSON.stringify({ ar: clean(v.descAr, 4000), en: clean(v.descEn, 4000) }), date, time(v.startTime), time(v.endTime),
    JSON.stringify({ ar: clean(v.placeAr, 120), en: clean(v.placeEn, 120) }), JSON.stringify({ ar: clean(v.priceAr, 120), en: clean(v.priceEn, 120) }),
    v.capacity && v.capacity > 0 ? Math.min(5000, Math.trunc(v.capacity)) : null, accent, JSON.stringify(photos.slice(0, 20)), JSON.stringify(meals.slice(0, 8)), !!v.askEmail, v.active];
  let id = v.id ?? null;
  if (id) {
    await q(`UPDATE collabs SET partner_name=$2, partner_logo=$3, partner_link=$4, title=$5, description=$6, event_date=$7, start_time=$8, end_time=$9, place=$10, price_note=$11,
      capacity=$12, accent=$13, photos=$14, meals=$15, ask_email=$16, active=$17, updated_at=now() WHERE id=$1`, [id, ...row]);
  } else {
    let slug = slugify(`${partner} ${title.en || ''}`.trim());
    if ((await q('SELECT 1 FROM collabs WHERE slug=$1', [slug])).length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    id = (await q<any>(`INSERT INTO collabs(slug, partner_name, partner_logo, partner_link, title, description, event_date, start_time, end_time, place, price_note,
      capacity, accent, photos, meals, ask_email, active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`, [slug, ...row]))[0].id;
  }
  await audit(actor, old ? 'collab.update' : 'collab.create', 'collab', id!, { partner });
  return id!;
}

export async function deleteCollab(id: string, actor: string) {
  await q(`DELETE FROM collabs WHERE id=$1`, [id]);
  await audit(actor, 'collab.delete', 'collab', id, {});
}

/* ───────── Sign-ups ───────── */

export type RsvpInput = { slug: string; fullName: string; phone: string; email?: string | null; people: number; instagram?: string | null; note?: string | null };

export async function addRsvp(v: RsvpInput) {
  const name = clean(v.fullName, 80);
  const phone = clean(v.phone, 30);
  const people = Math.trunc(Number(v.people));
  if (name.length < 2) throw new BookingError('INVALID_INPUT', 'name');
  if (phone.replace(/\D/g, '').length < 7) throw new BookingError('INVALID_INPUT', 'phone');
  if (!(people >= 1 && people <= 10)) throw new BookingError('INVALID_INPUT', 'people');
  return tx(async (c) => {
    const ev = (await c.query(`SELECT ${COLS} FROM collabs WHERE slug=$1 AND active FOR UPDATE`, [v.slug])).rows[0] as Collab | undefined;
    if (!ev) throw new BookingError('NOT_FOUND');
    if (ev.event_date && ev.event_date < new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10)) throw new BookingError('BAD_STATE', 'over');
    if (ev.ask_email && !/^\S+@\S+\.\S+$/.test(v.email || '')) throw new BookingError('INVALID_INPUT', 'email');
    // The same phone twice: update that sign-up instead of adding another.
    const prev = (await c.query(`SELECT id, people FROM collab_rsvps WHERE collab_id=$1 AND regexp_replace(phone,'\\D','','g')=regexp_replace($2,'\\D','','g') AND status='going'`, [ev.id, phone])).rows[0];
    if (ev.capacity != null) {
      const taken = (await c.query(`SELECT COALESCE(sum(people),0)::int n FROM collab_rsvps WHERE collab_id=$1 AND status='going'`, [ev.id])).rows[0].n - (prev?.people ?? 0);
      if (taken + people > ev.capacity) throw new BookingError('NO_AVAILABILITY', String(Math.max(0, ev.capacity - taken)));
    }
    const vals = [name, phone, v.email ? clean(v.email, 120) : null, people, v.instagram ? clean(v.instagram, 60).replace(/^@/, '') : null, v.note ? clean(v.note, 300) : null];
    const row = prev
      ? (await c.query(`UPDATE collab_rsvps SET full_name=$2, phone=$3, email=$4, people=$5, instagram=$6, note=$7 WHERE id=$1 RETURNING *`, [prev.id, ...vals])).rows[0]
      : (await c.query(`INSERT INTO collab_rsvps(collab_id, full_name, phone, email, people, instagram, note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [ev.id, ...vals])).rows[0];
    return { rsvp: row, collab: ev, updated: !!prev };
  });
}

export async function listRsvps(collabId: string) {
  return q<any>(`SELECT * FROM collab_rsvps WHERE collab_id=$1 ORDER BY status='going' DESC, created_at`, [collabId]);
}

export async function setRsvp(id: string, op: 'cancel' | 'restore' | 'checkin' | 'uncheck', actor: string) {
  const set = op === 'cancel' ? `status='cancelled'` : op === 'restore' ? `status='going'` : op === 'checkin' ? `checked_in_at=now()` : `checked_in_at=NULL`;
  const r = (await q<any>(`UPDATE collab_rsvps SET ${set} WHERE id=$1 RETURNING collab_id`, [id]))[0];
  await audit(actor, 'collab.rsvp_' + op, 'collab_rsvp', id, {});
  return r?.collab_id as string | undefined;
}

export const csvOf = (rows: any[]) => {
  const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  return ['Name,Phone,Email,People,Instagram,Note,Status,Checked in,Signed up', ...rows.map((r) => [r.full_name, r.phone, r.email, r.people, r.instagram, r.note, r.status, r.checked_in_at ?? '', new Date(r.created_at).toISOString()].map(esc).join(','))].join('\n');
};
