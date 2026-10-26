import { notFound } from 'next/navigation';
import { isSiteLang } from '@/i18n/site';
import { syncHostelworldData, readCachedRates, getDefaultRates } from '@/services/hostelworld-sync';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs, ClaudeBottomBar } from '@/components/claude-shell';
import { ClaudeHome } from '@/components/claude-home';
import { listPublicEvents } from '@/services/events';
import { toEventCard } from '@/services/event-view';
import { visitorPriceView } from '@/services/visitor-currency';
import { listTours, listFilms, roomPhotosByCode, listSlides } from '@/services/site-content';

export const dynamic = 'force-dynamic';

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const view = await visitorPriceView();

  let initialRates = readCachedRates()?.rooms;
  if (!initialRates) {
    try {
      const synced = await syncHostelworldData();
      initialRates = synced.rooms;
    } catch {
      initialRates = getDefaultRates().rooms;
    }
  }

  const events = (await listPublicEvents()).map((e) => toEventCard(e, lang, view));
  // Website content from the dashboard (Website). Nothing set yet → the built-in defaults.
  const [tours, allFilms, roomPhotos, slides] = await Promise.all([listTours(), listFilms(true), roomPhotosByCode(), listSlides()]);
  const live = allFilms.filter((f) => f.active);
  const films = allFilms.length
    ? { main: live.filter((f) => f.kind === 'main').map((f) => ({ src: f.video, poster: f.poster ?? '' }))[0] ?? null, reels: live.filter((f) => f.kind === 'reel').map((f) => ({ src: f.video, poster: f.poster ?? '' })) }
    : null;

  return (
    <div className="vl-page min-h-screen flex flex-col bg-[#FBF7F1] text-[#2F2925]">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <ClaudeHome lang={lang} view={view} initialRates={initialRates} events={events} tours={tours.length ? tours : null} films={films} roomPhotos={roomPhotos} slides={slides.length ? slides : null} />
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
      <ClaudeBottomBar lang={lang} />
    </div>
  );
}
