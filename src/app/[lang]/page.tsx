import { notFound } from 'next/navigation';
import { isSiteLang } from '@/i18n/site';
import { getSetting } from '@/services/settings';
import { syncHostelworldData, readCachedRates, getDefaultRates } from '@/services/hostelworld-sync';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs, ClaudeBottomBar } from '@/components/claude-shell';
import { ClaudeHome } from '@/components/claude-home';
import { listPublicEvents } from '@/services/events';
import { toEventCard } from '@/services/event-view';

export const dynamic = 'force-dynamic';

export default async function Home({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const cur = (await getSetting<string>('currency')) ?? 'USD';

  let initialRates = readCachedRates()?.rooms;
  if (!initialRates) {
    try {
      const synced = await syncHostelworldData();
      initialRates = synced.rooms;
    } catch {
      initialRates = getDefaultRates().rooms;
    }
  }

  const events = (await listPublicEvents()).map((e) => toEventCard(e, lang));

  return (
    <div className="vl-page min-h-screen flex flex-col bg-[#FBF7F1] text-[#2F2925]">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <ClaudeHome lang={lang} currency={cur} initialRates={initialRates} events={events} />
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
      <ClaudeBottomBar lang={lang} />
    </div>
  );
}
