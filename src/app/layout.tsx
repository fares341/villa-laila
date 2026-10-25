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

export const metadata: Metadata = { title: 'Villa Layla Hostel', description: 'Villa Layla Hostel — Cairo, Egypt' };
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
