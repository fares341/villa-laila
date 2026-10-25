import { NextResponse, type NextRequest } from 'next/server';

const LANGS = ['en', 'es', 'fr', 'ar'];
/** The visitor's language choice (set on every page in a language, so switching language sticks). */
const COOKIE = 'vl_lang';
const BOTS = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|lighthouse|headless/i;

/**
 * The best site language for this browser (Accept-Language, by weight): ar / fr / es / en. Any other language
 * (German, Russian, Chinese…) gets English, and the page then translates itself into it (see AutoTranslate).
 */
function browserLang(req: NextRequest): string {
  const items = (req.headers.get('accept-language') ?? '')
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().toLowerCase().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.split('=')[1] ?? 1);
      return { base: tag.split('-')[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.base && x.base !== '*')
    .sort((a, b) => b.q - a.q || a.i - b.i);
  // The first language the visitor prefers decides; if it is not one of ours, English (then auto-translated).
  const first = items[0]?.base;
  return first && LANGS.includes(first) ? first : 'en';
}

// Only language routing + the lang header for <html lang dir>. Authorization is NOT done here (see requireUser()).
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const first = pathname.split('/')[1];
  const human = req.method === 'GET' && !BOTS.test(req.headers.get('user-agent') ?? '');

  if (LANGS.includes(first)) {
    // First visit (no choice yet): open the page in the browser's own language, keeping the same page.
    // Search engines and link previews always get the language in the link.
    if (human && !req.cookies.get(COOKIE)) {
      const want = browserLang(req);
      if (want !== first) {
        const url = req.nextUrl.clone();
        url.pathname = '/' + want + pathname.slice(1 + first.length);
        url.search = search;
        const res = NextResponse.redirect(url);
        res.cookies.set(COOKIE, want, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
        return res;
      }
    }
    const h = new Headers(req.headers);
    h.set('x-lang', first);
    const res = NextResponse.next({ request: { headers: h } });
    if (req.cookies.get(COOKIE)?.value !== first) res.cookies.set(COOKIE, first, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });
    return res;
  }
  if (pathname === '/') {
    const saved = req.cookies.get(COOKIE)?.value;
    const pick = saved && LANGS.includes(saved) ? saved : browserLang(req);
    return NextResponse.redirect(new URL('/' + pick + search, req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next|api|photos|favicon.ico|robots.txt|sitemap.xml).*)'] };
