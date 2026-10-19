import { notFound } from 'next/navigation';
import { dict, isSiteLang } from '@/i18n/site';
import { getSetting, localized } from '@/services/settings';
import { TbcBadge } from '@/components/site';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Policies' };
export default async function Policies({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const d = dict(lang);
  const blocks: [string, string | null][] = [
    [d.policies.cancellation, localized(await getSetting('cancellation_policy'), lang)],
    [d.policies.payment, localized(await getSetting('payment_instructions'), lang)],
    [d.policies.rules, localized(await getSetting('house_rules'), lang)],
  ];
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-5xl text-lapis-800">{d.policies.title}</h1>
      <section className="mt-8 rounded-3xl bg-pistachio/60 p-6"><h2 className="text-2xl text-lapis-800">{d.policies.howTitle}</h2><p className="mt-2 text-lapis-800">{d.policies.how}</p></section>
      {blocks.map(([title, body]) => (
        <section key={title} className="mt-8"><h2 className="text-2xl text-lapis-800">{title}{!body && <TbcBadge lang={lang} />}</h2>
          <p className="mt-2 whitespace-pre-line text-lapis-600">{body ?? d.policies.tbc}</p></section>
      ))}
    </div>
  );
}
