import { notFound } from 'next/navigation';
import { dict, isSiteLang } from '@/i18n/site';
import { hostelInfo } from '@/services/settings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Find us' };
export default async function Location({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const d = dict(lang);
  const h: any = await hostelInfo();
  const any = h?.address || h?.phone || h?.email || h?.whatsapp;
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-5xl text-lapis-800">{d.location.title}</h1>
      <p className="mt-3 text-xl text-lapis-800">{d.location.city}</p>
      <p className="mt-2 text-lapis-600" dir="ltr">{h?.address ?? d.location.addressTbc}</p>
      {h?.map_url && <a className="v-btn v-btn-ink mt-4" href={h.map_url} target="_blank" rel="noopener noreferrer">{d.v2.directions}</a>}
      <iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2392.109411453033!2d31.234714300835588!3d30.035821551113976!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x1458410066316bbd%3A0xed6927270f8c6574!2sHostel%20Layla!5e0!3m2!1sen!2sus!4v1758301801593!5m2!1sen!2sus" title="Map" loading="lazy" className="mt-8 h-[380px] w-full rounded-2xl border-0 bg-pistachio" />
      <h2 className="mt-10 text-2xl text-lapis-800">{d.location.contact}</h2>
      {any ? <dl className="mt-3 space-y-2">
        {h.phone && <div><dt className="inline font-medium">{d.location.phone}: </dt><dd className="inline" dir="ltr">{h.phone}</dd></div>}
        {h.whatsapp && <div><dt className="inline font-medium">{d.location.whatsapp}: </dt><dd className="inline" dir="ltr">{h.whatsapp}</dd></div>}
        {h.email && <div><dt className="inline font-medium">{d.location.email}: </dt><dd className="inline" dir="ltr">{h.email}</dd></div>}
      </dl> : <p className="mt-3 text-lapis-600">{d.location.contactTbc}</p>}
    </div>
  );
}
