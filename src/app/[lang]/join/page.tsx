import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { isSiteLang } from '@/i18n/site';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs } from '@/components/claude-shell';
import { JoinForm } from './join-form';
import './join.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return lang === 'ar'
    ? { title: 'انضم لفريقنا', description: 'اشتغل أو اتطوع في فيلا ليلى هوستل في القاهرة.' }
    : { title: 'Join our team', description: 'Work or volunteer at Villa Layla Hostel in Cairo.' };
}

/** "Join our team": a job at the reception or volunteering, with the application form (no Google Form). */
export default async function JoinPage({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const sp = await searchParams;
  const ar = lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const kind = sp.as === 'volunteer' ? 'volunteer' : 'job';
  return (
    <div className="vl-page min-h-screen flex flex-col">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <section className="evd-hero jn-hero">
          <img src="/photos/hero-02-poster.jpg" alt="" className="evd-hero-media on" />
          <div className="wrap evd-hero-in">
            <span className="kicker">{L('Villa Layla Hostel', 'فيلا ليلى هوستل')}</span>
            <h1>{L('Join our team', 'انضم لفريقنا')}</h1>
            <p>{L('Work with us or volunteer, and meet people from all over the world.', 'اشتغل معانا أو اتطوع، واتعرف على ناس من كل حتة في العالم.')}</p>
          </div>
        </section>

        <div className="wrap evd-grid">
          <div className="evd-info">
            <div className="evd-about jn-about">
              <h2 className="evd-about-k">{L('Who we’re looking for', 'بندوّر على مين')}</h2>
              <p className="evd-about-tag">{L('Friendly, organized and proactive people who love meeting guests from different cultures.', 'ناس ودودة ومنظمة وبتبادر، بتحب تقابل ضيوف من ثقافات مختلفة.')}</p>
              <div className="evd-about-body">
                <p>{L('If you’re passionate about hospitality, enjoy working in a lively international place and like being part of a team, we’d love to hear from you.',
                  'لو بتحب الضيافة، ومبسوط في مكان دولي مليان حركة، وبتحب تشتغل وسط فريق، يبقى إحنا عايزين نسمع منك.')}</p>
                <p>{L('Fill in the form. If your profile is a good match, we’ll contact you for the next step.', 'املا الفورم، ولو مناسب هنكلمك للخطوة الجاية.')}</p>
              </div>
            </div>
            <div className="jn-cards">
              <a href={`?as=job#apply`} className={`jn-card ${kind === 'job' ? 'on' : ''}`}>
                <span className="jn-ic" aria-hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></svg></span>
                <b>{L('Work with us', 'اشتغل معانا')}</b>
                <span>{L('Receptionist · full-time or part-time, rotating shifts. Welcome guests, handle bookings and make their stay unforgettable.', 'ريسبشن · دوام كامل أو جزئي بشيفتات. تستقبل الضيوف وتظبط الحجوزات وتخلّي إقامتهم متتنسيش.')}</span>
              </a>
              <a href={`?as=volunteer#apply`} className={`jn-card ${kind === 'volunteer' ? 'on' : ''}`}>
                <span className="jn-ic" aria-hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" /></svg></span>
                <b>{L('Volunteer', 'اتطوع معانا')}</b>
                <span>{L('Help at the reception, with guests and at our events for a while. Tell us how long you can stay.', 'ساعدنا في الريسبشن ومع الضيوف وفي الإيفنتات لفترة. قولّنا تقدر تفضل قد إيه.')}</span>
              </a>
            </div>
          </div>
          <div className="evd-side">
            <aside className="evd-book" id="apply" aria-labelledby="applyH">
              <h2 id="applyH">{L('Apply', 'قدّم دلوقتي')}</h2>
              <JoinForm ar={ar} initialKind={kind} />
            </aside>
          </div>
        </div>
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
    </div>
  );
}
