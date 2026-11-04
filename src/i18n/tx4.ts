/**
 * Short interface words (menu, bottom bar, search box, footer headings) in the four site languages, so the French and
 * Spanish pages get correct words for them instead of the automatic translation of the rest of the page.
 */
export const tx4 = (lang: string, en: string, ar: string, fr: string, es: string) => (lang === 'ar' ? ar : lang === 'fr' ? fr : lang === 'es' ? es : en);
