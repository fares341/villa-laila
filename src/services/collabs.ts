import { randomUUID, createHmac } from 'node:crypto';
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
/** An extra question on the ticket form: free text, one choice, or several choices (checkboxes). */
export type CollabQuestion = { id: string; label: Loc; type: 'text' | 'choice' | 'multi'; options: Loc[]; required: boolean };
export type PriceMode = 'free' | 'pwyw' | 'fixed';
export type CollabMeal = { title: Loc; points: Loc; img: string | null; from?: string | null };
export type Collab = {
  id: string; slug: string; active: boolean; partner_name: string; partner_logo: string | null; partner_link: string | null;
  title: Loc; description: Loc; event_date: string | null; start_time: string | null; end_time: string | null; place: Loc; price_note: Loc;
  capacity: number | null; accent: string; photos: string[]; meals: CollabMeal[]; ask_email: boolean; notify_emails: string[]; questions: CollabQuestion[]; price_mode: PriceMode; price_cents: number | null; created_at: string; updated_at: string;
};

const COLS = `id, slug, active, partner_name, partner_logo, partner_link, title, description, event_date::text event_date, start_time, end_time, place, price_note,
  capacity, accent, photos, meals, ask_email, notify_emails, questions, price_mode, price_cents, created_at, updated_at`;
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

/** "a@x.com, b@y.com" or one per line → valid, unique addresses (at most 10). */
export function parseEmails(raw?: string | null): string[] {
  const out = new Set<string>();
  for (const e of String(raw ?? '').split(/[\s,;]+/)) if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.add(e.toLowerCase().slice(0, 120));
  return [...out].slice(0, 10);
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
  capacity?: number | null; accent?: string; askEmail?: boolean; notifyEmails?: string;
  questions?: { labelAr: string; labelEn: string; type: string; optionsAr: string; optionsEn: string; required: boolean; id?: string }[];
  priceMode?: string; price?: string;
  logo?: Upload | null; newPhotos?: Upload[]; keepPhotos?: string[];
  meals?: { titleAr: string; titleEn: string; pointsAr: string; pointsEn: string; img: string | null; photo?: Upload | null; remove?: boolean; pick?: string }[];
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
    // A meal from the villa's weekly menu ("dinner:6" = Saturday dinner): its name, points and photo come from there.
    const pk = /^(dinner|breakfast):([0-6])$/.exec(m.pick ?? '');
    if (pk) {
      const { weeklyMenu } = await import('./weekly-menu');
      const d = (await weeklyMenu(pk[1] as 'dinner' | 'breakfast'))[Number(pk[2])];
      if (d && (d.title.ar || d.title.en)) {
        const pts = (x: 'ar' | 'en') => points(d.description[x] || d.dishes.map((y) => y[x] || '').filter(Boolean).join('\n'));
        meals.push({ title: { ar: d.title.ar ?? '', en: d.title.en ?? '' }, points: { ar: pts('ar'), en: pts('en') }, img: d.img, from: m.pick });
      }
      continue;
    }
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
  // Extra questions (up to 8) and the entry price.
  const questions: CollabQuestion[] = [];
  for (const x of v.questions ?? []) {
    const label = { ar: clean(x.labelAr, 160), en: clean(x.labelEn, 160) };
    if (!label.ar && !label.en) continue;
    const type = x.type === 'choice' || x.type === 'multi' ? x.type : 'text';
    const oa = String(x.optionsAr ?? '').split(/\r?\n/).map((o) => clean(o, 80)), oe = String(x.optionsEn ?? '').split(/\r?\n/).map((o) => clean(o, 80));
    const options = Array.from({ length: Math.max(oa.length, oe.length) }, (_, i) => ({ ar: oa[i] || '', en: oe[i] || '' })).filter((o) => o.ar || o.en).slice(0, 12);
    if (type !== 'text' && options.length < 2) throw new BookingError('INVALID_INPUT', `Question «${label.en || label.ar}» needs at least 2 choices (one per line)`);
    questions.push({ id: x.id && /^q[a-z0-9]{2,12}$/.test(x.id) ? x.id : 'q' + randomUUID().slice(0, 6), label, type, options: type === 'text' ? [] : options, required: !!x.required });
  }
  const mode: PriceMode = v.priceMode === 'pwyw' || v.priceMode === 'fixed' ? v.priceMode : 'free';
  const pc = Math.round(Number(String(v.price ?? '').replace(/[^\d.]/g, '')) * 100);
  if (mode === 'fixed' && !(pc > 0)) throw new BookingError('INVALID_INPUT', 'Write the ticket price');
  await q(`UPDATE collabs SET notify_emails=$2, questions=$3, price_mode=$4, price_cents=$5 WHERE id=$1`,
    [id, parseEmails(v.notifyEmails), JSON.stringify(questions.slice(0, 8)), mode, pc > 0 ? Math.min(pc, 10_000_000) : null]);
  await audit(actor, old ? 'collab.update' : 'collab.create', 'collab', id!, { partner });
  return id!;
}

