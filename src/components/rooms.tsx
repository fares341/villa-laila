import Link from 'next/link';
import { dict, fill } from '@/i18n/site';
import type { Lang } from '@/i18n/bot';
import type { PublicRoom } from '@/services/public-rooms';
import { Img, Plaque, money, nm, otherName } from './site';

export function PriceLine({ r, lang, cur }: { r: PublicRoom; lang: Lang; cur: string }) {
  const v = dict(lang).v2;
  if (r.priceCents == null) return <span className="text-sm text-lapis-600">{v.onRequest}</span>;
  return (
    <span className="text-sm text-lapis-600">
      <span className="whitespace-nowrap">{fill(v.from, { p: '' })}<b className="text-lg font-semibold text-lapis-800">{money(r.priceCents, cur, lang)}</b></span> <span className="whitespace-nowrap">{r.kind === 'dorm' ? v.perBed : v.perRoom}</span>
      {r.demoPrice && <span className="mt-0.5 block text-[11px] font-medium text-amber-800">{v.sample}</span>}
    </span>
  );
}

/** A private room as a doorway: arched photo, enamel name plaque, the facts that decide a booking. */
export function RoomCard({ r, lang, cur }: { r: PublicRoom; lang: Lang; cur: string }) {
  const v = dict(lang).v2;
  return (
    <Link href={`/${lang}/rooms/${r.code}`} className="group block focus-visible:outline-offset-4">
      <div className="overflow-hidden arch-top bg-pistachio">
        <Img src={r.photos[0]} alt={nm(r.name, lang)} w={600} className="aspect-[4/5] w-full transition-transform duration-500 group-hover:scale-[1.03]" />
      </div>
      <div className="-mt-6 flex justify-center px-2"><Plaque size="sm" primary={nm(r.name, lang)} secondary={otherName(r.name, lang)} className="text-[1.05rem]" /></div>
      <p className="mt-3 text-center text-sm text-lapis-600">{nm(r.details.bed, lang)}{r.details.sleeps ? `${lang === 'ar' ? '، ' : ', '}${fill(v.sleeps, { n: r.details.sleeps }).toLowerCase()}` : ''}</p>
      <p className="mt-1 text-center"><PriceLine r={r} lang={lang} cur={cur} /></p>
    </Link>
  );
}

const WHO_STYLE: Record<string, string> = { female: 'bg-bloom-50 text-bloom-700', male: 'bg-lapis-50 text-lapis-600', mixed: 'bg-pool-50 text-pool-800' };

export function DormList({ rooms, lang, cur }: { rooms: PublicRoom[]; lang: Lang; cur: string }) {
  const v = dict(lang).v2;
  return (
    <ul className="divide-y divide-lapis-100 border-y border-lapis-100">
      {rooms.map((r) => (
        <li key={r.id}>
          <Link href={`/${lang}/rooms/${r.code}`} className="grid grid-cols-[5.5rem_1fr] items-center gap-4 py-4 hover:bg-white/60 sm:grid-cols-[7rem_1fr_auto] sm:gap-6">
            <Img src={r.photos[0]} alt={nm(r.name, lang)} w={300} className="aspect-[4/3] w-full rounded-xl" />
            <span>
              <span className="kufi block text-lg font-semibold text-lapis-800">{nm(r.name, lang)}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-lapis-600">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${WHO_STYLE[r.gender]}`}>{v.who[r.gender]}</span>
                {r.details.beds ? <span>{fill(v.bedsN, { n: r.details.beds })}</span> : null}
                <span className="hidden sm:inline">{nm(r.details.bed, lang)}</span>
              </span>
              <span className="mt-1 block sm:hidden"><PriceLine r={r} lang={lang} cur={cur} /></span>
            </span>
            <span className="hidden text-end sm:block"><PriceLine r={r} lang={lang} cur={cur} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
