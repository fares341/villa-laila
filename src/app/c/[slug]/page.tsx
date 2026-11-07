import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import React from 'react';
import { getCollabBySlug, peopleGoing, type Loc } from '@/services/collabs';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs } from '@/components/claude-shell';
import { EventAbout } from '@/app/[lang]/events/[slug]/event-about';
import { HeroMedia } from '@/app/[lang]/events/[slug]/hero-media';
import { RsvpForm } from './rsvp-form';
import { PhotoStrip } from './photo-strip';
import { weeklyMenu } from '@/services/weekly-menu';
import { EventsSection } from '@/components/events-section';
import { moreEventsFor } from '@/services/event-view';
import { visitorPriceView } from '@/services/visitor-currency';
import { communityLink } from '@/services/settings';
import { WaGroup } from '@/components/wa-group';
import { ogImages } from '@/lib/og';
import './collab.css';

export const dynamic = 'force-dynamic';

const MAP_URL = 'https://maps.app.goo.gl/H7YGjCVT7nshDExj9';

const pickLang = async (q?: string) => {
  if (q === 'ar' || q === 'en') return q;
  const al = (await headers()).get('accept-language') ?? '';
  return /^\s*ar\b/i.test(al) ? 'ar' : 'en';
};
const t = (x: Loc | undefined, ar: boolean) => (ar ? x?.ar || x?.en : x?.en || x?.ar) || '';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = await getCollabBySlug(slug);
  if (!c) return {};
  const title = `${c.title.en || c.title.ar} · Villa Layla & ${c.partner_name}`;
  return { title, description: (c.description.en || c.description.ar || '').replace(/[*_#-]/g, '').slice(0, 160), openGraph: { title, description: (c.description.en || c.description.ar || '').replace(/[*_#-]/g, '').slice(0, 160), type: 'website', images: ogImages(c.cover || c.inner_cover || c.photos[0] || c.partner_logo, title) }, twitter: { card: 'summary_large_image' } };
}

/**
 * A collab event's page, in the same look as the villa's own event pages: photo header with both logos,
 * the facts, the description, photos and meals, and the sign-up form on the side (under the facts on phones).
 */
export default async function CollabPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const c = await getCollabBySlug(slug);
  if (!c || !c.active) notFound();
  const lang = await pickLang(sp.lang);
  const ar = lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const external = c.signup_mode === 'link' && !!c.signup_url;
  const going = external ? 0 : await peopleGoing(c.id);
  const groupLink = c.whatsapp_group || (await communityLink());
  const more = await moreEventsFor(c, lang, await visitorPriceView().catch(() => undefined));
  const sameDay = more.filter((e) => e.hl).length;
  const left = external || c.capacity == null ? null : Math.max(0, c.capacity - going);
  const over = !!c.event_date && c.event_date < new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
  const when = c.event_date ? new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(c.event_date + 'T12:00:00Z')) : null;
  const time = (x: string | null) => (x ? new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`2000-01-01T${x}:00Z`)) : '');
  const hoursList = [time(c.start_time), time(c.end_time)].filter(Boolean);
  // Each time kept whole (so Arabic "8:00 م" never gets split by the direction of the line).
  const hoursEl = hoursList.map((h, i) => <React.Fragment key={i}>{i > 0 && ' – '}<bdi>{h}</bdi></React.Fragment>);
  const title = t(c.title, ar);
  // Meals picked from the villa's weekly menu follow the menu (its current photo, name and points).
  const menus = c.meals.some((m) => m.from) ? { dinner: await weeklyMenu('dinner'), breakfast: await weeklyMenu('breakfast') } : null;
  const meals = c.meals.map((m) => {
    const pk = m.from ? /^(dinner|breakfast):([0-6])$/.exec(m.from) : null;
    const d = pk && menus ? menus[pk[1] as 'dinner' | 'breakfast'][Number(pk[2])] : null;
    if (!d || !(d.title.ar || d.title.en)) return m;
    const pts = (x: 'ar' | 'en') => (d.description[x] || d.dishes.map((y) => y[x] || '').filter(Boolean).join('\n')).split(/\r?\n/).map((l) => l.trim().replace(/^[-•*·]\s*/, '')).filter(Boolean).slice(0, 6).join('\n');
    return { ...m, title: d.title, points: { ar: pts('ar'), en: pts('en') }, img: d.img ?? m.img };
  }).filter((m) => t(m.title, ar));
  const place = t(c.place, ar);
  // Somewhere else than the villa: its Google Maps link (pin) or its written place; else the villa.
  const away = !!c.map_url || (!!(c.place.en || c.place.ar) && !/villa layla|فيلا ليلى/i.test(`${c.place.en ?? ''} ${c.place.ar ?? ''}`));
  const mapHref = c.map_url || (away ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.place.en || c.place.ar || '')}` : MAP_URL);
  const pinM = c.map_url?.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? c.map_url?.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? c.map_url?.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  const mapQuery = pinM ? `${pinM[1]},${pinM[2]}` : away ? (c.place.en || c.place.ar || '') : 'Villa Layla Hostel, 20 Safiya Zaghloul St, El Sayeda Zeinab, Cairo';
  const cal = c.event_date ? (() => {
    const d = c.event_date!.replace(/-/g, '');
    const st = (c.start_time || '19:00').replace(':', '') + '00', en = (c.end_time || '23:00').replace(':', '') + '00';
    const u = new URL('https://calendar.google.com/calendar/render');
    u.searchParams.set('action', 'TEMPLATE'); u.searchParams.set('text', `${title} · Villa Layla & ${c.partner_name}`);
    u.searchParams.set('dates', `${d}T${st}/${d}T${en}`); u.searchParams.set('ctz', 'Africa/Cairo'); u.searchParams.set('location', t(c.place, false) || 'Villa Layla, Cairo');
    return u.toString();
  })() : null;
  const wa = `https://wa.me/201040551515?text=${encodeURIComponent(`${L('About', 'بخصوص')}: ${title} — Villa Layla & ${c.partner_name}`)}`;

  return (
    <div className={`vl-page min-h-screen flex flex-col ${ar ? 'ar-font' : ''}`} lang={lang} dir={ar ? 'rtl' : 'ltr'}>
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <section className="evd-hero cbx-hero">
          <HeroMedia video={null} photos={c.inner_cover || c.cover ? [(c.inner_cover || c.cover)!] : c.photos} cover={c.partner_logo} />
          <div className="wrap evd-hero-in">
            <a href={`/${lang}/events`} className="evd-back">{ar ? '→ كل الفعاليات' : '← All events'}</a>
            {/* Each logo with its name under it; both open that side's Instagram */}
            <div className="cbx-logos">
              <a className="cbx-brand" href="https://instagram.com/villalaylacairo" target="_blank" rel="noopener noreferrer" aria-label="Villa Layla — Instagram">
                <span className="cbx-logo"><img src="/assets/logo-240.webp" alt="" /><i className="cbx-ig" aria-hidden /></span>
                <span className="cbx-name">Villa Layla</span>
              </a>
              <span className="cbx-amp" aria-hidden>&amp;</span>
              {(() => {
                const inner = (
                  <>
                    <span className="cbx-logo">{c.partner_logo ? <img src={c.partner_logo} alt="" /> : <b>{c.partner_name.slice(0, 2)}</b>}{c.partner_link && <i className="cbx-ig" aria-hidden />}</span>
                    <span className="cbx-name">{c.partner_name}</span>
                  </>
                );
                return c.partner_link
                  ? <a className="cbx-brand" href={c.partner_link} target="_blank" rel="noopener noreferrer" aria-label={`${c.partner_name} — Instagram`}>{inner}</a>
                  : <div className="cbx-brand">{inner}</div>;
              })()}
            </div>
            <h1>{title}</h1>
            {!over && (left === 0 || (left != null && left <= 15) || going >= 10) && (
              <p className="cbx-left">{left === 0 ? L('Sold out', 'التذاكر خلصت') : left != null && left <= 15 ? L(`Only ${left} places left`, `باقي ${left} أماكن بس`) : L(`${going} people already have a ticket`, `${going} حاجزين تذكرة لحد دلوقتي`)}</p>
            )}
          </div>
          <a className="cbx-lang" href={`?lang=${ar ? 'en' : 'ar'}`}>{ar ? 'English' : 'عربي'}</a>
        </section>

        <div className="wrap evd-grid cbx-grid">
          <div className="evd-info">
            <dl className="evd-facts cbx-facts">
              {when && <div><dt>{L('Date', 'اليوم')}</dt><dd>{when}</dd></div>}
              {hoursList.length > 0 && <div><dt>{L('Time', 'الوقت')}</dt><dd className="cbx-time">{hoursEl}</dd></div>}
              {(() => {
                const v = c.price_mode === 'fixed' && c.price_cents ? `${ar ? `${(c.price_cents / 100).toLocaleString('en-US')} ج.م` : `EGP ${(c.price_cents / 100).toLocaleString('en-US')}`}${L(' per ticket', ' للتذكرة')}`
                  : c.price_mode === 'pwyw' ? L('Pay what you want', 'ادفع اللي تحبه') : '';
                const note = t(c.price_note, ar);
                return v || note ? <div><dt>{L('Entry', 'الدخول')}</dt><dd>{[v, note].filter(Boolean).join(' · ')}</dd></div> : null;
              })()}
              <div><dt>{L('Where', 'المكان')}</dt><dd className="evd-where">
                <span>{place || L('Villa Layla, 20 Safiya Zaghloul St, El Sayeda Zeinab', 'فيلا ليلى، ٢٠ شارع صفية زغلول، السيدة زينب')}</span>
                <a className="evd-map" href={mapHref} target="_blank" rel="noopener noreferrer" aria-label={L('Open in Google Maps', 'افتح المكان على خرائط جوجل')}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.6" /></svg>
                  <span>{L('Map', 'الخريطة')}</span>
                </a>
              </dd></div>
              <div className="cbx-partner"><dt>{L('In collaboration with', 'بالتعاون مع')}</dt><dd>
                {c.partner_logo && <img src={c.partner_logo} alt="" />}
                {c.partner_link ? <a href={c.partner_link} target="_blank" rel="noopener noreferrer">{c.partner_name}</a> : c.partner_name}
              </dd></div>
            </dl>

            <div className="evd-mapbox"><iframe src={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=16&output=embed`} title={L('Map', 'الخريطة')} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>

            <EventAbout isAr={ar} text={t(c.description, ar)} includes={[]} note="" />

            {c.photos.length > 0 && (
              <>
                <h2>{L('Photos', 'من أجواء الإيفنت')}</h2>
                <PhotoStrip photos={c.photos} ar={ar} />
              </>
            )}

            {meals.length > 0 && (
              <>
                <h2>{L('On the menu', 'المنيو')}</h2>
                <div className="cb-meals">
                  {meals.map((m, i) => {
                    const pts = t(m.points, ar).split(/\n+/).filter(Boolean);
                    return (
                      <article key={i} className="cb-meal">
                        {m.img && <img src={m.img} alt={t(m.title, ar)} loading="lazy" />}
                        <div>
                          <h3>{t(m.title, ar)}</h3>
                          {pts.length > 0 && <ul>{pts.map((p, j) => <li key={j}>{p}</li>)}</ul>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="evd-side">
            <aside className="evd-book" id="join" aria-labelledby="joinH">
              <h2 id="joinH">{L('Get your ticket', 'احجز تذكرتك')}</h2>
              {c.cancelled_at ? (
                <div className="evd-off">
                  <p><b>{L('This event is cancelled', 'الإيفنت ده اتلغى')}</b> · {L('Sorry! Everyone who booked has been told. Have a look at our other events.', 'بنعتذر! كل اللي حجزوا اتبلّغوا. شوف الإيفنتات التانية بتاعتنا.')}</p>
                  <a className="btn btn-line" href={`/${lang}/events`}>{L('See other events', 'شوف فعاليات تانية')}</a>
                </div>
              ) : over ? (
                <div className="evd-off">
                  <p><b>{L('This event has taken place', 'الإيفنت ده خلص')}</b> · {L('Thank you to everyone who came! Follow us for the next one.', 'شكرًا لكل اللي حضروا! تابعنا عشان تعرف الجاي.')}</p>
                  <a className="btn btn-line" href={`/${lang}/events`}>{L('See other events', 'شوف فعاليات تانية')}</a>
                </div>
              ) : left === 0 ? (
                <div className="evd-off">
                  <p><b>{L('Sold out', 'التذاكر خلصت')}</b> · {L('Message us on WhatsApp to join the waiting list.', 'كلمنا على واتساب عشان نضيفك على قايمة الانتظار.')}</p>
                  <a className="btn btn-wa" href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                </div>
              ) : external ? (
                <div className="cbx-ext">
                  <p>{L(`Tickets for this event are taken by ${c.partner_name}. Tap below to get yours on their page.`, `تذاكر الإيفنت ده بتتحجز عند ${c.partner_name}. اضغط تحت واحجز تذكرتك من عندهم.`)}</p>
                  <a className="btn btn-primary cbx-ext-btn" href={c.signup_url!} target="_blank" rel="noopener noreferrer">
                    {L('Get your ticket', 'احجز تذكرتك')}
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M7 17 17 7M9 7h8v8" /></svg>
                  </a>
                  {cal && <a className="btn btn-line" href={cal} target="_blank" rel="noopener noreferrer">{L('Add to calendar', 'ضيفه على التقويم')}</a>}
                  <small dir="ltr">{(() => { try { return new URL(c.signup_url!).hostname.replace(/^www\./, ''); } catch { return ''; } })()}</small>
                </div>
              ) : (
                <RsvpForm slug={c.slug} ar={ar} askEmail={c.ask_email} questions={c.questions ?? []} priceMode={c.price_mode ?? 'free'} priceCents={c.price_cents ?? null} maxPeople={left == null ? 10 : Math.min(10, left)} title={title} partner={c.partner_name} calendarUrl={cal} />
              )}
            </aside>
            {groupLink && <WaGroup href={groupLink} lang={lang} kind={c.whatsapp_group ? 'event' : 'community'} />}
          </div>
        </div>
        <EventsSection lang={lang} events={more} limit={10} id="more" slider head={{
          kicker: L('More at Villa Layla', 'كمان في فيلا ليلى'),
          title: sameDay ? L('Make a day of it.', 'خليها يوم كامل.') : L('Other events at the villa.', 'فعاليات تانية في الفيلا.'),
          intro: sameDay
            ? L(`${sameDay === 1 ? 'One more thing is' : sameDay <= 5 ? `${sameDay} more things are` : 'More things are'} on at the villa that day. Come early or stay longer.`, `${sameDay === 1 ? 'في حاجة تانية' : sameDay <= 5 ? `في ${sameDay} حاجات تانية` : 'في حاجات تانية كتير'} في الفيلا نفس اليوم. تعالى بدري أو خليك معانا أكتر.`)
            : L('Breakfast in the garden, pool days, homemade dinners and more. Book online in a minute.', 'فطار في الجنينة، أيام في البيسين، عشا بيتي وحاجات تانية. احجز أونلاين في دقيقة.'),
        }} />
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
    </div>
  );
}
