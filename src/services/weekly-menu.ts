import { q } from '@/lib/db';
import { audit } from './audit';
import { BookingError } from './errors';

/**
 * Weekly dinner menu: one meal per weekday (0 = Sunday … 6 = Saturday) — one photo of the plate, its name and the
 * dishes on it. An event on a Monday shows Monday's meal on its booking page (dinner add-on); the kitchen sees the
 * meal on the booking (Telegram / dashboard).
 */
export type Loc = { ar?: string; en?: string };
export type Meal = 'dinner' | 'breakfast';
export const mealOf = (x: unknown): Meal => (x === 'breakfast' ? 'breakfast' : 'dinner');
export type DayMenu = { weekday: number; title: Loc; dishes: Loc[]; description: Loc; img: string | null };

export const WEEKDAYS: { d: number; en: string; ar: string }[] = [
  { d: 6, en: 'Saturday', ar: 'السبت' }, { d: 0, en: 'Sunday', ar: 'الأحد' }, { d: 1, en: 'Monday', ar: 'الاثنين' },
  { d: 2, en: 'Tuesday', ar: 'الثلاثاء' }, { d: 3, en: 'Wednesday', ar: 'الأربعاء' }, { d: 4, en: 'Thursday', ar: 'الخميس' }, { d: 5, en: 'Friday', ar: 'الجمعة' },
];

/**
 * Breakfast is not a weekly menu: the villa serves the same two breakfasts every day (owner, Nov 2026).
 * They are kept in the breakfast rows 0 and 1 (other breakfast rows from the old weekly version are not shown).
 */
export const BREAKFAST_SLOTS: { d: number; en: string; ar: string }[] = [
  { d: 0, en: 'Breakfast 1', ar: 'الفطار الأول' }, { d: 1, en: 'Breakfast 2', ar: 'الفطار التاني' },
];
export async function breakfastPair(): Promise<DayMenu[]> {
  const m = await weeklyMenu('breakfast');
  const ok = (x: DayMenu | null | undefined): x is DayMenu => !!x && !!(x.title.ar || x.title.en || x.img);
  const pair = BREAKFAST_SLOTS.map((s) => m[s.d]).filter(ok);
  // Breakfasts saved per weekday in the old version: fill up to two from the other days (different meals only),
  // so every breakfast event shows both breakfasts whatever day they were saved on.
  const key = (x: DayMenu) => (x.title.en || x.title.ar || x.img || '').trim().toLowerCase();
  for (const d of [2, 3, 4, 5, 6]) {
    if (pair.length >= 2) break;
    const x = m[d];
    if (ok(x) && !pair.some((y) => key(y) === key(x))) pair.push(x);
  }
  return pair.slice(0, 2);
}

/** Weekday of a YYYY-MM-DD date (calendar day, no time zone shift). */
export const weekdayOf = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();

