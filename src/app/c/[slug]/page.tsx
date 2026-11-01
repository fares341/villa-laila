import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import React from 'react';
import { getCollabBySlug, peopleGoing, type Loc } from '@/services/collabs';
import { aboutParts, rich } from '@/app/[lang]/events/[slug]/event-about';
import { RsvpForm } from './rsvp-form';
import { PhotoStrip } from './photo-strip';
import './collab.css';

export const dynamic = 'force-dynamic';

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
  const title = `${c.title.en || c.title.ar} · Villa Layla × ${c.partner_name}`;
  return { title, description: (c.description.en || c.description.ar || '').replace(/[*_#-]/g, '').slice(0, 160), openGraph: { title, images: c.photos[0] ? [c.photos[0]] : c.partner_logo ? [c.partner_logo] : [] } };
}

/**
 * A collab event's own page, made for Instagram stories (most visitors arrive on a phone, from a story link):
 * our logo × the partner's logo and name, the title and when, the description, photos, meals, then "I'm coming".
 */
export default async function CollabPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const c = await getCollabBySlug(slug);
  if (!c || !c.active) notFound();
  const lang = await pickLang(sp.lang);
  const ar = lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const going = await peopleGoing(c.id);
  const left = c.capacity == null ? null : Math.max(0, c.capacity - going);
  const over = !!c.event_date && c.event_date < new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
  const when = c.event_date ? new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(c.event_date + 'T12:00:00Z')) : null;
  const time = (x: string | null) => (x ? new Intl.DateTimeFormat(ar ? 'ar-EG-u-nu-latn' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(`2000-01-01T${x}:00Z`)) : '');
  const hoursList = [time(c.start_time), time(c.end_time)].filter(Boolean);
  const hours = hoursList.join(' – ');
  // Each time kept whole (so Arabic "8:00 م" never gets split by the direction of the line).
  const hoursEl = hoursList.map((h, i) => <React.Fragment key={i}>{i > 0 && ' – '}<bdi>{h}</bdi></React.Fragment>);
  const title = t(c.title, ar);
  const parts = aboutParts(t(c.description, ar));
  const meals = c.meals.filter((m) => t(m.title, ar));
  const cal = c.event_date ? (() => {
    const d = c.event_date!.replace(/-/g, '');
    const st = (c.start_time || '19:00').replace(':', '') + '00', en = (c.end_time || '23:00').replace(':', '') + '00';
    const u = new URL('https://calendar.google.com/calendar/render');
    u.searchParams.set('action', 'TEMPLATE'); u.searchParams.set('text', `${title} · Villa Layla × ${c.partner_name}`);
    u.searchParams.set('dates', `${d}T${st}/${d}T${en}`); u.searchParams.set('ctz', 'Africa/Cairo'); u.searchParams.set('location', t(c.place, false) || 'Villa Layla, Cairo');
    return u.toString();
  })() : null;

  return (
    <div className="cb" dir={ar ? 'rtl' : 'ltr'} lang={lang} style={{ ['--acc' as string]: c.accent }}>
      <div className="cb-bg" aria-hidden style={c.photos[0] ? { backgroundImage: `url(${c.photos[0]})` } : undefined} />
      <a className="cb-lang" href={`?lang=${ar ? 'en' : 'ar'}`}>{ar ? 'English' : 'عربي'}</a>

      <header className="cb-hero">
        <div className="cb-logos">
          <span className="cb-logo ours"><img src="/assets/logo-240.webp" alt="Villa Layla" /></span>
          <span className="cb-x" aria-hidden>×</span>
          <span className="cb-logo theirs">{c.partner_logo ? <img src={c.partner_logo} alt={c.partner_name} /> : <b>{c.partner_name.slice(0, 2)}</b>}</span>
        </div>
        <p className="cb-names">Villa Layla <span>×</span> {c.partner_link ? <a href={c.partner_link} target="_blank" rel="noopener noreferrer">{c.partner_name}</a> : c.partner_name}</p>
        <h1>{title}</h1>
        {!over && (left === 0 || (left != null && left <= 15) || going >= 10) && <p className="cb-left">{left === 0 ? L('Fully booked', 'العدد اكتمل') : left != null && left <= 15 ? L(`Only ${left} places left`, `باقي ${left} أماكن بس`) : L(`${going} people already coming`, `${going} مسجلين لحد دلوقتي`)}</p>}
      </header>

      <section className="cb-sec">
        <div className="cb-card cb-info">
          {when && <div><svg viewBox="0 0 24 24" aria-hidden><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg><small>{L('Date', 'اليوم')}</small><b>{when}</b></div>}
          {hours && <div><svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg><small>{L('Time', 'الميعاد')}</small><b>{hoursEl}</b></div>}
          {t(c.place, ar) && <div><svg viewBox="0 0 24 24" aria-hidden><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg><small>{L('Place', 'المكان')}</small><b>{t(c.place, ar)}</b></div>}
          {t(c.price_note, ar) && <div><svg viewBox="0 0 24 24" aria-hidden><path d="M3 7h18v10H3z" /><circle cx="12" cy="12" r="2.5" /></svg><small>{L('Entry', 'الدخول')}</small><b>{t(c.price_note, ar)}</b></div>}
        </div>
      </section>

      {parts.length > 0 && (
        <section className="cb-sec">
          <h2><small>{L('The night', 'الإيفنت')}</small>{L('About the night', 'عن الإيفنت')}</h2>
          <div className="cb-card cb-about">
          {parts.map((x, i) => x.kind === 'h' ? <h3 key={i}>{x.text}</h3>
            : x.kind === 'ul' ? <ul key={i}>{x.items.map((it, j) => <li key={j}>{it.icon && <span aria-hidden>{it.icon} </span>}{rich(it.text)}</li>)}</ul>
            : <p key={i}>{rich(x.text)}</p>)}
          </div>
        </section>
      )}

      {c.photos.length > 0 && (
        <section className="cb-sec cb-photos" aria-label={L('Photos', 'الصور')}>
          <h2><small>{L('Gallery', 'من أجواء الإيفنت')}</small>{L('Photos', 'الصور')}</h2>
          <PhotoStrip photos={c.photos} ar={ar} />
        </section>
      )}

      {meals.length > 0 && (
        <section className="cb-sec">
          <h2><small>{L('Menu', 'المنيو')}</small>{L('On the menu', 'الأكل')}</h2>
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
        </section>
      )}

      <section className="cb-sec cb-join" id="join">
        {over ? <p className="cb-over">{L('This event has taken place. Thank you to everyone who came!', 'الإيفنت ده خلص. شكرًا لكل اللي حضروا!')}</p>
          : left === 0 ? <p className="cb-over">{L('All places are taken. Message us on WhatsApp to join the waiting list.', 'الأماكن خلصت. كلمنا على واتساب عشان نضيفك على قايمة الانتظار.')}</p>
          : <RsvpForm slug={c.slug} ar={ar} askEmail={c.ask_email} maxPeople={left == null ? 10 : Math.min(10, left)} title={title} partner={c.partner_name} calendarUrl={cal} />}
      </section>

      <footer className="cb-foot">
        <img src="/assets/logo-240.webp" alt="" />
        <p>Villa Layla · {L('20 Safiya Zaghloul St, El Sayeda Zeinab, Cairo', '20 شارع صفية زغلول، السيدة زينب، القاهرة')}</p>
        <a href="https://wa.me/201040551515" target="_blank" rel="noopener noreferrer">WhatsApp +20 104 055 1515</a>
      </footer>
    </div>
  );
}
