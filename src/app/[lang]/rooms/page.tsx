import { notFound } from 'next/navigation';
import { dict, isSiteLang } from '@/i18n/site';
import { RoomCard, DormList } from '@/components/rooms';
import { publicRooms } from '@/services/public-rooms';
import { getSetting } from '@/services/settings';
import { SearchBar } from '@/components/site';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rooms' };

export default async function Rooms({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const d = dict(lang); const v = d.v2;
  const [rooms, cur] = [await publicRooms(), await getSetting<string>('currency')];
  const privates = rooms.filter((r) => r.kind === 'private');
  const dorms = rooms.filter((r) => r.kind === 'dorm');
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-14">
      <h1 className="text-3xl sm:text-5xl text-lapis-800">{v.roomsTitle}</h1>
      <p className="mt-2 sm:mt-3 max-w-xl text-base sm:text-lg text-lapis-600">{v.roomsLead}</p>
      <div className="mt-6 sm:mt-8"><SearchBar lang={lang} compact /></div>
      {rooms.length === 0 && <p className="mt-10 rounded-2xl bg-white p-6 text-lapis-600">{d.rooms.empty}</p>}
      {privates.length > 0 && (
        <section className="pt-12 sm:pt-16">
          <h2 className="text-2xl sm:text-3xl text-lapis-800">{v.privTitle}</h2><p className="mt-1 sm:mt-2 text-sm sm:text-base text-lapis-600">{v.privLead}</p>
          <div className="mt-8 sm:mt-10 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-5 gap-y-8 sm:gap-y-10">{privates.map((r) => <RoomCard key={r.id} r={r} lang={lang} cur={cur} />)}</div>
        </section>
      )}
      {dorms.length > 0 && (
        <section id="dorms" className="scroll-mt-24 pt-20">
          <h2 className="text-3xl text-lapis-800">{v.dormTitle}</h2><p className="mt-2 text-lapis-600">{v.dormLead}</p>
          <div className="mt-8"><DormList rooms={dorms} lang={lang} cur={cur} /></div>
        </section>
      )}
    </div>
  );
}