const MAX_PHOTO = 8 * 1024 * 1024;
const clean = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);
/** The meal's description: up to 6 short points, one per line. */
const points = (s: unknown) => String(s ?? '').split(/\r?\n/).map((x) => x.trim().replace(/^[-•*·]\s*/, '').slice(0, 160)).filter(Boolean).slice(0, 6).join('\n');
const lines = (s: unknown) => String(s ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(0, 12);

const toDay = (r: any): DayMenu => {
  const v = new Date(r.updated_at).getTime();
  let img = r.has_photo ? `/api/media/menu/${r.weekday}?meal=${r.meal ?? 'dinner'}&v=${v}` : r.image_url ?? null;
  if (img && !img.includes('?')) {
    img = `${img}?v=${v}`;
  }
  return {
    weekday: r.weekday,
    title: r.title ?? {},
    dishes: Array.isArray(r.dishes) ? r.dishes : [],
    description: r.description ?? {},
    img,
  };
};

/** The meal of each weekday (null = nothing set for that day). */
export async function weeklyMenu(meal: Meal = 'dinner'): Promise<Record<number, DayMenu | null>> {
  const rows = await q<any>(`SELECT meal, weekday, title, dishes, description, image_url, (photo IS NOT NULL) has_photo, updated_at FROM weekly_menu WHERE meal=$1`, [meal]).catch(() => []);
  const out: Record<number, DayMenu | null> = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
  for (const r of rows) out[r.weekday] = toDay(r);
  return out;
}

export async function menuForDate(date: string, meal: Meal = 'dinner'): Promise<DayMenu | null> {
  return (await weeklyMenu(meal))[weekdayOf(date)] ?? null;
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
export async function saveDay(weekday: number, input: { titleAr: string; titleEn: string; dishesAr: string; dishesEn: string; descAr?: string; descEn?: string; photo?: { bytes: Buffer; mime: string } | null; imageUrl?: string | null }, actor: string, meal: Meal = 'dinner') {
  if (!(Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) throw new BookingError('INVALID_INPUT', 'day');
  const existing = (await q<any>(`SELECT title, dishes, description FROM weekly_menu WHERE meal=$1 AND weekday=$2`, [meal, weekday]))[0];
  const titleAr = clean(input.titleAr, 80) || (existing?.title?.ar ?? '');
  const titleEn = clean(input.titleEn, 80) || (existing?.title?.en ?? '');
  const title = { ar: titleAr, en: titleEn };
  const ar = lines(input.dishesAr), en = lines(input.dishesEn);
  let dishes = Array.from({ length: Math.max(ar.length, en.length) }, (_, i) => ({ ar: (ar[i] ?? '').slice(0, 80), en: (en[i] ?? '').slice(0, 80) }));
  if (!dishes.length && Array.isArray(existing?.dishes)) dishes = existing.dishes;
  const descAr = points(input.descAr) || (existing?.description?.ar ?? '');
  const descEn = points(input.descEn) || (existing?.description?.en ?? '');
  if (!title.ar && !title.en && !dishes.length) throw new BookingError('INVALID_INPUT', 'Write the meal name or its dishes');
  const photo = checkPhoto(input.photo);
  const url = input.imageUrl && /^(https?:\/\/|\/)/.test(input.imageUrl.trim()) ? input.imageUrl.trim().slice(0, 400) : null;
  await q(`INSERT INTO weekly_menu(weekday, title, dishes, description, photo, photo_mime, image_url, updated_at, meal)
           VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8)
           ON CONFLICT (meal, weekday) DO UPDATE SET title=EXCLUDED.title, dishes=EXCLUDED.dishes, description=EXCLUDED.description,
             photo=COALESCE(EXCLUDED.photo, CASE WHEN EXCLUDED.image_url IS NOT NULL THEN NULL ELSE weekly_menu.photo END),
             photo_mime=COALESCE(EXCLUDED.photo_mime, CASE WHEN EXCLUDED.image_url IS NOT NULL THEN NULL ELSE weekly_menu.photo_mime END),
             image_url=COALESCE(EXCLUDED.image_url, CASE WHEN EXCLUDED.photo IS NOT NULL THEN NULL ELSE weekly_menu.image_url END),
             updated_at=now()`,
    [weekday, JSON.stringify(title), JSON.stringify(dishes), JSON.stringify({ ar: descAr, en: descEn }), photo?.bytes ?? null, photo?.mime ?? null, url, meal]);
  await audit(actor, 'menu.save_day', 'weekly_menu', null, { weekday, title, meal });
}

export async function clearDay(weekday: number, actor: string, meal: Meal = 'dinner') {
  await q(`DELETE FROM weekly_menu WHERE weekday=$1 AND meal=$2`, [weekday, meal]);
  await audit(actor, 'menu.clear_day', 'weekly_menu', null, { weekday, meal });
}

/** Copy one day's meal to other days (replaces theirs). */
export async function copyDay(from: number, to: number[], actor: string, meal: Meal = 'dinner') {
  const days = to.filter((d) => Number.isInteger(d) && d !== from && d >= 0 && d <= 6);
  for (const d of days) {
    await q(`INSERT INTO weekly_menu(weekday, title, dishes, description, photo, photo_mime, image_url, updated_at, meal)
             SELECT $2, title, dishes, description, photo, photo_mime, image_url, now(), meal FROM weekly_menu WHERE weekday=$1 AND meal=$3
             ON CONFLICT (meal, weekday) DO UPDATE SET title=EXCLUDED.title, dishes=EXCLUDED.dishes, description=EXCLUDED.description,
               photo=EXCLUDED.photo, photo_mime=EXCLUDED.photo_mime, image_url=EXCLUDED.image_url, updated_at=now()`, [from, d, meal]);
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
export async function importMenu(days: MenuImportDay[], actor: string, meal: Meal = 'dinner'): Promise<{ days: number; imageErrors: string[] }> {
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
    }, actor, meal);
    n++;
  }
  return { days: n, imageErrors };
}
