import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-arabic';
import '@fontsource-variable/el-messiri';
import '@fontsource-variable/readex-pro';
// Website brand fonts, served from our own server (a Google Fonts @import inside the bundled CSS is ignored by browsers).
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/plus-jakarta-sans/wght-italic.css';
import '@fontsource/almarai/300.css';
import '@fontsource/almarai/400.css';
import '@fontsource/almarai/700.css';
import '@fontsource/almarai/800.css';
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
      <head />
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