export async function deleteCollab(id: string, actor: string) {
  await q(`DELETE FROM collabs WHERE id=$1`, [id]);
  await audit(actor, 'collab.delete', 'collab', id, {});
}

/* ───────── Sign-ups ───────── */

export type RsvpInput = { slug: string; fullName: string; phone: string; email?: string | null; people: number; instagram?: string | null; note?: string | null; answers?: Record<string, unknown>; offer?: unknown };

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
    // Answers to the extra questions: each checked against its type and choices.
    const answers: Record<string, string | string[]> = {};
    for (const qn of ev.questions ?? []) {
      const raw = v.answers?.[qn.id];
      const allowed = qn.options.map((o) => o.en || o.ar || '');
      let a: string | string[] = '';
      if (qn.type === 'multi') a = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => clean(x, 80)).filter((x) => allowed.includes(x));
      else if (qn.type === 'choice') a = allowed.includes(clean(raw, 80)) ? clean(raw, 80) : '';
      else a = clean(Array.isArray(raw) ? raw.join(', ') : raw, 500);
      if (qn.required && (Array.isArray(a) ? !a.length : !a)) throw new BookingError('INVALID_INPUT', 'q:' + qn.id);
      if (Array.isArray(a) ? a.length : a) answers[qn.id] = a;
    }
    // Pay what you want: the amount per ticket the guest says they will pay at the villa.
    let offer: number | null = null;
    if (ev.price_mode === 'pwyw') {
      const n = Number(String(v.offer ?? '').replace(/[^\d.]/g, ''));
      if (String(v.offer ?? '').trim() === '' || !(n >= 0) || n > 100000) throw new BookingError('INVALID_INPUT', 'offer');
      offer = Math.round(n * 100);
    }
    const vals = [name, phone, v.email ? clean(v.email, 120) : null, people, v.instagram ? clean(v.instagram, 60).replace(/^@/, '') : null, v.note ? clean(v.note, 300) : null, JSON.stringify(answers), offer];
    const row = prev
      ? (await c.query(`UPDATE collab_rsvps SET full_name=$2, phone=$3, email=$4, people=$5, instagram=$6, note=$7, answers=$8, offer_cents=$9 WHERE id=$1 RETURNING *`, [prev.id, ...vals])).rows[0]
      : (await c.query(`INSERT INTO collab_rsvps(collab_id, full_name, phone, email, people, instagram, note, answers, offer_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [ev.id, ...vals])).rows[0];
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

/** The answer to one question as text ("a, b" for several choices). */
export const answerText = (r: any, qn: CollabQuestion) => { const a = r.answers?.[qn.id]; return Array.isArray(a) ? a.join(', ') : String(a ?? ''); };
/** What the ticket costs: fixed price × tickets, or what the guest offered per ticket (pay what you want). */
export const ticketMoney = (r: any, c: Pick<Collab, 'price_mode' | 'price_cents'>) =>
  c.price_mode === 'fixed' && c.price_cents ? `EGP ${(c.price_cents * Number(r.people)) / 100}` : c.price_mode === 'pwyw' && r.offer_cents != null ? `EGP ${(r.offer_cents * Number(r.people)) / 100} (${r.offer_cents / 100} each, own choice)` : c.price_mode === 'free' ? 'Free' : '';

export const csvOf = (rows: any[], c?: Collab) => {
  const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const qs = c?.questions ?? [];
  const head = ['Name', 'Phone', 'Email', 'Tickets', ...(c && c.price_mode !== 'free' ? ['To pay'] : []), ...qs.map((qn) => qn.label.en || qn.label.ar || ''), 'Instagram', 'Note', 'Status', 'Checked in', 'Booked'];
  return [head.map(esc).join(','), ...rows.map((r) => [r.full_name, r.phone, r.email, r.people, ...(c && c.price_mode !== 'free' ? [ticketMoney(r, c)] : []), ...qs.map((qn) => answerText(r, qn)), r.instagram, r.note, r.status, r.checked_in_at ?? '', new Date(r.created_at).toISOString()].map(esc).join(','))].join('\n');
};

/** E-mails one sign-up to the addresses chosen for that collab (ours and the partner's). */
export async function emailCollabRsvp(r: any, c: Collab, updated: boolean, base = '') {
  const { sendMail, mailEnabled } = await import('@/lib/mailer');
  const to = Array.from(new Set([...(c.notify_emails ?? []), 'bookings@villalaylahostel.com']));
  if (!to.length) return;
  if (!mailEnabled()) { console.warn('[collab mail] SMTP_* not set in .env, sign-up not e-mailed'); return; }
  const title = c.title.en || c.title.ar || 'Collab event';
  const going = await peopleGoing(c.id);
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const rows: [string, string][] = [
    ['Name', r.full_name], ['Phone / WhatsApp', r.phone], ['People', String(r.people)],
    ...(r.email ? [['E-mail', r.email] as [string, string]] : []),
    ...(r.instagram ? [['Instagram', '@' + r.instagram] as [string, string]] : []),
    ...(c.price_mode !== 'free' && ticketMoney(r, c) ? [['To pay at the villa', ticketMoney(r, c)] as [string, string]] : []),
    ...(c.questions ?? []).filter((qn) => answerText(r, qn)).map((qn) => [qn.label.en || qn.label.ar || '', answerText(r, qn)] as [string, string]),
    ...(r.note ? [['Note', r.note] as [string, string]] : []),
  ];
  const total = `${going} people signed up${c.capacity ? ` of ${c.capacity}` : ''}`;
  const subject = `${updated ? 'Ticket changed' : 'New ticket'}: ${r.full_name} (${r.people}) · ${title}`;
  const text = [`${updated ? 'A ticket was changed' : 'New ticket'} for ${title} — Villa Layla & ${c.partner_name}${c.event_date ? ` (${c.event_date})` : ''}`, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), '', total, base ? `Page: ${base}/c/${c.slug}` : ''].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;max-width:520px;color:#2F2925">
<p style="margin:0 0 4px;color:#9a7a55;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Villa Layla &amp; ${esc(c.partner_name)}</p>
<h2 style="margin:0 0 14px;font-size:20px">${updated ? 'Ticket changed' : 'New ticket'} · ${esc(title)}</h2>
<table style="border-collapse:collapse;width:100%;font-size:15px">${rows.map(([k, v]) => `<tr><td style="padding:8px 10px;border:1px solid #eadfce;color:#7a6a5c;width:150px">${esc(k)}</td><td style="padding:8px 10px;border:1px solid #eadfce;font-weight:bold">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:14px 0 0;font-size:14px">${esc(total)}${c.event_date ? ` · ${esc(c.event_date)}` : ''}</p>
${base ? `<p style="margin:6px 0 0;font-size:13px"><a href="${esc(base)}/c/${esc(c.slug)}">${esc(base)}/c/${esc(c.slug)}</a></p>` : ''}</div>`;
  await sendMail({ to, subject, text, html, replyTo: r.email || null });
}

/* ───────── Clone ───────── */

/** A copy of a collab event with a new date (everything but its tickets), saved hidden so it can be checked first. */
export async function cloneCollab(id: string, date: string | null, actor: string): Promise<string> {
  const c = await getCollab(id);
  if (!c) throw new BookingError('NOT_FOUND');
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const base = slugify(`${c.partner_name} ${c.title.en || ''} ${d ?? ''}`.trim());
  let slug = base;
  if ((await q('SELECT 1 FROM collabs WHERE slug=$1', [slug])).length) slug = `${base}-${Date.now().toString(36).slice(-4)}`;
  const nid = (await q<any>(`INSERT INTO collabs(slug, active, partner_name, partner_logo, partner_link, title, description, event_date, start_time, end_time, place, price_note,
      capacity, accent, photos, meals, ask_email, notify_emails, questions, price_mode, price_cents)
    SELECT $2, false, partner_name, partner_logo, partner_link, title, description, $3::date, start_time, end_time, place, price_note,
      capacity, accent, photos, meals, ask_email, notify_emails, questions, price_mode, price_cents FROM collabs WHERE id=$1 RETURNING id`, [id, slug, d]))[0].id;
  await audit(actor, 'collab.clone', 'collab', nid, { from: id, date: d });
  return nid;
}

/* ───────── Invitations ───────── */

export type Contact = { email: string; name: string; last: string; times: number; from: string; invited: boolean; optedOut: boolean };

/**
 * Everyone who left an e-mail before: collab tickets and event bookings, one line per address (the latest name,
 * the last event, how many times). `invited` = already invited to this collab; `optedOut` = asked for no more e-mails.
 */
export async function contactsFor(collabId: string): Promise<Contact[]> {
  return q<Contact>(`
    WITH all_rows AS (
      SELECT lower(trim(r.email)) email, r.full_name name, r.created_at at, COALESCE(c.title->>'en', c.title->>'ar', 'Collab') ev
        FROM collab_rsvps r JOIN collabs c ON c.id=r.collab_id WHERE r.email ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' AND r.collab_id <> $1
      UNION ALL
      SELECT lower(trim(b.email)), b.full_name, b.created_at, COALESCE(e.title->>'en', e.title->>'ar', 'Event')
        FROM event_bookings b JOIN events e ON e.id=b.event_id WHERE b.email ~ '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' AND b.status <> 'cancelled'
    ), g AS (
      SELECT email, (array_agg(name ORDER BY at DESC))[1] name, (array_agg(ev ORDER BY at DESC))[1] "from", max(at)::date::text last, count(*)::int times FROM all_rows GROUP BY email
    )
    SELECT g.*, EXISTS(SELECT 1 FROM collab_invites i WHERE i.collab_id=$1 AND i.email=g.email AND i.status='sent') invited,
           EXISTS(SELECT 1 FROM email_optouts o WHERE o.email=g.email) "optedOut"
      FROM g ORDER BY last DESC, email`, [collabId]).catch(() => []);
}

export async function listInvites(collabId: string) {
  return q<any>(`SELECT * FROM collab_invites WHERE collab_id=$1 ORDER BY created_at DESC`, [collabId]).catch(() => []);
}

/** Signed token for the "no more invitations" link, so nobody can unsubscribe someone else. */
export function optoutToken(email: string) {
  return createHmac('sha256', process.env.AUTH_SECRET || 'villa-layla').update('optout:' + email.toLowerCase()).digest('hex').slice(0, 24);
}
export async function optOut(email: string, token: string) {
  const e = email.toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || token !== optoutToken(e)) return false;
  await q(`INSERT INTO email_optouts(email) VALUES($1) ON CONFLICT DO NOTHING`, [e]);
  return true;
}

/**
 * Sends the invitation to each address on its own (nobody sees the others): the message written in the dashboard,
 * the event (photo, date, time, place) and a button to the page. Skips addresses that opted out.
 * Returns how many were sent / failed / skipped.
 */
export async function sendInvites(collabId: string, emails: string[], v: { subject: string; message: string; lang: 'ar' | 'en' }, base: string, actor: string) {
  const { sendMail, mailEnabled } = await import('@/lib/mailer');
  if (!mailEnabled()) throw new BookingError('INVALID_INPUT', 'E-mail is not set up on the server yet (SMTP_* in .env)');
  const c = await getCollab(collabId);
  if (!c) throw new BookingError('NOT_FOUND');
  const list = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter((e) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(e)))].slice(0, 500);
  if (!list.length) throw new BookingError('INVALID_INPUT', 'Choose or write at least one e-mail');
  const out = new Set((await q<any>(`SELECT email FROM email_optouts WHERE email = ANY($1)`, [list])).map((r) => r.email));
  const names = new Map((await contactsFor(collabId)).map((x) => [x.email, x.name]));
  const ar = v.lang === 'ar';
  const t = (x: Loc) => (ar ? x.ar || x.en : x.en || x.ar) || '';
  const title = t(c.title);
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const page = `${base}/c/${c.slug}?lang=${v.lang}`;
  const when = c.event_date ? new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(c.event_date + 'T12:00:00Z')) : '';
  const hours = [c.start_time, c.end_time].filter(Boolean).join(' – ');
  const facts = [when, hours, t(c.place)].filter(Boolean).join(' · ');
  const photo = c.photos[0] ? (c.photos[0].startsWith('http') ? c.photos[0] : base + c.photos[0]) : null;
  const subject = (v.subject || '').trim().slice(0, 150) || (ar ? `دعوة: ${title} · فيلا ليلى & ${c.partner_name}` : `You're invited: ${title} · Villa Layla & ${c.partner_name}`);
  let sent = 0, failed = 0, skipped = 0;
  for (const email of list) {
    if (out.has(email)) { skipped++; continue; }
    const name = (names.get(email) || '').split(' ')[0];
    const msg = (v.message || '').trim().slice(0, 3000).replace(/\{name\}/g, name || (ar ? 'صديقنا' : 'friend'));
    const unsub = `${base}/api/collab/optout?e=${encodeURIComponent(email)}&t=${optoutToken(email)}`;
    const text = [msg, '', `${title} — Villa Layla & ${c.partner_name}`, facts, '', `${ar ? 'احجز تذكرتك' : 'Get your ticket'}: ${page}`, '', `${ar ? 'مش عايز دعوات تانية؟' : 'No more invitations?'} ${unsub}`].join('\n');
    const html = `<div dir="${ar ? 'rtl' : 'ltr'}" style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#2F2925;line-height:1.6">
${msg ? `<p style="white-space:pre-line;font-size:15px">${esc(msg)}</p>` : ''}
<div style="border:1px solid #eadfce;border-radius:16px;overflow:hidden;margin:18px 0">
${photo ? `<img src="${esc(photo)}" alt="" style="display:block;width:100%;max-height:300px;object-fit:cover">` : ''}
<div style="padding:16px 18px">
<p style="margin:0 0 4px;color:#9a7a55;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Villa Layla &amp; ${esc(c.partner_name)}</p>
<h2 style="margin:0 0 6px;font-size:21px">${esc(title)}</h2>
${facts ? `<p style="margin:0 0 14px;font-size:14px;color:#6b5d52">${esc(facts)}</p>` : ''}
<a href="${esc(page)}" style="display:inline-block;background:#4A3222;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-weight:bold">${ar ? 'احجز تذكرتك' : 'Get your ticket'}</a>
</div></div>
<p style="font-size:11px;color:#9a8d82">Villa Layla · 20 Safiya Zaghloul St, Cairo · <a href="${esc(unsub)}" style="color:#9a8d82">${ar ? 'مش عايز دعوات تانية' : 'No more invitations'}</a></p></div>`;
    try {
      await sendMail({ to: [email], subject, text, html });
      sent++;
      await q(`INSERT INTO collab_invites(collab_id,email,name,status,error,sent_by) VALUES($1,$2,$3,'sent',NULL,$4)
               ON CONFLICT (collab_id,email) DO UPDATE SET status='sent', error=NULL, sent_by=EXCLUDED.sent_by, created_at=now()`, [collabId, email, names.get(email) ?? null, actor]);
    } catch (e) {
      failed++;
      await q(`INSERT INTO collab_invites(collab_id,email,name,status,error,sent_by) VALUES($1,$2,$3,'failed',$4,$5)
               ON CONFLICT (collab_id,email) DO UPDATE SET status='failed', error=EXCLUDED.error, created_at=now()`, [collabId, email, names.get(email) ?? null, (e as Error).message.slice(0, 200), actor]);
    }
  }
  await audit(actor, 'collab.invite', 'collab', collabId, { sent, failed, skipped });
  return { sent, failed, skipped };
}
