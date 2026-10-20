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
      <head />
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
