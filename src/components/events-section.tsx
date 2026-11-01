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
  soldOut?: boolean;        // every upcoming date (next 2 weeks) is full
  left?: number | null;     // places left on the next open date (null = unlimited)
  /** Collab events: own page (/c/<slug>), partner name, and sign-up instead of tickets. */
  href?: string;
  partner?: string;
  /** Highlighted card (e.g. "Same day" on a collab page): its own badge text and a gold outline. */
  badge?: string;
  hl?: boolean;
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
export function EventsSection({ lang, events, heading = 'h2', limit, head, id = 'events' }: { lang: string; events: EventCard[]; heading?: 'h1' | 'h2'; limit?: number; head?: { kicker: string; title: string; intro?: string }; id?: string }) {
  if (!events.length) return null;
  const isAr = lang === 'ar';
  const H = heading;
  const shown = limit ? events.slice(0, limit) : events;
  return (
    <section className="sec band-white ev-sec" id={id} aria-labelledby={`${id}H`}>
      <div className="wrap">
        <div className="sec-hd">
          <div>
            <span className="kicker">{head?.kicker ?? (isAr ? 'فعاليات فيلا ليلى' : 'Events at Villa Layla')}</span>
            <H id={`${id}H`}>{head?.title ?? (isAr ? 'ماذا يحدث في الفيلا قريبًا.' : 'What’s on at the villa.')}</H>
            <p>
              {head ? head.intro : isAr
                ? 'فطور في الحديقة، يوم في المسبح، يوغا وعشاء بيتي. احجز تذكرتك وادفع أونلاين، وتوصلك التذكرة فورًا.'
                : 'Breakfast in the garden, pool days, yoga and homemade dinners. Book and pay online, and your ticket arrives instantly.'}
            </p>
          </div>
        </div>

        <div className="ev-grid">
          {shown.map((e) => {
            const href = e.href ?? `/${lang}/events/${e.slug}`;
            return (
            <article key={href} className={`ev-card ${e.hl ? 'ev-hl' : ''}`}>
              <a href={href} className="ev-media" aria-label={e.title}>
                {e.image && <img src={e.image} alt="" loading="lazy" />}
                {e.soldOut
                  ? <span className="ev-when sold">{isAr ? 'نفدت التذاكر' : 'Sold out'}</span>
                  : <span className={`ev-when ${e.soon || e.hl ? 'soon' : ''}`}>{e.badge ?? e.next}{e.left != null && e.left <= 10 ? (isAr ? ` · باقي ${e.left}` : ` · ${e.left} left`) : ''}</span>}
              </a>
              <div className="ev-body">
                <div className="meta">
                  <span>{ic.cal}{e.schedule}</span>
                  <span>{ic.clock}<span dir="ltr">{e.time}</span></span>
                </div>
                <h3><a href={href}>{e.title}</a></h3>
                <p className="desc">{e.summary}</p>
                <div className="row">
                  <div className={e.partner && e.price.length > 14 ? 'price ev-price-txt' : 'price'}>
                    <small>{e.partner ? (isAr ? 'الدخول' : 'Entry') : isAr ? 'للشخص' : 'Per person'}</small>
                    <b className="num" dir="ltr">{e.price}</b>
                  </div>
                  {e.soldOut ? (
                    <span className="btn btn-line btn-sm" aria-disabled="true">{isAr ? 'نفدت التذاكر' : 'Sold out'}</span>
                  ) : (
                    <a className="btn btn-primary btn-sm" href={e.partner ? `${href}#join` : href}>
                      {ic.ticket}
                      {e.partner ? (isAr ? 'سجّل حضورك' : 'Sign up') : isAr ? 'احجز تذكرة' : 'Get tickets'}
                    </a>
                  )}
                </div>
              </div>
            </article>
            );
          })}
        </div>
        {heading === 'h2' && (
          <p className="ev-all"><a className="btn btn-line" href={`/${lang}/events`}>{isAr ? `كل الفعاليات (${events.length})` : `All events (${events.length})`}</a></p>
        )}
      </div>
    </section>
  );
}
