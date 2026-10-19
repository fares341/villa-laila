import { notFound } from 'next/navigation';
import { dict, isSiteLang } from '@/i18n/site';
import { DEFAULT_FAQ } from '@/content/faq';
import { getSetting } from '@/services/settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'FAQ' };
export default async function Faq({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const d = dict(lang);
  const custom = await getSetting<any[] | undefined>('faq');
  const items = Array.isArray(custom) && custom.length ? custom : DEFAULT_FAQ;
  const L = lang as 'en';
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-5xl text-lapis-800">{d.faq.title}</h1>
      <div className="mt-8 divide-y divide-lapis-100 rounded-3xl bg-white">
        {items.map((f: any, i: number) => (
          <details key={i} className="group p-5"><summary className="cursor-pointer list-none font-medium text-lapis-800">{f.q[L] ?? f.q.en}</summary><p className="mt-3 text-lapis-600">{f.a[L] ?? f.a.en}</p></details>
        ))}
      </div>
    </div>
  );
}
