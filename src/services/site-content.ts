import { q } from '@/lib/db';
import { audit } from './audit';
import { BookingError } from './errors';

/**
 * Website content edited from the dashboard (Website): day trips on the home page, the guest films
 * (one wide film + portrait reels) and the photos of every room type. Uploaded files live in the uploads
 * folder under site/ and are served from /api/media/site/<file>.
 */
export type Loc = { ar?: string; en?: string };
export type SiteTour = {
  id: string; sort_order: number; active: boolean; name: Loc; duration: Loc; tag: Loc;
  included: { ar?: string[]; en?: string[] }; excluded: Loc; image: string | null;
};
export type SiteFilm = { id: string; kind: 'main' | 'reel'; sort_order: number; active: boolean; video: string; poster: string | null };

/** A media address the website may show: a file of the site (/photos, /videos, /api/media/...) or an https link. */
export const okMedia = (u: unknown): string | null => {
  const s = String(u ?? '').trim();
  return /^(https:\/\/[^\s"'<>]+|\/(photos|videos|assets|api\/media)\/[^\s"'<>]+)$/.test(s) ? s.slice(0, 600) : null;
};
const clean = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);
const lines = (s: unknown) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 160));

/* ───────── Day trips ───────── */

export async function listTours(all = false): Promise<SiteTour[]> {
  return q<SiteTour>(`SELECT id, sort_order, active, name, duration, tag, included, excluded, image FROM site_tours ${all ? '' : 'WHERE active'} ORDER BY sort_order, name->>'en'`).catch(() => []);
}

export async function saveTour(id: string | null, f: Record<string, unknown>, actor: string): Promise<string> {
  const name = { ar: clean(f.nameAr, 120), en: clean(f.nameEn, 120) };
  if (!name.ar && !name.en) throw new BookingError('INVALID_INPUT', 'Write the trip name');
  const row = [
    JSON.stringify(name),
    JSON.stringify({ ar: clean(f.durAr, 80), en: clean(f.durEn, 80) }),
    JSON.stringify({ ar: clean(f.tagAr, 40), en: clean(f.tagEn, 40) }),
    JSON.stringify({ ar: lines(f.inclAr), en: lines(f.inclEn) }),
    JSON.stringify({ ar: clean(f.exclAr, 160), en: clean(f.exclEn, 160) }),
  ];
  const image = f.image === undefined ? undefined : okMedia(f.image);
  if (id) {
    const r = await q<{ id: string }>(`UPDATE site_tours SET name=$2, duration=$3, tag=$4, included=$5, excluded=$6, image=COALESCE($7, image), updated_at=now() WHERE id=$1 RETURNING id`, [id, ...row, image ?? null]);
    if (!r.length) throw new BookingError('NOT_FOUND', 'trip');
  } else {
    const r = await q<{ id: string }>(`INSERT INTO site_tours(sort_order, name, duration, tag, included, excluded, image)
      VALUES((SELECT COALESCE(max(sort_order), 0) + 1 FROM site_tours), $1,$2,$3,$4,$5,$6) RETURNING id`, [...row, image ?? null]);
    id = r[0].id;
  }
  await audit(actor, 'site.tour_save', 'site_tours', id, { name });
  return id!;
}

export async function setTourImage(id: string, image: string, actor: string) {
  const u = okMedia(image);
  if (!u) throw new BookingError('INVALID_INPUT', 'photo');
  await q(`UPDATE site_tours SET image=$2, updated_at=now() WHERE id=$1`, [id, u]);
  await audit(actor, 'site.tour_photo', 'site_tours', id, {});
}

/* ───────── Guest films ───────── */

export async function listFilms(all = false): Promise<SiteFilm[]> {
  return q<SiteFilm>(`SELECT id, kind, sort_order, active, video, poster FROM site_films ${all ? '' : 'WHERE active'} ORDER BY (kind='main') DESC, sort_order`).catch(() => []);
}

export async function addFilm(kind: 'main' | 'reel', video: string, poster: string | null, actor: string): Promise<string> {
  const v = okMedia(video);
  if (!v) throw new BookingError('INVALID_INPUT', 'video');
  // There is one wide film: a new one replaces it (the old one is kept, hidden, so it can be brought back).
  if (kind === 'main') await q(`UPDATE site_films SET active=false, updated_at=now() WHERE kind='main' AND active`);
  const r = await q<{ id: string }>(`INSERT INTO site_films(kind, sort_order, video, poster)
    VALUES($1, (SELECT COALESCE(max(sort_order), 0) + 1 FROM site_films), $2, $3) RETURNING id`, [kind, v, okMedia(poster)]);
  await audit(actor, 'site.film_add', 'site_films', r[0].id, { kind });
  return r[0].id;
}

