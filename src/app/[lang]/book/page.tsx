import { notFound } from 'next/navigation';
import { dict, isSiteLang, fill } from '@/i18n/site';
import { Img, money, nm } from '@/components/site';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs } from '@/components/claude-shell';
import { availabilityFor } from '@/services/availability';
import { validateStay, todayLocal, addDays } from '@/lib/dates';
import { getSetting } from '@/services/settings';
import { activeRules, requiredFacts } from '@/services/policy';
import { paymobEnabled } from '@/services/paymob';
import { getWallets, walletOn } from '@/services/wallets';
import { BookingSteps } from '@/components/booking-steps';
import { BookingDetails } from './booking-details';
import { countryOptions } from '@/content/countries';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Book' };

export default async function Book({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const sp = await searchParams;
  const d = dict(lang);
  const ar = lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);

  // Accept both the old (checkIn/checkOut) and the home search (arrive/depart) parameter names.
  const checkIn = sp.checkIn || sp.arrive;
  const checkOut = sp.checkOut || sp.depart;
  const guests = Math.max(1, Math.min(40, parseInt(sp.guests ?? '2', 10) || 2));
  const maxNights = await getSetting<number>('max_nights');
  const today = todayLocal();
  const check = checkIn && checkOut ? validateStay(checkIn, checkOut, today, maxNights) : null;
  const err = sp.error ? ((d.book.errors as any)[sp.error] ?? d.book.errors.generic) : null;
  const cur = await getSetting<string>('currency');
  const avail = check?.ok ? await availabilityFor(checkIn!, checkOut!, guests) : [];
  const reqFacts = requiredFacts(await activeRules());
  const nights = check?.ok ? avail[0]?.nights ?? 0 : 0;
  const selected = check?.ok && sp.room ? avail.find((a) => a.code === sp.room && a.canFit && !a.priceMissing) : undefined;
  const step = !check?.ok ? 1 : !selected ? 2 : 3;
  const qs = (extra: Record<string, string>) => new URLSearchParams({ checkIn: checkIn ?? '', checkOut: checkOut ?? '', guests: String(guests), ...extra }).toString();

  const methods = [
    ...(paymobEnabled(cur) ? (['paymob'] as const) : []),
    ...(walletOn(await getWallets(), 'instapay', cur) ? (['instapay'] as const) : []),
    'hostel' as const,
  ];

  const dateErr = check && !check.ok
    ? (d.book.errors as any)[check.code === 'order' ? 'invalid_dates' : check.code === 'past' ? 'past_date' : check.code === 'too_long' ? 'too_long' : 'invalid_dates']
    : null;

  return (
    <div className="vl-page min-h-screen flex flex-col">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <div className="wrap bk">
          <header className="bk-hd">
            <span className="kicker">{L('Book direct', 'احجز مباشرة')}</span>
            <h1>{d.book.title}</h1>
            <p>{L('Best rate when you book with us. Four quick steps.', 'أفضل سعر عند الحجز المباشر. أربع خطوات سريعة.')}</p>
          </header>

          <BookingSteps lang={lang} current={step} />

          {/* STEP 1 — dates */}
          <form method="get" action={`/${lang}/book`} className="search bk-search" aria-label={L('Dates and guests', 'التواريخ والضيوف')}>
            {sp.room && <input type="hidden" name="room" value={sp.room} />}
            <div className="sf"><label htmlFor="bk-in">{d.search.checkin}</label><input id="bk-in" name="checkIn" type="date" required min={today} defaultValue={checkIn ?? addDays(today, 1)} /></div>
            <div className="sf"><label htmlFor="bk-out">{d.search.checkout}</label><input id="bk-out" name="checkOut" type="date" required min={addDays(today, 1)} defaultValue={checkOut ?? addDays(today, 3)} /></div>
            <div className="sf"><label htmlFor="bk-g">{d.search.guests}</label>
              <select id="bk-g" name="guests" defaultValue={String(guests)}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <button className="btn btn-book" type="submit">{step === 1 ? d.search.check : L('Update', 'تحديث')}</button>
          </form>

          {err && <p role="alert" className="form-msg bk-msg">{err}</p>}
          {dateErr && <p role="alert" className="form-msg bk-msg">{dateErr}</p>}

          {/* STEP 2 — room */}
          {check?.ok && !selected && (
            <section className="bk-sec" aria-labelledby="bk-rooms">
              <h2 id="bk-rooms">{L('Choose your room', 'اختر غرفتك')}</h2>
              <p className="bk-sub">{fill(d.book.results, { checkin: checkIn!, checkout: checkOut!, nights, guests })}</p>
              <div className="bk-rooms">
                {[...avail]
                  .sort((x, y) => Number(y.canFit && !y.priceMissing) - Number(x.canFit && !x.priceMissing))
                  .map((a) => {
                    const ok = a.canFit && !a.priceMissing;
                    return (
                      <article key={a.roomTypeId} className={`bk-room ${ok ? '' : 'off'}`}>
                        <Img src={a.photos[0]} alt={nm(a.name, lang)} w={600} className="bk-room-img" />
                        <div className="bk-room-b">
                          <span className="meta">{a.kind === 'dorm' ? `${(d.v2.who as any)[a.gender] ?? ''} · ${fill(d.book.bedsNeeded, { n: guests })}` : nm(a.details?.bed, lang)}</span>
                          <h3>{nm(a.name, lang)}</h3>
                          {!a.canFit && <span className="bk-flag">{d.v2.soldOut}</span>}
                          {a.canFit && a.priceMissing && <span className="bk-flag">{d.v2.onRequest}</span>}
                        </div>
                        <div className="bk-room-p">
                          {ok && a.totalCents != null && (
                            <>
                              <small>{fill(L('{n} night(s) total', 'إجمالي {n} ليلة'), { n: nights })}</small>
                              <b className="num" dir="ltr">{money(a.totalCents, cur, lang)}</b>
                              {a.demoPrice && <small className="bk-demo">{d.v2.sample}</small>}
                              <a className="btn btn-primary btn-sm" href={`/${lang}/book?${qs({ room: a.code })}#details`}>{L('Select', 'اختر')}</a>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
              </div>
              {!avail.some((a) => a.canFit && !a.priceMissing) && (
                <p className="bk-empty">{L('Nothing is free for these dates online. Try other dates or message us on WhatsApp.', 'لا يوجد متاح أونلاين في هذه التواريخ. جرّب تواريخ أخرى أو راسلنا على واتساب.')}{' '}
                  <a href="https://wa.me/201040551515" target="_blank" rel="noopener noreferrer">WhatsApp</a></p>
              )}
            </section>
          )}

          {/* STEP 3 + 4 — details and payment */}
          {selected && (
            <section className="bk-sec" id="details" aria-labelledby="bk-det">
              <div className="bk-chosen">
                <Img src={selected.photos[0]} alt={nm(selected.name, lang)} w={300} className="bk-chosen-img" />
                <div>
                  <small>{L('Your room', 'غرفتك')}</small>
                  <h2 id="bk-det">{nm(selected.name, lang)}</h2>
                  <p dir="ltr" className="num">{checkIn} → {checkOut} · {nights} {L('night(s)', 'ليلة')} · {guests} {L('guest(s)', 'ضيف')}</p>
                </div>
                <div className="bk-chosen-p">
                  <b className="num" dir="ltr">{money(selected.totalCents!, cur, lang)}</b>
                  <a href={`/${lang}/book?${qs({})}`}>{L('Change room', 'غيّر الغرفة')}</a>
                </div>
              </div>
              <BookingDetails
                lang={lang}
                checkIn={checkIn!} checkOut={checkOut!} guests={guests}
                roomTypeId={selected.roomTypeId} roomCode={selected.code}
                total={money(selected.totalCents!, cur, lang)}
                needNationality={reqFacts.includes('nationality')}
                needGov={reqFacts.includes('nationality') && reqFacts.includes('id_governorate')}
                methods={methods}
                mixedDorm={selected.kind === 'dorm' && selected.gender === 'mixed'}
                countries={countryOptions(lang, { excludeArab: selected.kind === 'dorm' && selected.gender === 'mixed' })}
                labels={{
                  fullName: d.book.form.fullName, email: d.book.form.email, phone: d.book.form.phone,
                  nationality: d.book.form.nationality, idGovernorate: d.book.form.idGovernorate, notes: d.book.form.notes,
                }}
              />
            </section>
          )}
        </div>
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
    </div>
  );
}
