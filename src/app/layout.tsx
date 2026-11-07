import '@fontsource/almarai/300.css';
import '@fontsource/almarai/400.css';
import '@fontsource/almarai/700.css';
import '@fontsource/almarai/800.css';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-arabic';
import '@fontsource-variable/el-messiri';
import '@fontsource-variable/readex-pro';
import './globals.css';
import { headers } from 'next/headers';
import type { Metadata, Viewport } from 'next';

/**
 * metadataBase: the site's real address, so shared links get full picture addresses (https://villalaylahostel.com/…)
 * instead of http://localhost:3000/…, which WhatsApp and others cannot open.
 */
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const host = (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim();
  const local = !host || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
  const base = process.env.PUBLIC_SITE_URL || (local ? process.env.PUBLIC_BASE_URL || 'https://villalaylahostel.com' : `${h.get('x-forwarded-proto')?.split(',')[0] || 'https'}://${host}`);
  let metadataBase: URL | undefined;
  try { metadataBase = new URL(base); } catch { metadataBase = new URL('https://villalaylahostel.com'); }
  return { metadataBase, title: 'Villa Layla Hostel', description: 'Villa Layla Hostel — Cairo, Egypt', openGraph: { siteName: 'Villa Layla Hostel', type: 'website' } };
}
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#201A18',
  viewportFit: 'cover',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = (await headers()).get('x-lang') ?? 'en';
  return (
    <html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <head>
        <link rel="preload" href="/fonts/almarai-arabic-400.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/almarai-arabic-700.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/plus-jakarta-sans-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
