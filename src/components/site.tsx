import Link from 'next/link';
import { dict, SITE_LANGS, fill } from '@/i18n/site';
import { type Lang } from '@/i18n/bot';
import { photo } from '@/content/property';
import { todayLocal, addDays } from '@/lib/dates';
import { hostelInfo } from '@/services/settings';
import { sized } from '@/content/rooms-catalog';
import { SiteChatWidget } from '@/components/site-chat';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs, ClaudeBottomBar } from '@/components/claude-shell';

const SHORT: Record<Lang, string> = { en: 'EN', es: 'ES', fr: 'FR', ar: 'ع' };

/** Image with a calm fallback tile if the remote photo cannot load. */
export function Img({ src, alt, w = 900, className = '' }: { src: string | null | undefined; alt: string; w?: number; className?: string }) {
  if (!src) return <div role="img" aria-label={alt} className={`img-fallback ${className}`} />;
  return <img src={sized(src, w)} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" className={`img-fallback object-cover ${className}`} />;
}

/** Legacy slot photo (kept for pages that still use slots). */
export function PhotoFrame({ slot, lang, className = '', ratio = 'aspect-[4/5]' }: { slot: string; lang: Lang; className?: string; ratio?: string }) {
  const p = photo(slot);
  return <Img src={p?.src} alt={p?.alt[lang] ?? p?.alt.en ?? slot} className={`${ratio} w-full ${className}`} />;
}

const AR = /[\u0600-\u06FF]/;
/** The street-sign plaque: primary name over its counterpart in the other script. */
export function Plaque({ primary, secondary, size = 'lg', as: Tag = 'span', className = '' }: { primary: string; secondary?: string; size?: 'lg' | 'sm'; as?: any; className?: string }) {
  return (
    <Tag className={`plaque ${size === 'sm' ? 'plaque-sm' : ''} text-center ${className}`}>
      <span className={`kufi block leading-tight ${AR.test(primary) ? 'ar-sp' : ''}`}>{primary}</span>
      {secondary && <span className={`kufi block leading-tight opacity-80 ${AR.test(secondary) ? 'ar-sp' : ''} ${size === 'sm' ? 'text-[0.7em]' : 'text-[0.42em] mt-1'}`}>{secondary}</span>}
    </Tag>
  );
}

export function TbcBadge({ lang }: { lang: Lang }) {
  return <span className="ms-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">{dict(lang).common.tbc}</span>;
}

export async function SiteShell({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return (
    <div className="vl-page min-h-screen flex flex-col bg-[#fdfbf7]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">{children}</main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
      <ClaudeBottomBar lang={lang} />
      <SiteChatWidget lang={lang} />
    </div>
  );
}

export function LangSwitcher({ lang, path = '' }: { lang: Lang; path?: string }) {
  return (
    <nav aria-label="Language" className="flex rounded-full border border-lapis-200 p-0.5 text-sm shrink-0">
      {SITE_LANGS.map((l) => (
        <Link key={l} href={`/${l}${path}`} hrefLang={l} lang={l} aria-current={l === lang ? 'true' : undefined}
          className={`rounded-full px-2.5 py-1 font-medium ${l === lang ? 'bg-lapis-800 text-white' : 'text-lapis-800 hover:bg-lapis-50'}`}>{SHORT[l]}</Link>
      ))}
    </nav>
  );
}

export function SearchBar({ lang, defaults, compact = false, stacked = false, room }: { lang: Lang; defaults?: { checkIn?: string; checkOut?: string; guests?: number }; compact?: boolean; stacked?: boolean; room?: string }) {
  const d = dict(lang);
  const t0 = todayLocal();
  return (
    <form action={`/${lang}/book`} method="get" className={`grid gap-3 rounded-2xl bg-white ${stacked ? 'grid-cols-2 p-0 [&>button]:col-span-2' : 'p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_7rem_auto] lg:items-end'} ${compact ? '' : 'shadow-[0_20px_50px_-25px_rgba(21,29,53,.55)]'}`}>
      {room && <input type="hidden" name="room" value={room} />}
      <div className="min-w-0"><label className="v-label" htmlFor="ci">{d.search.checkin}</label><input id="ci" name="checkIn" type="date" required min={t0} defaultValue={defaults?.checkIn ?? addDays(t0, 7)} className="v-field" /></div>
      <div className="min-w-0"><label className="v-label" htmlFor="co">{d.search.checkout}</label><input id="co" name="checkOut" type="date" required min={addDays(t0, 1)} defaultValue={defaults?.checkOut ?? addDays(t0, 9)} className="v-field" /></div>
      <div className="min-w-0"><label className="v-label" htmlFor="gs">{d.search.guests}</label><input id="gs" name="guests" type="number" min={1} max={40} defaultValue={defaults?.guests ?? 1} required className="v-field" /></div>
      <button className="v-btn v-btn-primary h-[50px]" type="submit">{d.search.check}</button>
    </form>
  );
}

export const money = (cents: number, cur: string, lang = 'en') => {
  try { return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : lang, { style: 'currency', currency: cur, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); }
  catch { return `${(cents / 100).toFixed(2).replace(/\.00$/, '')} ${cur}`; }
};
export const nm = (o: Record<string, string> | null | undefined, lang: string) => (o?.[lang] || o?.en || Object.values(o ?? {})[0] || '') as string;
/** The name in the other script, for the bilingual plaque. */
export const otherName = (o: Record<string, string> | null | undefined, lang: string) => (lang === 'ar' ? o?.en : o?.ar) ?? undefined;
export { fill };
