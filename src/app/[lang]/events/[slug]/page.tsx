import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { isSiteLang } from '@/i18n/site';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs } from '@/components/claude-shell';
import { getPublicEvent, seatsLeft, tr } from '@/services/events';
import { priceLabel, whenLabel } from '@/services/event-view';
import { scheduleLabel, timeLabel, dateLabel } from '@/lib/event-dates';
import { EventBooker } from './event-booker';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const ev = await getPublicEvent(slug).catch(() => null);
  if (!ev) return { title: 'Event' };
  return { title: tr(ev.title, lang), description: tr(ev.summary, lang), openGraph: { images: ev.image ? [ev.image] : [] } };
}

const ERR: Record<string, { en: string; ar: string }> = {
  no_availability: { en: 'Sorry, there aren’t enough places left on that date. Pick another date or fewer tickets.', ar: 'عذرًا، الأماكن المتبقية في هذا اليوم لا تكفي. اختر يومًا آخر أو عددًا أقل.' },
  invalid_dates: { en: 'That date is no longer available. Please pick another one.', ar: 'هذا اليوم لم يعد متاحًا. اختر يومًا آخر.' },
  'invalid_input:stay_reference': { en: 'We couldn’t find a stay with that booking reference on this date. Check it, or book at the regular price.', ar: 'لم نجد حجز إقامة بهذا الرقم في هذا اليوم. راجع الرقم أو احجز بالسعر العادي.' },
  'invalid_input:option': { en: 'Please choose an option.', ar: 'من فضلك اختر نوعًا.' },
  'invalid_input:pay_method': { en: 'That payment method isn’t available right now. Choose another one.', ar: 'طريقة الدفع هذه غير متاحة الآن. اختر طريقة أخرى.' },
  invalid_input: { en: 'Please check your details and try again.', ar: 'راجع بياناتك وحاول مرة أخرى.' },
  rate_limit: { en: 'Too many attempts. Please wait a few minutes and try again.', ar: 'محاولات كثيرة. انتظر دقائق وحاول مرة أخرى.' },
  generic: { en: 'Something went wrong. Please try again or message us on WhatsApp.', ar: 'حدث خطأ. حاول مرة أخرى أو راسلنا على واتساب.' },
};

export default async function EventPage({ params, searchParams }: { params: Promise<{ lang: string; slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { lang, slug } = await params;
  if (!isSiteLang(lang)) notFound();
  const sp = await searchParams;
  const ev = await getPublicEvent(slug);
  if (!ev) notFound();
  const isAr = lang === 'ar';
  const L = (o: { en: string; ar: string }) => (isAr ? o.ar : o.en);
  const left = await seatsLeft(ev);
  const dates = ev.dates.slice(0, 14).map((d) => ({ date: d, label: whenLabel(d, lang), sub: dateLabel(d, lang, { day: 'numeric', month: 'short' }), left: left[d] }));
  const errMsg = sp.error ? L(ERR[sp.error] ?? ERR[sp.error.split(':')[0]] ?? ERR.generic) : null;
  const schedule = scheduleLabel(ev, lang, (d) => dateLabel(d, lang, { weekday: 'long', day: 'numeric', month: 'long' }));
  const time = `${timeLabel(ev.start_time, lang)} – ${timeLabel(ev.end_time, lang)}`;
  const wa = `https://wa.me/201040551515?text=${encodeURIComponent((isAr ? 'أريد حجز: ' : 'I’d like to book: ') + tr(ev.title, 'en') + ' — Villa Layla')}`;

  return (
    <div className="vl-page min-h-screen flex flex-col">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <section className="evd-hero">
          {ev.image && <img src={ev.image} alt="" />}
          <div className="wrap evd-hero-in">
            <a href={`/${lang}#events`} className="evd-back">{isAr ? '→ كل الفعاليات' : '← All events'}</a>
            <span className="kicker">{isAr ? 'فعالية في فيلا ليلى' : 'At Villa Layla'}</span>
            <h1>{tr(ev.title, lang)}</h1>
            <p>{tr(ev.summary, lang)}</p>
          </div>
        </section>

        <div className="wrap evd-grid">
          <div className="evd-info">
            <dl className="evd-facts">
              <div><dt>{isAr ? 'المواعيد' : 'When'}</dt><dd>{schedule}</dd></div>
              <div><dt>{isAr ? 'الوقت' : 'Time'}</dt><dd dir="ltr">{time}</dd></div>
              <div><dt>{isAr ? 'السعر' : 'Price'}</dt><dd dir="ltr">{priceLabel(ev.price_cents, ev.currency, lang)} <small>{isAr ? '/ للشخص' : '/ person'}</small></dd></div>
              <div><dt>{isAr ? 'المكان' : 'Where'}</dt><dd>{isAr ? 'فيلا ليلى، ٢٠ شارع صفية زغلول، السيدة زينب' : 'Villa Layla, 20 Safiya Zaghloul St, El Sayeda Zeinab'}</dd></div>
            </dl>

            <h2>{isAr ? 'عن الفعالية' : 'About'}</h2>
            <p className="evd-desc">{tr(ev.description, lang)}</p>

            {ev.includes.length > 0 && (
              <>
                <h2>{isAr ? 'يشمل' : 'Included'}</h2>
                <ul className="amen">
                  {ev.includes.map((x, i) => (
                    <li key={i}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><path d="m5 12 5 5 9-10" /></svg>{tr(x, lang)}</li>
                  ))}
                </ul>
              </>
            )}
            {tr(ev.note, lang) && <p className="evd-note">{tr(ev.note, lang)}</p>}
          </div>

          <aside className="evd-book" id="book" aria-labelledby="bookH">
            <h2 id="bookH">{isAr ? 'احجز تذكرتك' : 'Book your ticket'}</h2>
            {errMsg && <p role="alert" className="form-msg">{errMsg}</p>}
            {ev.methods.length === 0 ? (
              <div className="evd-off">
                <p>{isAr ? 'الحجز أونلاين غير متاح لهذه الفعالية الآن. احجز مكانك على واتساب.' : 'Online booking isn’t open for this event right now. Reserve your place on WhatsApp.'}</p>
                <a className="btn btn-wa" href={wa} target="_blank" rel="noopener noreferrer">{isAr ? 'احجز على واتساب' : 'Book on WhatsApp'}</a>
              </div>
            ) : (
              <EventBooker
                lang={lang}
                slug={ev.slug}
                dates={dates}
                initialDate={sp.date && dates.some((d) => d.date === sp.date) ? sp.date : dates[0]?.date ?? ''}
                options={ev.options.map((o) => ({ key: o.key, label: isAr ? o.ar : o.en }))}
                priceCents={ev.price_cents}
                guestPriceCents={ev.guest_price_cents}
                currency={ev.currency}
                methods={ev.methods}
              />
            )}
          </aside>
        </div>
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
    </div>
  );
}
