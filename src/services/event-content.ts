import { q } from '@/lib/db';
import { BookingError } from './errors';
import { audit } from './audit';
import { EVENT_COLS, type EventRow } from './events';
import { parseDate } from './event-admin';
import { randomUUID } from 'node:crypto';
import { saveBuffer, removeFile, extFor, MAX_UPLOAD_BYTES } from '@/lib/uploads';

/** Event content edited from the dashboard or the Telegram admin bot: media, single fields, quick create. */

export const MAX_PHOTO = 25 * 1024 * 1024;
export const MAX_VIDEO = MAX_UPLOAD_BYTES;

/** Shorts / Reels / TikTok links are tall; everything else starts wide (changeable in the dashboard). */
export const guessOrientation = (url: string | null) => (url && /youtube\.com\/shorts\/|instagram\.com\/(reel|reels)\/|tiktok\.com\//i.test(url) ? 'portrait' : 'landscape');

export async function setMediaOrientation(mediaId: string, orientation: 'landscape' | 'portrait') {
  const r = await q<any>(`UPDATE event_media SET orientation=$2 WHERE id=$1 RETURNING event_id`, [mediaId, orientation === 'portrait' ? 'portrait' : 'landscape']);
  return r[0]?.event_id as string | undefined;
}

export async function addEventMedia(eventId: string, kind: 'meal' | 'video' | 'gallery' | 'hero', file: { bytes: Buffer; mime: string } | null, url: string | null, actor: string, caption?: string | null, orientation?: 'landscape' | 'portrait') {
  if (file) {
    const isVideo = /^video\//.test(file.mime);
    if (kind === 'hero' ? !(isVideo || /^image\//.test(file.mime)) : kind === 'video' ? !isVideo : !/^image\//.test(file.mime)) throw new BookingError('INVALID_INPUT', kind === 'video' ? 'Upload an MP4 / MOV video' : 'Upload a JPG, PNG or WebP photo');
    if (file.bytes.length > (isVideo ? MAX_VIDEO : MAX_PHOTO)) throw new BookingError('INVALID_INPUT', isVideo ? 'Video is too large' : 'Photo must be under 25 MB');
    // Videos go to the uploads folder, not the database.
    if (isVideo) {
      const rel = `events/${eventId}/${randomUUID()}.${extFor(file.mime)}`;
      await saveBuffer(rel, file.bytes);
      return addEventMediaFile(eventId, kind, rel, file.mime, file.bytes.length, orientation ?? 'landscape', actor);
    }
  } else if (!url || !/^https?:\/\//.test(url)) throw new BookingError('INVALID_INPUT', 'Add a file or a link');
  const shape = orientation ?? (file ? 'landscape' : guessOrientation(url));
  const r = (await q<any>(`INSERT INTO event_media(event_id,kind,bytes,mime,url,caption,orientation,sort_order)
    VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(sort_order),0)+1 FROM event_media WHERE event_id=$1 AND kind=$2)) RETURNING id`,
    [eventId, kind, file?.bytes ?? null, file?.mime ?? null, file ? null : url, caption ?? null, shape]))[0];
  await audit(actor, 'event.media_add', 'event', eventId, { kind, url: file ? null : url });
  return r.id as string;
}

/** A file already written to the uploads folder (large video from the chunked uploader, or the bot). */
export async function addEventMediaFile(eventId: string, kind: 'meal' | 'video' | 'gallery' | 'hero', rel: string, mime: string, size: number, orientation: 'landscape' | 'portrait', actor: string) {
  const r = (await q<any>(`INSERT INTO event_media(event_id,kind,file_path,mime,size_bytes,orientation,sort_order)
    VALUES($1,$2,$3,$4,$5,$6,(SELECT COALESCE(max(sort_order),0)+1 FROM event_media WHERE event_id=$1 AND kind=$2)) RETURNING id`,
    [eventId, kind, rel, mime, size, orientation === 'portrait' ? 'portrait' : 'landscape']))[0];
  await audit(actor, 'event.media_add', 'event', eventId, { kind, size });
  return r.id as string;
}

export async function deleteEventMedia(mediaId: string, actor: string) {
  const r = await q<any>(`DELETE FROM event_media WHERE id=$1 RETURNING event_id, kind, file_path`, [mediaId]);
  await removeFile(r[0]?.file_path);
  if (r[0]) await audit(actor, 'event.media_delete', 'event', r[0].event_id, { kind: r[0].kind });
  return r[0]?.event_id as string | undefined;
}

export async function setEventCover(eventId: string, file: { bytes: Buffer; mime: string }, actor: string) {
  if (!/^image\//.test(file.mime)) throw new BookingError('INVALID_INPUT', 'Upload a photo');
  if (file.bytes.length > MAX_PHOTO) throw new BookingError('INVALID_INPUT', 'Photo must be under 25 MB');
  await q(`UPDATE events SET image_bytes=$2, image_mime=$3, image='/api/media/event/' || id::text || '?v=' || extract(epoch from now())::bigint, updated_at=now() WHERE id=$1`, [eventId, file.bytes, file.mime]);
  await audit(actor, 'event.cover', 'event', eventId);
}

export type EventField = 'title_ar' | 'title_en' | 'summary_ar' | 'summary_en' | 'description_ar' | 'description_en' | 'includes'
  | 'price' | 'guest_price' | 'cost' | 'capacity' | 'date' | 'start_time' | 'end_time' | 'weekdays' | 'ends_on';

const WD: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, 'الأحد': 0, 'الاحد': 0, 'الاثنين': 1, 'الإثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'الجمعه': 5, 'السبت': 6 };

/** '19:00', '7 pm', '7:30 م' → 'HH:MM' */
export function parseTime(s: string): string | null {
  const t = s.trim().toLowerCase().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|ص|م|صباحا|مساء|مساءً|صباحًا)?$/.exec(t);
  if (!m) return null;
  let h = +m[1]; const mi = m[2] ? +m[2] : 0;
  const pm = m[3] && /pm|م|مساء/.test(m[3]); const am = m[3] && /am|ص|صباح/.test(m[3]);
  if (pm && h < 12) h += 12; if (am && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

const num = (s: string) => Number(s.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[, ]|egp|ج\.?م|جنيه/gi, ''));

/** One field from a typed value (Telegram). Returns the updated event. */
export async function updateEventField(id: string, field: EventField, value: string, actor: string): Promise<EventRow> {
  const v = value.trim();
  const ev = (await q<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE id=$1`, [id]))[0];
  if (!ev) throw new BookingError('NOT_FOUND');
  const loc = (col: 'title' | 'summary' | 'description', lang: 'ar' | 'en') => q(`UPDATE events SET ${col} = COALESCE(${col},'{}'::jsonb) || jsonb_build_object($2::text, $3::text), updated_at=now() WHERE id=$1`, [id, lang, v]);
  switch (field) {
    case 'title_ar': case 'title_en': if (v.length < 2) throw new BookingError('INVALID_INPUT', 'Title is too short'); await loc('title', field.slice(-2) as any); break;
    case 'summary_ar': case 'summary_en': await loc('summary', field.slice(-2) as any); break;
    case 'description_ar': case 'description_en': await loc('description', field.slice(-2) as any); break;
    case 'includes': {
      const items = v.split(/\n|،|,/).map((x) => x.trim()).filter(Boolean).map((x) => ({ en: x, ar: x }));
      await q(`UPDATE events SET includes=$2, updated_at=now() WHERE id=$1`, [id, JSON.stringify(items)]); break;
    }
    case 'price': case 'guest_price': case 'cost': {
      const empty = /^(-|لا|no|none|0?)$/i.test(v) && field === 'guest_price';
      const n = num(v);
      if (!empty && !(n >= 0)) throw new BookingError('INVALID_INPUT', 'Write a number, e.g. 350');
      const col = field === 'price' ? 'price_cents' : field === 'guest_price' ? 'guest_price_cents' : 'cost_per_attendee_cents';
      await q(`UPDATE events SET ${col}=$2, updated_at=now() WHERE id=$1`, [id, empty ? null : Math.round(n * 100)]); break;
    }
    case 'capacity': {
      const n = num(v);
      const cap = !v || n === 0 || /unlimited|مفتوح|بدون/.test(v) ? null : Math.round(n);
      if (cap !== null && !(cap > 0)) throw new BookingError('INVALID_INPUT', 'Write a number of places, or 0 for unlimited');
      await q(`UPDATE events SET capacity=$2, updated_at=now() WHERE id=$1`, [id, cap]); break;
    }
    case 'date': {
      const d = parseDate(v);
      if (!d) throw new BookingError('INVALID_INPUT', 'Write the date like 2026-11-05 or 5/11');
      await q(`UPDATE events SET recurrence='once', once_date=$2, updated_at=now() WHERE id=$1`, [id, d]); break;
    }
    case 'ends_on': {
      const d = /^(-|لا|no|none)$/i.test(v) ? null : parseDate(v);
      if (d === null && !/^(-|لا|no|none)$/i.test(v)) throw new BookingError('INVALID_INPUT', 'Write a date, or - for no end');
      await q(`UPDATE events SET ends_on=$2, updated_at=now() WHERE id=$1`, [id, d]); break;
    }
    case 'start_time': case 'end_time': {
      const t = parseTime(v);
      if (!t) throw new BookingError('INVALID_INPUT', 'Write the time like 19:00 or 7 pm');
      await q(`UPDATE events SET ${field}=$2, updated_at=now() WHERE id=$1`, [id, t]); break;
    }
    case 'weekdays': {
      if (/^(daily|يومي|يوميا|كل يوم)$/i.test(v)) { await q(`UPDATE events SET recurrence='daily', weekdays='{}', updated_at=now() WHERE id=$1`, [id]); break; }
      const days = [...new Set(v.split(/[\s,،و]+/).map((x) => WD[x.toLowerCase().slice(0, x.match(/^[a-z]/i) ? 3 : undefined)] ?? WD[x]).filter((x) => x !== undefined))];
      if (!days.length) throw new BookingError('INVALID_INPUT', 'Write days like: الجمعة السبت, or Fri Sat, or يومي');
      await q(`UPDATE events SET recurrence='weekly', weekdays=$2, updated_at=now() WHERE id=$1`, [id, days]); break;
    }
  }
  await audit(actor, 'event.update', 'event', id, { field, value: v.slice(0, 200) });
  return (await q<EventRow>(`SELECT ${EVENT_COLS} FROM events WHERE id=$1`, [id]))[0];
}

export async function setEventActive(id: string, active: boolean, actor: string) {
  await q(`UPDATE events SET active=$2, updated_at=now() WHERE id=$1`, [id, active]);
  await audit(actor, active ? 'event.publish' : 'event.unpublish', 'event', id);
}

export async function togglePayMethod(id: string, method: string, actor: string) {
  if (!['paymob', 'instapay', 'vodafone_cash', 'cash'].includes(method)) throw new BookingError('INVALID_INPUT');
  await q(`UPDATE events SET pay_methods = CASE WHEN $2::text = ANY(pay_methods) THEN array_remove(pay_methods, $2::text) ELSE array_append(pay_methods, $2::text) END, updated_at=now() WHERE id=$1`, [id, method]);
  await audit(actor, 'event.pay_methods', 'event', id, { method });
}

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Event made from the admin bot: title, date, times, price, capacity, description. Published right away. */
export async function createEventQuick(v: { title: string; date: string; start: string; end: string; priceCents: number; capacity: number | null; description: string }, actor: string): Promise<string> {
  let slug = slugify(v.title) || 'event';
  if ((await q('SELECT 1 FROM events WHERE slug=$1', [slug])).length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const loc = (x: string) => JSON.stringify({ en: x, ar: x });
  const id = (await q<any>(`INSERT INTO events(slug,kind,title,summary,description,includes,price_cents,cost_per_attendee_cents,capacity,recurrence,weekdays,once_date,start_time,end_time,pay_methods,active,sort_order)
    VALUES($1,'event',$2,$3,$4,'[]',$5,0,$6,'once','{}',$7,$8,$9,'{paymob,instapay,cash}',true,(SELECT COALESCE(max(sort_order),0)+10 FROM events)) RETURNING id`,
    [slug, loc(v.title), loc(v.description.split(/[.\n]/)[0].slice(0, 140)), loc(v.description), v.priceCents, v.capacity, v.date, v.start, v.end]))[0].id;
  await audit(actor, 'event.create', 'event', id, { title: v.title, via: 'telegram' });
  return id;
}
