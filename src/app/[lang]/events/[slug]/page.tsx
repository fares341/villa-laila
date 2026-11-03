import { notFound } from 'next/navigation';
import { todayLocal } from '@/lib/dates';
import { WeekMenuCard } from './week-menu';
import type { Metadata } from 'next';
import { isSiteLang } from '@/i18n/site';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs } from '@/components/claude-shell';
import { getPublicEvent, seatsLeft, tr, eventMedia, listPublicEvents, guestModeOf, guestUnitCents } from '@/services/events';
import { guestPriceText } from '@/services/event-view';
import { getWallets } from '@/services/wallets';
import { toEmbed } from '@/content/videos';
import { MealGallery } from './meal-gallery';
import { HeroMedia } from './hero-media';
import { whenLabel } from '@/services/event-view';
import { showPrice } from '@/lib/display-currency';
import { visitorPriceView } from '@/services/visitor-currency';
import { scheduleLabel, timeLabel, dateLabel } from '@/lib/event-dates';
import { EventBooker } from './event-booker';
import { weeklyMenu, breakfastPair } from '@/services/weekly-menu';
import { BreakfastPair } from './breakfast-pair';
import { StoryStrip, type Story } from './story-strip';
import { EventAbout } from './event-about';

export const dynamic = 'force-dynamic';

const MAP_URL = 'https://maps.app.goo.gl/H7YGjCVT7nshDExj9';


export async function generateMetadata({ params }: { params: Promise<{ lang: string; slug: string }> }): Promise<Metadata> {
  const { lang, slug } = await params;
  const ev = await getPublicEvent(slug).catch(() => null);
  if (!ev) return { title: 'Event' };
  return { title: tr(ev.title, lang), description: tr(ev.summary, lang), openGraph: { images: ev.image ? [ev.image] : [] } };
}

