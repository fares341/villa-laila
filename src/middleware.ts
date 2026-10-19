import { NextResponse, type NextRequest } from 'next/server';

const LANGS = ['en', 'es', 'fr', 'ar'];

// Only language routing + the lang header for <html lang dir>. Authorization is NOT done here (see requireUser()).
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const first = pathname.split('/')[1];
  if (LANGS.includes(first)) {
    const h = new Headers(req.headers);
    h.set('x-lang', first);
    return NextResponse.next({ request: { headers: h } });
  }
  if (pathname === '/') {
    const accept = (req.headers.get('accept-language') ?? '').toLowerCase();
    const pick = accept.split(',').map((p) => p.trim().slice(0, 2)).find((p) => LANGS.includes(p)) ?? 'en';
    return NextResponse.redirect(new URL('/' + pick, req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!_next|api|photos|favicon.ico|robots.txt|sitemap.xml).*)'] };
