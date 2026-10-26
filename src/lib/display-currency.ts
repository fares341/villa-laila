/**
 * The currency the public website shows prices in, by where the visitor is:
 * Egypt → EGP, Europe → EUR, everywhere else → USD.
 * Prices are stored and charged in EGP (InstaPay / Paymob / at the villa); other currencies are a converted view.
 *
 * Where the visitor is comes from the browser's time zone (set once in a cookie by <CurrencySync/>); before that,
 * from the region in Accept-Language. No IP lookup and nothing stored about the visitor.
 */
export type DisplayCurrency = 'EGP' | 'EUR' | 'USD';
export const DISPLAY_CURRENCIES: DisplayCurrency[] = ['EGP', 'EUR', 'USD'];
export const CUR_COOKIE = 'vl_cur';
/** EGP for one USD / one EUR. */
export type Fx = { USD: number; EUR: number };
export const FX_FALLBACK: Fx = { USD: 50, EUR: 54 };

export const isDisplayCurrency = (c: unknown): c is DisplayCurrency => c === 'EGP' || c === 'EUR' || c === 'USD';

/** European countries (ISO 3166-1), euro area or not: the owner wants every European visitor to see euros. */
const EUROPE = new Set(('AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK').split(' '));
/** Time zones outside Europe/* that are in Europe. */
const EUROPE_TZ = new Set(['Atlantic/Canary', 'Atlantic/Madeira', 'Atlantic/Azores', 'Atlantic/Faroe', 'Atlantic/Reykjavik', 'Arctic/Longyearbyen']);
/** Europe/* zones that are not in Europe for this purpose (Turkey, the Caucasus side of Russia is still Europe). */
const NOT_EUROPE_TZ = new Set(['Europe/Istanbul']);

export function currencyForCountry(country: string | null | undefined): DisplayCurrency | null {
  const c = (country ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  if (c === 'EG') return 'EGP';
  return EUROPE.has(c) ? 'EUR' : 'USD';
}

export function currencyForTimeZone(tz: string | null | undefined): DisplayCurrency | null {
  if (!tz) return null;
  if (tz === 'Africa/Cairo' || tz === 'Egypt') return 'EGP';
  if (NOT_EUROPE_TZ.has(tz)) return 'USD';
  if (tz.startsWith('Europe/') || EUROPE_TZ.has(tz)) return 'EUR';
  return 'USD';
}

/** First guess on the server from Accept-Language (e.g. ar-EG → EGP, de-DE → EUR, en-US → USD). */
export function currencyForAcceptLanguage(header: string | null | undefined): DisplayCurrency | null {
  for (const part of (header ?? '').split(',')) {
    const region = part.trim().split(';')[0].split('-')[1];
    const c = currencyForCountry(region);
    if (c) return c;
  }
  return null;
}

/** Converts an amount in cents between EGP, USD and EUR. */
export function convertCents(cents: number, from: string, to: DisplayCurrency, fx: Fx): number {
  const f = (from || 'EGP').toUpperCase();
  if (f === to) return cents;
  const egp = f === 'EGP' ? cents : f === 'USD' ? cents * fx.USD : f === 'EUR' ? cents * fx.EUR : cents;
  return to === 'EGP' ? egp : egp / fx[to];
}

/**
 * A price for the website: EGP whole pounds, EUR/USD rounded to whole units (they are an estimate of the EGP price).
 * Arabic pages write EGP as ج.م.
 */
export function formatPrice(cents: number, cur: DisplayCurrency | string, lang = 'en'): string {
  const c = (cur || 'EGP').toUpperCase();
  const v = Math.round(cents / 100);
  if (lang === 'ar' && c === 'EGP') return `${v.toLocaleString('ar-EG-u-nu-latn')} ج.م`;
  try {
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : lang === 'en' ? 'en-US' : lang, { style: 'currency', currency: c, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(v);
  } catch { return `${c} ${v}`; }
}

/** Shows `cents` (stored in `from`, usually EGP) in the visitor's currency. */
export function showPrice(cents: number, from: string, view: { cur: DisplayCurrency; fx: Fx }, lang = 'en'): string {
  return formatPrice(convertCents(cents, from, view.cur, view.fx), view.cur, lang);
}
