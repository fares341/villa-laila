import React from 'react';

export type EventCard = {
  slug: string;
  title: string;
  summary: string;
  image: string | null;
  price: string;            // formatted, e.g. "EGP 200"
  schedule: string;         // "Daily", "Wed & Sat", "Mon, 19 Oct"
  time: string;             // "8:00 AM – 11:00 AM"
  next: string;             // "Today", "Tomorrow", "Wed, 21 Oct"
  soon: boolean;            // runs today or tomorrow
};

const ic = {
  cal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  ticket: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden className="w-[18px] h-[18px]">
      <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z" /><path d="M14 6v12" strokeDasharray="2 2" />
    </svg>
  ),
};

/** "Events at Villa Layla" — sits right under the services section on the home page. */
export function EventsSection({ lang, events }: { lang: string; events: EventCard[] }) {
  if (!events.length) return null;
  const isAr = lang === 'ar';
  return (
    <section className="sec band-white ev-sec" id="events" aria-labelledby="eventsH">
      <div className="wrap">
        <div className="sec-hd">
          <div>
            <span className="kicker">{isAr ? 'فعاليات فيلا ليلى' : 'Events at Villa Layla'}</span>
            <h2 id="eventsH">{isAr ? 'ماذا يحدث في الفيلا هذا الأسبوع.' : 'What’s on by the pool this week.'}</h2>
            <p>
              {isAr
                ? 'فطور في الحديقة، يوم في المسبح، يوغا وعشاء بيتي. احجز تذكرتك وادفع أونلاين، وتوصلك التذكرة فورًا.'
                : 'Breakfast in the garden, pool days, yoga and homemade dinners. Book and pay online, and your ticket arrives instantly.'}
            </p>
          </div>
        </div>

        <div className="ev-grid">
          {events.map((e) => (
            <article key={e.slug} className="ev-card">
              <a href={`/${lang}/events/${e.slug}`} className="ev-media" aria-label={e.title}>
                {e.image && <img src={e.image} alt="" loading="lazy" />}
                <span className={`ev-when ${e.soon ? 'soon' : ''}`}>{e.next}</span>
              </a>
              <div className="ev-body">
                <div className="meta">
                  <span>{ic.cal}{e.schedule}</span>
                  <span>{ic.clock}<span dir="ltr">{e.time}</span></span>
                </div>
                <h3><a href={`/${lang}/events/${e.slug}`}>{e.title}</a></h3>
                <p className="desc">{e.summary}</p>
                <div className="row">
                  <div className="price">
                    <small>{isAr ? 'للشخص' : 'Per person'}</small>
                    <b className="num" dir="ltr">{e.price}</b>
                  </div>
                  <a className="btn btn-primary btn-sm" href={`/${lang}/events/${e.slug}`}>
                    {ic.ticket}
                    {isAr ? 'احجز تذكرة' : 'Get tickets'}
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
