import Link from 'next/link';
import { visitorPriceView } from '@/services/visitor-currency';
import { notFound } from 'next/navigation';
import { dict, isSiteLang, fill } from '@/i18n/site';
import { Img, Plaque, SearchBar, nm, otherName } from '@/components/site';
import { PriceLine } from '@/components/rooms';
import { publicRooms } from '@/services/public-rooms';
import { getSetting } from '@/services/settings';

export const dynamic = 'force-dynamic';

export default async function RoomDetail({ params }: { params: Promise<{ lang: string; code: string }> }) {
  const { lang, code } = await params;
  if (!isSiteLang(lang)) notFound();
  const all = await publicRooms();
  const r = all.find((x) => x.code === code);
  if (!r) notFound();
  const d = dict(lang); const v = d.v2;
  const cur = await getSetting<string>('currency');
  const view = await visitorPriceView();
  const [first, ...rest] = r.photos;
  const facts = ([
    [v.bedType, nm(r.details.bed, lang)],
    ...(r.kind === 'dorm' ? [[v.col.who, v.who[r.gender]] as [string, string], ...(r.details.beds ? [[v.col.beds, String(r.details.beds)] as [string, string]] : [])] : [[fill(v.sleeps, { n: '' }).trim(), String(r.details.sleeps ?? r.capacity ?? '')] as [string, string]]),
  ] as [string, string][]).filter(([, x]) => x);
  const others = all.filter((x) => x.kind === r.kind && x.id !== r.id).slice(0, 5);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10 max-w-full overflow-hidden">
      <Link href={`/${lang}/rooms${r.kind === 'dorm' ? '#dorms' : ''}`} className="text-sm text-lapis-600 underline underline-offset-4">{v.roomsTitle}</Link>
      <div className="mt-5 grid gap-3 md:grid-cols-4 md:grid-rows-2">
        <Img src={first} alt={nm(r.name, lang)} w={1400} className="aspect-[4/3] w-full rounded-2xl md:col-span-2 md:row-span-2 md:aspect-auto md:h-full" />
        {rest.slice(0, 4).map((p, i) => <Img key={p} src={p} alt={`${nm(r.name, lang)} ${i + 2}`} w={600} className="hidden aspect-[4/3] w-full rounded-2xl md:block" />)}
      </div>
      {rest.length > 4 && <div className="snap-row mt-3 md:hidden">{rest.map((p) => <Img key={p} src={p} alt={nm(r.name, lang)} w={600} className="aspect-[4/3] w-full rounded-2xl" />)}</div>}
      <div className="mt-8 sm:mt-10 grid gap-8 sm:gap-10 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0">
          <Plaque as="h1" primary={nm(r.name, lang)} secondary={otherName(r.name, lang)} className="px-5 sm:px-7 text-3xl sm:text-4xl md:text-5xl max-w-full" />
          <p className="mt-6 max-w-xl text-base sm:text-lg text-lapis-800">{nm(r.description, lang)}</p>
          <dl className="mt-6 grid max-w-md grid-cols-2 gap-x-6 gap-y-3">
            {facts.map(([k, val]) => <div key={k}><dt className="text-sm text-lapis-600">{k}</dt><dd className="font-medium text-lapis-800">{val}</dd></div>)}
          </dl>
          {r.amenities.length > 0 && (<>
            <h2 className="mt-10 text-xl sm:text-2xl text-lapis-800">{v.features}</h2>
            <ul className="mt-3 flex flex-wrap gap-2">{r.amenities.map((a, i) => <li key={i} className="rounded-full border border-lapis-200 bg-white px-3 py-1 text-sm text-lapis-800">{nm(a, lang)}</li>)}</ul>
          </>)}
        </div>
        <aside className="self-start rounded-2xl bg-white p-4 sm:p-6 lg:sticky lg:top-24 max-w-full w-full">
          <PriceLine r={r} lang={lang} cur={cur} view={view} />
          <h2 className="mt-4 text-lg sm:text-xl text-lapis-800">{v.checkDates}</h2>
          <div className="mt-3 w-full"><SearchBar lang={lang} compact stacked room={r.code} defaults={{ guests: r.kind === 'dorm' ? 1 : Math.min(2, r.details.sleeps ?? 2) }} /></div>
        </aside>
      </div>
      {others.length > 0 && (
        <section className="pt-20">
          <h2 className="text-2xl text-lapis-800">{r.kind === 'dorm' ? v.dormTitle : v.privTitle}</h2>
          <ul className="mt-4 flex flex-wrap gap-3">{others.map((o) => <li key={o.id}><Link href={`/${lang}/rooms/${o.code}`}><Plaque size="sm" primary={nm(o.name, lang)} /></Link></li>)}</ul>
        </section>
      )}
    </div>
  );
}
