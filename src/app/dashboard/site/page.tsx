import { requireUser } from '@/lib/auth';
import { PageHeader, Flash, SubTabs } from '@/components/dash';
import { listTours, listFilms, roomPhotos } from '@/services/site-content';
import { RoomPhotosManager, ToursManager, FilmsManager } from '@/components/site-manager';

export const dynamic = 'force-dynamic';

/** Website management: room photos, day trips and guest films shown on the public website. */
export default async function SitePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('site.manage');
  const sp = await searchParams;
  const tab = sp.tab === 'tours' || sp.tab === 'films' ? sp.tab : 'rooms';
  const tabs = [
    { href: '/dashboard/site', label: 'Room photos', icon: 'bed' },
    { href: '/dashboard/site?tab=tours', label: 'Day trips', icon: 'map' },
    { href: '/dashboard/site?tab=films', label: 'Guest films (Instagram)', icon: 'sparkles' },
  ];
  return (
    <>
      <PageHeader title="Website" sub="What visitors see on villalaylahostel.com: room photos, day trips and the guest films. Changes are live as soon as you save." />
      <SubTabs tabs={tabs} current={tab === 'rooms' ? '/dashboard/site' : `/dashboard/site?tab=${tab}`} />
      <Flash sp={sp} />
      {tab === 'rooms' && <RoomPhotosManager rooms={await roomPhotos()} />}
      {tab === 'tours' && <ToursManager tours={(await listTours(true)) as any} />}
      {tab === 'films' && <FilmsManager films={(await listFilms(true)) as any} />}
    </>
  );
}
