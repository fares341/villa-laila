import { requireUser } from '@/lib/auth';
import { PageHeader, Flash, SubTabs } from '@/components/dash';
import { q } from '@/lib/db';
import { getSetting } from '@/services/settings';
import { listTours, listFilms, roomPhotos, listSlides } from '@/services/site-content';
import { RoomPhotosManager, ToursManager, FilmsManager, SlidesManager } from '@/components/site-manager';

export const dynamic = 'force-dynamic';

/** Website management: room photos, day trips and guest films shown on the public website. */
export default async function SitePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('site.manage');
  const sp = await searchParams;
  const tab = sp.tab === 'tours' || sp.tab === 'films' || sp.tab === 'slider' ? sp.tab : 'rooms';
  const tabs = [
    { href: '/dashboard/site?tab=slider', label: 'Home slider', icon: 'home' },
    { href: '/dashboard/site', label: 'Room photos & videos', icon: 'bed' },
    { href: '/dashboard/site?tab=tours', label: 'Day trips', icon: 'map' },
    { href: '/dashboard/site?tab=films', label: 'Guest films (Instagram)', icon: 'sparkles' },
  ];
  return (
    <>
      <PageHeader title="Website" sub="What visitors see on villalaylahostel.com: the home slider, room photos and videos, day trips and the guest films. Changes are live as soon as you save." />
      <EngineStatus />
      <SubTabs tabs={tabs} current={tab === 'rooms' ? '/dashboard/site' : `/dashboard/site?tab=${tab}`} />
      <Flash sp={sp} />
      {tab === 'rooms' && <RoomPhotosManager rooms={await roomPhotos()} />}
      {tab === 'tours' && <ToursManager tours={(await listTours(true)) as any} />}
      {tab === 'films' && <FilmsManager films={(await listFilms(true)) as any} />}
      {tab === 'slider' && <SlidesManager slides={(await listSlides(true)) as any} />}
    </>
  );
}

/** Are room prices and availability coming in from the booking engine (direct-book.com)? */
async function EngineStatus() {
  const [st, agg] = await Promise.all([
    getSetting<any>('direct_book_status').catch(() => null),
    q<any>(`SELECT count(DISTINCT stay_date)::int nights, max(checked_at) last FROM direct_prices WHERE stay_date >= current_date AND checked_at > now() - interval '2 days'`).catch(() => [{}]),
  ]);
  const a = agg[0] ?? {};
  const ok = Number(a.nights) > 0;
  const when = (x: string | null | undefined) => (x ? new Date(x).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
  return (
    <p className={`mb-4 rounded-xl border px-4 py-3 text-sm ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-300 bg-amber-50 text-amber-950'}`}>
      <b>Room prices from the booking engine (direct-book):</b>{' '}
      {ok ? <>{a.nights} upcoming nights read · last read {when(a.last)}. The website uses these prices and closes rooms that are closed there.</>
        : <>nothing read yet{st?.at ? ` (last try ${when(st.at)})` : ''}. Until it works the website uses Hostelworld / your own rates and your own availability. Check that the <code>direct-reader</code> service runs on the server.</>}
      {st?.errors?.length ? <span className="mt-1 block text-xs opacity-80">Last problems: {st.errors.slice(0, 3).join(' | ')}</span> : null}
    </p>
  );
}
