import { notFound } from 'next/navigation';
import { isSiteLang, dict } from '@/i18n/site';
import type { Metadata } from 'next';
import { AutoTranslate } from '@/components/auto-translate';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isSiteLang(lang)) return {};
  const d = dict(lang);
  return {
    title: { default: d.meta.title, template: '%s — Villa Layla' }, description: d.meta.description,
    alternates: { languages: { en: '/en', es: '/es', fr: '/fr', ar: '/ar' } },
    openGraph: { title: d.meta.title, description: d.meta.description, locale: lang },
  };
}

export default async function LangLayout({ children, params }: { children: React.ReactNode; params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  return (
    <div lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'} className={lang === 'ar' ? 'ar-font' : undefined}>
      {children}
      <AutoTranslate />
    </div>
  );
}