export async function setFilmPoster(id: string, poster: string, actor: string) {
  const u = okMedia(poster);
  if (!u) throw new BookingError('INVALID_INPUT', 'photo');
  await q(`UPDATE site_films SET poster=$2, updated_at=now() WHERE id=$1`, [id, u]);
  await audit(actor, 'site.film_poster', 'site_films', id, {});
}

/* ───────── Shared: show/hide, order, delete ───────── */

type Table = 'site_tours' | 'site_films';
const TABLES: Record<string, Table> = { tour: 'site_tours', film: 'site_films' };
export const tableOf = (what: string): Table => {
  const t = TABLES[what];
  if (!t) throw new BookingError('INVALID_INPUT', 'what');
  return t;
};

export async function setActive(what: string, id: string, active: boolean, actor: string) {
  const t = tableOf(what);
  if (t === 'site_films' && active) {
    const k = (await q<{ kind: string }>(`SELECT kind FROM site_films WHERE id=$1`, [id]))[0]?.kind;
    if (k === 'main') await q(`UPDATE site_films SET active=false WHERE kind='main' AND id<>$1`, [id]);
  }
  await q(`UPDATE ${t} SET active=$2, updated_at=now() WHERE id=$1`, [id, active]);
  await audit(actor, active ? 'site.show' : 'site.hide', t, id, {});
}

export async function move(what: string, id: string, dir: -1 | 1, actor: string) {
  const t = tableOf(what);
  const scope = t === 'site_films' ? `WHERE kind = (SELECT kind FROM site_films WHERE id=$1)` : '';
  const rows = await q<{ id: string }>(`SELECT id FROM ${t} ${scope} ORDER BY sort_order, id`, t === 'site_films' ? [id] : []);
  const i = rows.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (let k = 0; k < rows.length; k++) await q(`UPDATE ${t} SET sort_order=$2 WHERE id=$1`, [rows[k].id, k + 1]);
  await audit(actor, 'site.move', t, id, { dir });
}

export async function remove(what: string, id: string, actor: string) {
  const t = tableOf(what);
  await q(`DELETE FROM ${t} WHERE id=$1`, [id]);
  await audit(actor, 'site.delete', t, id, {});
}

/* ───────── Room photos (room_types.photos; the first one is the cover) ───────── */

export async function roomPhotos(): Promise<{ id: string; code: string; name: Loc; active: boolean; photos: string[] }[]> {
  const rows = await q<any>(`SELECT id, code, name, active, photos FROM room_types ORDER BY active DESC, sort_order, code`);
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name ?? {}, active: r.active, photos: Array.isArray(r.photos) ? r.photos : [] }));
}

/** Photos of each active room type by code, for the home page room cards. */
export async function roomPhotosByCode(): Promise<Record<string, string[]>> {
  const rows = await q<any>(`SELECT code, photos FROM room_types WHERE active`).catch(() => []);
  return Object.fromEntries(rows.filter((r) => Array.isArray(r.photos) && r.photos.length).map((r) => [r.code, r.photos]));
}

export async function editRoomPhotos(roomTypeId: string, op: { add?: string[]; remove?: number; move?: { from: number; dir: -1 | 1 }; cover?: number }, actor: string) {
  const r = (await q<any>(`SELECT photos FROM room_types WHERE id=$1`, [roomTypeId]))[0];
  if (!r) throw new BookingError('NOT_FOUND', 'room');
  const list: string[] = Array.isArray(r.photos) ? [...r.photos] : [];
  if (op.add) for (const u of op.add) { const ok = okMedia(u); if (ok && !list.includes(ok)) list.push(ok); }
  if (op.remove != null && list[op.remove] !== undefined) list.splice(op.remove, 1);
  if (op.move) {
    const { from, dir } = op.move; const to = from + dir;
    if (list[from] !== undefined && to >= 0 && to < list.length) [list[from], list[to]] = [list[to], list[from]];
  }
  if (op.cover != null && list[op.cover] !== undefined) list.unshift(...list.splice(op.cover, 1));
  if (list.length > 30) throw new BookingError('INVALID_INPUT', 'Up to 30 photos per room');
  await q(`UPDATE room_types SET photos=$2 WHERE id=$1`, [roomTypeId, JSON.stringify(list)]);
  await audit(actor, 'site.room_photos', 'room_types', roomTypeId, { count: list.length });
  return list;
}
