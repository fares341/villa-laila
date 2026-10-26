import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { isSiteLang } from '@/i18n/site';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs, ClaudeBottomBar } from '@/components/claude-shell';
import { EventsSection } from '@/components/events-section';
import { listPublicEvents } from '@/services/events';
import { toEventCard } from '@/services/event-view';
import { visitorPriceView } from '@/services/visitor-currency';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return { title: lang === 'ar' ? 'الفعاليات' : 'Events', description: lang === 'ar' ? 'فعاليات فيلا ليلى: احجز تذكرتك أونلاين.' : 'Events at Villa Layla: book your ticket online.' };
}

/** Every published event with a date coming up, the same list as on the home page. */
export default async function EventsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const ar = lang === 'ar';
  const view = await visitorPriceView();
  const events = (await listPublicEvents()).map((e) => toEventCard(e, lang, view));
  const wa = `https://wa.me/201040551515?text=${encodeURIComponent(ar ? 'عايز أعرف الفعاليات الجاية في فيلا ليلى' : 'What events are coming up at Villa Layla?')}`;
  return (
    <div className="vl-page min-h-screen flex flex-col bg-[#FBF7F1] text-[#2F2925]">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1 evl-main">
        {events.length ? <EventsSection lang={lang} events={events} heading="h1" /> : (
          <section className="sec band-white">
            <div className="wrap evl-empty">
              <span className="kicker">{ar ? 'فعاليات فيلا ليلى' : 'Events at Villa Layla'}</span>
              <h1>{ar ? 'مفيش فعاليات معلنة دلوقتي.' : 'No events announced right now.'}</h1>
              <p>{ar ? 'تابعنا على إنستجرام أو راسلنا على واتساب عشان تعرف الجديد أول بأول.' : 'Follow us on Instagram or message us on WhatsApp to hear about the next ones.'}</p>
              <a className="btn btn-wa" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>
            </div>
          </section>
        )}
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
      <ClaudeBottomBar lang={lang} />
    </div>
  );
}
