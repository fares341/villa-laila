import { q } from '@/lib/db';
import { audit } from './audit';
import { BookingError } from './errors';

/**
 * Weekly dinner menu: one meal per weekday (0 = Sunday … 6 = Saturday) — one photo of the plate, its name and the
 * dishes on it. An event on a Monday shows Monday's meal on its booking page (dinner add-on); the kitchen sees the
 * meal on the booking (Telegram / dashboard).
 */
export type Loc = { ar?: string; en?: string };
export type DayMenu = { weekday: number; title: Loc; dishes: Loc[]; description: Loc; img: string | null };

export const WEEKDAYS: { d: number; en: string; ar: string }[] = [
  { d: 6, en: 'Saturday', ar: 'السبت' }, { d: 0, en: 'Sunday', ar: 'الأحد' }, { d: 1, en: 'Monday', ar: 'الاثنين' },
  { d: 2, en: 'Tuesday', ar: 'الثلاثاء' }, { d: 3, en: 'Wednesday', ar: 'الأربعاء' }, { d: 4, en: 'Thursday', ar: 'الخميس' }, { d: 5, en: 'Friday', ar: 'الجمعة' },
];

/** Weekday of a YYYY-MM-DD date (calendar day, no time zone shift). */
export const weekdayOf = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();

const MAX_PHOTO = 8 * 1024 * 1024;
const clean = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);
const lines = (s: unknown) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 12);

const toDay = (r: any): DayMenu => ({
  weekday: r.weekday, title: r.title ?? {}, dishes: Array.isArray(r.dishes) ? r.dishes : [], description: r.description ?? {},
  img: r.has_photo ? `/api/media/menu/${r.weekday}?v=${new Date(r.updated_at).getTime()}` : r.image_url ?? null,
});

/** The meal of each weekday (null = nothing set for that day). */
export async function weeklyMenu(): Promise<Record<number, DayMenu | null>> {
  const rows = await q<any>(`SELECT weekday, title, dishes, description, image_url, (photo IS NOT NULL) has_photo, updated_at FROM weekly_menu`).catch(() => []);
  const out: Record<number, DayMenu | null> = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  for (const r of rows) out[r.weekday] = toDay(r);
  return out;
}

export async function menuForDate(date: string): Promise<DayMenu | null> {
  return (await weeklyMenu())[weekdayOf(date)] ?? null;
}

/** One line for the kitchen: "طاجن لحمة بالبصل: أرز بالشعرية، شوربة، سلطة". */
export function menuLine(m: DayMenu | null, lang: 'ar' | 'en' = 'ar'): string | null {
  if (!m) return null;
  const t = (x: Loc) => (lang === 'ar' ? x.ar || x.en : x.en || x.ar) || '';
  const title = t(m.title);
  const dishes = m.dishes.map(t).filter(Boolean).join(lang === 'ar' ? '، ' : ', ');
  return [title, dishes].filter(Boolean).join(': ') || null;
}

