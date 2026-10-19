import { notFound } from 'next/navigation';
import { dict, isSiteLang, fill } from '@/i18n/site';
import { SearchBar, Img, money, nm } from '@/components/site';
import { availabilityFor } from '@/services/availability';
import { validateStay, todayLocal } from '@/lib/dates';
import { getSetting } from '@/services/settings';
import { activeRules, requiredFacts } from '@/services/policy';
import { submitBooking } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Book' };

export default async function Book({ params, searchParams }: { params: Promise<{ lang: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const sp = await searchParams;
  const d = dict(lang);
  const guests = Math.max(1, Math.min(40, parseInt(sp.guests ?? '2', 10) || 2));
  const maxNights = await getSetting<number>('max_nights');
  const check = sp.checkIn && sp.checkOut ? validateStay(sp.checkIn, sp.checkOut, todayLocal(), maxNights) : null;
  const err = sp.error ? ((d.book.errors as any)[sp.error] ?? d.book.errors.generic) : null;
  const cur = await getSetting<string>('currency');
  const avail = check?.ok ? await availabilityFor(sp.checkIn!, sp.checkOut!, guests) : [];
  const reqFacts = requiredFacts(await activeRules());
  const needNationality = reqFacts.includes('nationality');
  const needGov = reqFacts.includes('id_governorate');
  const nights = check?.ok ? avail[0]?.nights ?? 0 : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-14">
      <h1 className="text-5xl text-lapis-800">{d.book.title}</h1>
      <p className="mt-3 text-lg text-lapis-600">{d.book.subtitle}</p>
      <div className="mt-8"><SearchBar lang={lang} compact room={sp.room} defaults={{ checkIn: sp.checkIn, checkOut: sp.checkOut, guests }} /></div>

      {err && <p role="alert" className="mt-6 rounded-xl bg-bloom-50 p-4 text-bloom-700">{err}</p>}
      {check && !check.ok && <p role="alert" className="mt-6 rounded-xl bg-bloom-50 p-4 text-bloom-700">{(d.book.errors as any)[check.code === 'order' ? 'invalid_dates' : check.code === 'past' ? 'past_date' : check.code === 'too_long' ? 'too_long' : 'invalid_dates']}</p>}

      {check?.ok && (
        <form action={submitBooking} className="mt-10">
          <input type="hidden" name="lang" value={lang} /><input type="hidden" name="checkIn" value={sp.checkIn} />
          <input type="hidden" name="checkOut" value={sp.checkOut} /><input type="hidden" name="guests" value={guests} />
          <p className="font-medium text-lapis-800">{fill(d.book.results, { checkin: sp.checkIn!, checkout: sp.checkOut!, nights, guests })}</p>
          <fieldset className="mt-4 grid gap-4">
            <legend className="sr-only">{d.book.title}</legend>
            {[...avail].sort((x, y) => Number(y.code === sp.room) - Number(x.code === sp.room)).map((a) => (
              <label key={a.roomTypeId} className={`grid grid-cols-[auto_4.5rem_1fr] items-center gap-3 sm:gap-4 rounded-2xl border-2 bg-white p-3 sm:p-4 sm:grid-cols-[auto_7rem_1fr_auto] ${a.canFit && !a.priceMissing ? 'cursor-pointer border-transparent has-[:checked]:border-bloom-600' : 'border-transparent opacity-55'}`}>
                <input type="radio" name="roomTypeId" value={a.roomTypeId} required defaultChecked={sp.room === a.code && a.canFit && !a.priceMissing} disabled={!a.canFit || a.priceMissing} className="h-5 w-5 shrink-0 accent-bloom-600" />
                <Img src={a.photos[0]} alt={nm(a.name, lang)} w={300} className="aspect-[4/3] w-full rounded-xl shrink-0" />
                <span className="min-w-0">
                  <span className="kufi block text-lg sm:text-xl font-semibold text-lapis-800 break-words">{nm(a.name, lang)}</span>
                  <span className="mt-1 block text-xs sm:text-sm text-lapis-600">{a.kind === 'dorm' ? `${d.v2.who[a.gender as 'mixed']} · ${fill(d.book.bedsNeeded, { n: guests })}` : nm(a.details?.bed, lang)}</span>
                  {!a.canFit && <span className="mt-1 block text-sm font-medium text-bloom-700">{d.v2.soldOut}</span>}
                  {a.canFit && a.priceMissing && <span className="mt-1 block text-sm text-lapis-600">{d.v2.onRequest}</span>}
                  <span className="mt-2 block sm:hidden">{a.canFit && a.totalCents != null && <b className="text-base sm:text-lg text-lapis-800">{money(a.totalCents, cur, lang)}</b>}</span>
                </span>
                <span className="hidden text-end sm:block">
                  {a.canFit && a.totalCents != null && <><span className="block text-xs text-lapis-600">{d.book.total}</span><span className="kufi text-2xl font-semibold text-lapis-800">{money(a.totalCents, cur, lang)}</span>{a.demoPrice && <span className="mt-1 block text-[11px] font-medium text-amber-800">{d.v2.sample}</span>}</>}
                </span>
              </label>
            ))}
          </fieldset>

          {avail.some((a) => a.canFit && !a.priceMissing) && (
            <section className="mt-10 rounded-2xl sm:rounded-3xl bg-white p-4 sm:p-8">
              <h2 className="text-xl sm:text-2xl font-semibold text-lapis-800">{d.book.form.title}</h2>
              <div className="mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2">
                <div className="min-w-0"><label className="v-label" htmlFor="fn">{d.book.form.fullName}</label><input id="fn" name="fullName" required minLength={2} maxLength={80} autoComplete="name" className="v-field" /></div>
                <div className="min-w-0"><label className="v-label" htmlFor="em">{d.book.form.email}</label><input id="em" name="email" type="email" required autoComplete="email" className="v-field" dir="ltr" /></div>
                <div className="min-w-0"><label className="v-label" htmlFor="ph">{d.book.form.phone}</label><input id="ph" name="phone" type="tel" autoComplete="tel" className="v-field" dir="ltr" /></div>
                {needNationality && <div className="min-w-0"><label className="v-label" htmlFor="na">{d.book.form.nationality}</label><input id="na" name="nationality" required className="v-field" /></div>}
                {needNationality && needGov && <div className="min-w-0"><label className="v-label" htmlFor="gv">{d.book.form.idGovernorate}</label><input id="gv" name="idGovernorate" className="v-field" /></div>}
                <div className="min-w-0 sm:col-span-2"><label className="v-label" htmlFor="no">{d.book.form.notes}</label><textarea id="no" name="notes" rows={3} maxLength={500} className="v-field" /></div>
              </div>
              <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
              <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{d.book.note}</p>
              <button className="v-btn v-btn-primary mt-5 w-full sm:w-auto" type="submit">{d.book.form.submit}</button>
            </section>
          )}
        </form>
      )}
    </div>
  );
}