const ERR: Record<string, { en: string; ar: string }> = {
  'invalid_input:attendees': { en: 'Write the name and phone of every person coming with you.', ar: 'اكتب اسم ورقم موبايل كل فرد جاي معاك.' },
  'invalid_input:pwyw': { en: 'Write how much you would like to pay for the tickets.', ar: 'اكتب المبلغ اللي حابب تدفعه للتذاكر.' },
  'invalid_input:addon_date': { en: 'The extra event isn’t on that day. Pick another day or untick it.', ar: 'الإيفنت الإضافي مش موجود في اليوم ده. اختار يوم تاني أو شيله.' },
  'no_availability:addon': { en: 'There aren’t enough places left in the extra event on that day.', ar: 'الإيفنت الإضافي مفيهوش أماكن كفاية في اليوم ده.' },
  no_availability: { en: 'Sorry, there aren’t enough places left on that date. Pick another date or fewer tickets.', ar: 'عذرًا، الأماكن المتبقية في هذا اليوم لا تكفي. اختر يومًا آخر أو عددًا أقل.' },
  invalid_dates: { en: 'That date is no longer available. Please pick another one.', ar: 'هذا اليوم لم يعد متاحًا. اختر يومًا آخر.' },
  'invalid_input:stay_reference': { en: 'We couldn’t find a stay with that booking reference on this date. Check it, or book at the regular price.', ar: 'لم نجد حجز إقامة بهذا الرقم في هذا اليوم. راجع الرقم أو احجز بالسعر العادي.' },
  'invalid_input:option': { en: 'Please choose an option.', ar: 'من فضلك اختر نوعًا.' },
  'invalid_input:pay_method': { en: 'That payment method isn’t available right now. Choose another one.', ar: 'طريقة الدفع هذه غير متاحة الآن. اختر طريقة أخرى.' },
  pwyw: { en: 'Write how much you want to pay for the tickets (a number, 0 or more).', ar: 'اكتب المبلغ اللي حابب تدفعه للتذاكر (رقم، صفر أو أكتر).' },
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
  const view = await visitorPriceView();
  const L = (o: { en: string; ar: string }) => (isAr ? o.ar : o.en);
  const [left, media, wallets] = await Promise.all([seatsLeft(ev), eventMedia(ev.id), getWallets()]);
  const meals = media.filter((m) => m.kind === 'meal');
  const hero = media.filter((m) => m.kind === 'hero');
  const heroVideo = hero.find((m) => m.mime?.startsWith('video/'))?.src ?? null;
  const heroPhotos = hero.filter((m) => !m.mime?.startsWith('video/')).map((m) => m.src);
  const videos = media.filter((m) => m.kind === 'video').map((m) => ({ ...m, embed: m.external ? toEmbed(m.src) : null }));
  // Stories (9:16): the event's videos; a YouTube / Instagram link plays inside the story frame. (Meal photos are not stories.)
  const stories: Story[] = [
    ...videos.flatMap((v): Story[] => !v.external || v.embed?.kind === 'mp4' ? [{ id: v.id, type: 'video', src: v.embed?.src ?? v.src }]
      : v.embed ? [{ id: v.id, type: 'embed', src: v.embed.src }] : []),
  ];
  const dates = ev.dates.slice(0, 14).map((d) => {
    const when = whenLabel(d, lang);
    const weekday = dateLabel(d, lang, { weekday: 'long' });
    const isNear = when !== dateLabel(d, lang); // Today / Tomorrow
    return { date: d, label: isNear ? when : weekday, sub: isNear ? `${weekday} · ${dateLabel(d, lang, { day: 'numeric', month: 'long' })}` : dateLabel(d, lang, { day: 'numeric', month: 'long' }), left: left[d] };
  });
  const initialDate = sp.date && dates.some((d) => d.date === sp.date && d.left !== 0) ? sp.date : dates.find((d) => d.left !== 0)?.date ?? '';
  // The weekly menu: for the dinner add-on, and for a dinner event that shows its food photos.
  // Which weekly menu: set on the event, else dinner when it has the dinner add-on or meal photos.
  const isDinnerEvent = /dinner|عشاء|dining/i.test(`${ev.slug} ${tr(ev.title, 'en')} ${tr(ev.title, 'ar')}`);
  const isBreakfastEvent = /breakfast|فطار|فطور/i.test(`${ev.slug} ${tr(ev.title, 'en')} ${tr(ev.title, 'ar')}`);
  const menuKind = ev.menu_kind ?? (ev.dinner_cents || meals.length || isDinnerEvent ? 'dinner' : isBreakfastEvent ? 'breakfast' : 'none');
  // Breakfast: the same two meals every day, shown side by side (no week view).
  const breakfasts = (menuKind === 'breakfast' || isBreakfastEvent) ? await breakfastPair() : [];
  // For dinner (either event itself or dinner add-on): always load weeklyMenu('dinner')
  const dinnerMenu = (ev.dinner_cents || menuKind === 'dinner' || isDinnerEvent) ? await weeklyMenu('dinner') : {};
  const menu = menuKind === 'dinner' || isDinnerEvent ? dinnerMenu : (menuKind === 'none' || menuKind === 'breakfast' ? {} : await weeklyMenu(menuKind));
  // Other events that can be added the same day (only the dates they happen on, with seats left).
  const addonRows = (ev.addon_event_ids ?? []).length ? (await listPublicEvents()).filter((x) => (ev.addon_event_ids ?? []).includes(x.id)) : [];
  const addons = await Promise.all(addonRows.map(async (a) => {
    const l = await seatsLeft(a);
    return {
      id: a.id, title: tr(a.title, lang), priceCents: Number(a.price_cents), guestMode: guestModeOf(a), guestPriceCents: guestUnitCents(a) ?? (a.guest_price_cents == null ? null : Number(a.guest_price_cents)),
      time: `${timeLabel(a.start_time, lang)} – ${timeLabel(a.end_time, lang)}`,
      left: Object.fromEntries(a.dates.slice(0, 30).map((d) => [d, a.capacity == null ? null : l[d] ?? 0])),
    };
  }));
  const hasMenu = Object.values(menu).some(Boolean);
  const errMsg = sp.error ? L(ERR[sp.error] ?? ERR[sp.error.split(':')[0]] ?? ERR.generic) : null;
  const schedule = scheduleLabel(ev, lang, (d) => dateLabel(d, lang, { weekday: 'long', day: 'numeric', month: 'long' }));
  const time = `${timeLabel(ev.start_time, lang)} – ${timeLabel(ev.end_time, lang)}`;
  // Price for villa guests (free / pay what you want / a % off / a fixed price), shown in the price box.
  const guestNote = guestPriceText(ev, lang, view);
  // Address and map: the event's own, else the villa's.
  const address = (isAr ? ev.address?.ar || ev.address?.en : ev.address?.en || ev.address?.ar) || (isAr ? 'فيلا ليلى، ٢٠ شارع صفية زغلول، السيدة زينب' : 'Villa Layla, 20 Safiya Zaghloul St, El Sayeda Zeinab');
  const mapUrl = ev.map_url || (ev.address?.en || ev.address?.ar ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.address?.en || ev.address?.ar || '')}` : MAP_URL);
  const coords = ev.map_url?.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? ev.map_url?.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  const mapQuery = coords ? `${coords[1]},${coords[2]}` : ev.address?.en || ev.address?.ar || 'Villa Layla Hostel, 20 Safiya Zaghloul St, El Sayeda Zeinab, Cairo';
  const wa = `https://wa.me/201040551515?text=${encodeURIComponent((isAr ? 'أريد حجز: ' : 'I’d like to book: ') + tr(ev.title, 'en') + ' — Villa Layla')}`;

  return (
    <div className="vl-page min-h-screen flex flex-col">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <section className="evd-hero">
          <HeroMedia video={heroVideo} photos={heroPhotos} cover={ev.image} />
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
              <div className="evd-price"><dt>{isAr ? 'السعر' : 'Price'}</dt><dd>
                <span className="evd-pr-row"><b dir="ltr">{showPrice(ev.price_cents, ev.currency, view, lang)}</b> <small>{guestNote ? (isAr ? '/ للزوار من بره' : '/ visitors') : isAr ? '/ للشخص' : '/ person'}</small></span>
                {guestNote && <span className="evd-pr-row evd-pr-guest"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 10.5 12 3l9 7.5V21H3z" /><path d="M9 21v-6h6v6" /></svg>{isAr ? 'نزلاء فيلا ليلى: ' : 'Villa Layla guests: '}<b>{guestNote}</b></span>}
              </dd></div>
              <div><dt>{isAr ? 'المكان' : 'Where'}</dt><dd className="evd-where">
                <span>{address}</span>
                <a className="evd-map" href={mapUrl} target="_blank" rel="noopener noreferrer" aria-label={isAr ? 'افتح المكان على خرائط جوجل' : 'Open in Google Maps'} title={isAr ? 'افتح على خرائط جوجل' : 'Open in Google Maps'}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="10" r="2.6" /></svg>
                  <span>{isAr ? 'الخريطة' : 'Map'}</span>
                </a>
              </dd></div>
            </dl>
            {/* The place on a map (from the event's map link when it has coordinates, else its written address). */}
            <div className="evd-mapbox"><iframe src={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=16&output=embed`} title={isAr ? 'الخريطة' : 'Map'} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>

            <EventAbout isAr={isAr} text={tr(ev.description, lang) ?? ''} includes={ev.includes.map((x) => tr(x, lang)).filter(Boolean) as string[]} note={tr(ev.note, lang) ?? ''} />

            {stories.length > 0 && (
              <>
                <h2>{isAr ? 'ستوري الإيفنت' : 'Stories'}</h2>
                <StoryStrip stories={stories} ar={isAr} title={tr(ev.title, lang) ?? ''} />
              </>
            )}
          </div>

          <div className="evd-side">
          {breakfasts.length > 0 && !ev.dinner_cents
            ? <BreakfastPair ar={isAr} meals={breakfasts} />
            : ev.dinner_cents
            ? <WeekMenuCard ar={isAr} menu={dinnerMenu} dates={dates} initialDate={initialDate} today={todayLocal()} priceLabel={showPrice(ev.dinner_cents, ev.currency, view, lang)} />
            : (hasMenu || Object.values(dinnerMenu).some(Boolean)) && dates.length
              ? <WeekMenuCard ar={isAr} menu={dinnerMenu} dates={dates} initialDate={initialDate} today={todayLocal()} fallback={false} />
              : <MealGallery lang={lang} photos={meals.map((m) => ({ id: m.id, src: m.src, caption: m.caption }))} />}
          <aside className="evd-book" id="book" aria-labelledby="bookH">
            <h2 id="bookH">{isAr ? 'احجز تذكرتك' : 'Book your ticket'}</h2>
            {errMsg && <p role="alert" className="form-msg">{errMsg}</p>}
            {dates.length === 0 ? (
              // The event's dates are over (a one-off that already happened): no form with nothing to pick.
              <div className="evd-off">
                <p><b>{isAr ? 'مفيش مواعيد جاية دلوقتي' : 'No upcoming dates right now'}</b> · {isAr ? 'الفعالية دي خلصت. تابعنا أو اسألنا على واتساب عن الموعد الجاي.' : 'This event has taken place. Follow us or ask on WhatsApp about the next one.'}</p>
                <a className="btn btn-line" href={wa} target="_blank" rel="noopener noreferrer">{isAr ? 'اسأل على واتساب' : 'Ask on WhatsApp'}</a>
              </div>
            ) : dates.every((d) => d.left === 0) ? (
              <div className="evd-off">
                <p><b>{isAr ? 'نفدت التذاكر' : 'Sold out'}</b> · {isAr ? 'كل الأماكن في الأيام القادمة محجوزة. تابعنا للمواعيد الجديدة.' : 'Every place for the coming dates is taken. Follow us for the next dates.'}</p>
                <a className="btn btn-line" href={wa} target="_blank" rel="noopener noreferrer">{isAr ? 'اسأل على واتساب' : 'Ask on WhatsApp'}</a>
              </div>
            ) : ev.methods.length === 0 ? (
              <div className="evd-off">
                <p>{isAr ? 'الحجز أونلاين غير متاح لهذه الفعالية الآن. احجز مكانك على واتساب.' : 'Online booking isn’t open for this event right now. Reserve your place on WhatsApp.'}</p>
                <a className="btn btn-wa" href={wa} target="_blank" rel="noopener noreferrer">{isAr ? 'احجز على واتساب' : 'Book on WhatsApp'}</a>
              </div>
            ) : (
              <EventBooker
                lang={lang}
                slug={ev.slug}
                dates={dates}
                initialDate={initialDate}
                options={ev.options.map((o) => ({ key: o.key, label: isAr ? o.ar : o.en }))}
                priceCents={ev.price_cents}
                guestPriceCents={guestUnitCents(ev) ?? ev.guest_price_cents}
                guestPct={ev.guest_discount_pct ?? null}
                depositCents={ev.deposit_cents ?? null}
                dinnerCents={ev.dinner_cents ?? null}
                menu={ev.dinner_cents ? dinnerMenu : menu}
                currency={ev.currency}
                view={view}
                guestMode={guestModeOf(ev)}
                addons={addons}
                methods={ev.methods}
                wallets={{
                  instapay: { address: wallets.instapay.address, phone: wallets.instapay.phone, name: wallets.instapay.name, link: wallets.instapay.link },
                  vodafone_cash: { number: wallets.vodafone_cash.number, name: wallets.vodafone_cash.name },
                }}
              />
            )}
          </aside>
          </div>
        </div>
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
    </div>
  );
}