function checkPhoto(photo: { bytes: Buffer; mime: string } | null | undefined) {
  if (!photo || !photo.bytes.length) return null;
  if (!/^image\//.test(photo.mime)) throw new BookingError('INVALID_INPUT', 'Upload a JPG, PNG or WebP photo');
  if (photo.bytes.length > MAX_PHOTO) throw new BookingError('INVALID_INPUT', 'Photo must be under 8 MB');
  return photo;
}

/** Save the meal of one weekday. Dishes are one per line (Arabic and English lines are paired in order). */
export async function saveDay(weekday: number, input: { titleAr: string; titleEn: string; dishesAr: string; dishesEn: string; descAr?: string; descEn?: string; photo?: { bytes: Buffer; mime: string } | null; imageUrl?: string | null }, actor: string) {
  if (!(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) throw new BookingError('INVALID_INPUT', 'day');
  const title = { ar: clean(input.titleAr, 80), en: clean(input.titleEn, 80) };
  const ar = lines(input.dishesAr), en = lines(input.dishesEn);
  const dishes = Array.from({ length: Math.max(ar.length, en.length) }, (_, i) => ({ ar: (ar[i] ?? '').slice(0, 80), en: (en[i] ?? '').slice(0, 80) }));
  if (!title.ar && !title.en && !dishes.length) throw new BookingError('INVALID_INPUT', 'Write the meal name or its dishes');
  const photo = checkPhoto(input.photo);
  const url = input.imageUrl && /^(https?:\/\/|\/)/.test(input.imageUrl.trim()) ? input.imageUrl.trim().slice(0, 400) : null;
  await q(`INSERT INTO weekly_menu(weekday, title, dishes, description, photo, photo_mime, image_url, updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,now())
           ON CONFLICT (weekday) DO UPDATE SET title=EXCLUDED.title, dishes=EXCLUDED.dishes, description=EXCLUDED.description,
             photo=COALESCE(EXCLUDED.photo, CASE WHEN EXCLUDED.image_url IS NOT NULL THEN NULL ELSE weekly_menu.photo END),
             photo_mime=COALESCE(EXCLUDED.photo_mime, CASE WHEN EXCLUDED.image_url IS NOT NULL THEN NULL ELSE weekly_menu.photo_mime END),
             image_url=COALESCE(EXCLUDED.image_url, CASE WHEN EXCLUDED.photo IS NOT NULL THEN NULL ELSE weekly_menu.image_url END),
             updated_at=now()`,
    [weekday, JSON.stringify(title), JSON.stringify(dishes), JSON.stringify({ ar: clean(input.descAr, 300), en: clean(input.descEn, 300) }), photo?.bytes ?? null, photo?.mime ?? null, url]);
  await audit(actor, 'menu.save_day', 'weekly_menu', null, { weekday, title });
}

export async function clearDay(weekday: number, actor: string) {
  await q(`DELETE FROM weekly_menu WHERE weekday=$1`, [weekday]);
  await audit(actor, 'menu.clear_day', 'weekly_menu', null, { weekday });
}

/** Copy one day's meal to other days (replaces theirs). */
export async function copyDay(from: number, to: number[], actor: string) {
  const days = to.filter((d) => Number.isInteger(d) && d !== from && d >= 0 && d <= 6);
  for (const d of days) {
    await q(`INSERT INTO weekly_menu(weekday, title, dishes, description, photo, photo_mime, image_url, updated_at)
             SELECT $2, title, dishes, description, photo, photo_mime, image_url, now() FROM weekly_menu WHERE weekday=$1
             ON CONFLICT (weekday) DO UPDATE SET title=EXCLUDED.title, dishes=EXCLUDED.dishes, description=EXCLUDED.description,
               photo=EXCLUDED.photo, photo_mime=EXCLUDED.photo_mime, image_url=EXCLUDED.image_url, updated_at=now()`, [from, d]);
  }
  await audit(actor, 'menu.copy_day', 'weekly_menu', null, { from, to: days });
}

/* ───────── Import (JSON) ───────── */

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0, 'الأحد': 0, 'الاحد': 0, monday: 1, mon: 1, 'الاثنين': 1, 'الإثنين': 1, 'الاتنين': 1,
  tuesday: 2, tue: 2, 'الثلاثاء': 2, 'التلات': 2, wednesday: 3, wed: 3, 'الأربعاء': 3, 'الاربعاء': 3,
  thursday: 4, thu: 4, 'الخميس': 4, friday: 5, fri: 5, 'الجمعة': 5, saturday: 6, sat: 6, 'السبت': 6,
};

export type MenuImportDay = { day: string | number; title_ar?: string; title_en?: string; dishes?: { ar?: string; en?: string }[]; desc_ar?: string; desc_en?: string; image?: string };

/**
 * Set the meals of the days in the file (other days are left as they are). `day` is a weekday name (English or
 * Arabic), 0–6 (0 = Sunday), or a date YYYY-MM-DD (its weekday). `image` is a link (downloaded and stored) or a
 * path in /public.
 */
export async function importMenu(days: MenuImportDay[], actor: string): Promise<{ days: number; imageErrors: string[] }> {
  if (!Array.isArray(days) || !days.length) throw new BookingError('INVALID_INPUT', 'The file has no days');
  const imageErrors: string[] = [];
  let n = 0;
  for (const d of days) {
    const key = String(d.day ?? '').trim().toLowerCase();
    const wd = /^\d{4}-\d{2}-\d{2}$/.test(key) ? weekdayOf(key) : /^[0-6]$/.test(key) ? Number(key) : DAY_NAMES[key];
    if (wd === undefined) throw new BookingError('INVALID_INPUT', `Unknown day "${d.day}"`);
    let photo: { bytes: Buffer; mime: string } | null = null;
    let imageUrl: string | null = null;
    const img = String(d.image ?? '').trim();
    if (/^https?:\/\//.test(img)) {
      try {
        const r = await fetch(img, { signal: AbortSignal.timeout(20000) });
        const mime = (r.headers.get('content-type') || '').split(';')[0];
        const bytes = Buffer.from(await r.arrayBuffer());
        if (!r.ok || !/^image\//.test(mime) || bytes.length > MAX_PHOTO) throw new Error(`${r.status} ${mime}`);
        photo = { bytes, mime };
      } catch (e) { imageErrors.push(`${d.day}: ${(e as Error).message}`); imageUrl = img; }
    } else if (img.startsWith('/')) imageUrl = img;
    await saveDay(wd, {
      titleAr: d.title_ar ?? '', titleEn: d.title_en ?? '',
      dishesAr: (d.dishes ?? []).map((x) => x.ar ?? '').join('\n'), dishesEn: (d.dishes ?? []).map((x) => x.en ?? '').join('\n'),
      descAr: d.desc_ar, descEn: d.desc_en, photo, imageUrl,
    }, actor);
    n++;
  }
  return { days: n, imageErrors };
}
