import en from './site/en.json';
import es from './site/es.json';
import fr from './site/fr.json';
import ar from './site/ar.json';
import type { Lang } from './bot';

export const SITE_LANGS: Lang[] = ['en', 'es', 'fr', 'ar'];
const DICT = { en, es, fr, ar } as const;
export type SiteDict = typeof en;
export const dict = (lang: string): SiteDict => (DICT as any)[lang] ?? en;
export const isSiteLang = (l: string): l is Lang => (SITE_LANGS as string[]).includes(l);
export const dirOf = (lang: string) => (lang === 'ar' ? 'rtl' : 'ltr');
export const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((a, [k, v]) => a.split(`{${k}}`).join(String(v)), s);
