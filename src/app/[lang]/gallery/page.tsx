import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dict, isSiteLang } from '@/i18n/site';
import { Img, Plaque, nm } from '@/components/site';
import { SITE_PHOTOS, ALT } from '@/content/property';
import { publicRooms } from '@/services/public-rooms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Photos' };

export default async function Gallery({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const v = dict(lang).v2;
  const rooms = (await publicRooms()).filter((r) => r.photos.length);
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-3xl sm:text-5xl text-lapis-800">{v.photosTitle}</h1>
      <p className="mt-2 sm:mt-3 text-base sm:text-lg text-lapis-600">{v.photosLead}</p>
      <div className="mt-8 sm:mt-10 columns-1 sm:columns-2 md:columns-3 gap-3 [&>*]:mb-3">
        {SITE_PHOTOS.map((src) => <Img key={src} src={src} alt={ALT[lang]} w={700} className="w-full break-inside-avoid rounded-2xl" />)}
      </div>
      {rooms.map((r) => (
        <section key={r.id} className="pt-14">
          <Link href={`/${lang}/rooms/${r.code}`}><Plaque size="sm" primary={nm(r.name, lang)} className="text-lg" /></Link>
          <div className="snap-row mt-4">{r.photos.map((p, i) => <Img key={p} src={p} alt={`${nm(r.name, lang)} ${i + 1}`} w={700} className="aspect-[4/3] w-full rounded-2xl" />)}</div>
        </section>
      ))}
    </div>
  );
}
