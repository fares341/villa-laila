'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { bookEventAction } from '../actions';
import { MealLink, MealModal, type DayMeal } from './meal-modal';

type DateChip = { date: string; label: string; sub: string; left: number | null };
type Method = 'paymob' | 'instapay' | 'vodafone_cash' | 'cash';
type WalletInfo = { instapay: { address: string; phone: string; name: string; link: string }; vodafone_cash: { number: string; name: string } };

const fmt = (cents: number, cur: string, ar: boolean) => {
  const v = (cents / 100).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-US', { maximumFractionDigits: 2 });
  return ar && cur === 'EGP' ? `${v} ج.م` : `${cur} ${v}`;
};

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn btn-book evb-submit ${pending ? 'loading' : ''}`} disabled={pending} aria-busy={pending}>
      {pending ? busy : label}
    </button>
  );
}

export function EventBooker(props: {
  lang: string; slug: string; dates: DateChip[]; initialDate: string;
  options: { key: string; label: string }[]; priceCents: number; guestPriceCents: number | null; depositCents?: number | null; dinnerCents?: number | null; menu?: Record<number, DayMeal | null>; currency: string; methods: Method[]; wallets?: WalletInfo;
}) {
  const { lang, slug, dates, options, priceCents, depositCents = null, dinnerCents = null, menu = {}, currency, methods } = props;
  const ar = lang === 'ar';
  const [date, setDate] = useState(props.initialDate);
  const [showAll, setShowAll] = useState(() => dates.findIndex((d) => d.date === props.initialDate) >= 6);
  const [qty, setQty] = useState(1);
  const [option, setOption] = useState(options[0]?.key ?? '');
  const [hotelGuest, setHotelGuest] = useState(false);
  const [dinner, setDinner] = useState(false);
  const [mealOpen, setMealOpen] = useState(false);
  const closeMeal = useCallback(() => setMealOpen(false), []);
  const isMealOption = (label: string) => /عشاء|dinner|meal|وجبة/i.test(label);
  const [method, setMethod] = useState<Method>(methods[0]);

  const left = dates.find((d) => d.date === date)?.left ?? null;
  const maxQty = Math.max(1, Math.min(20, left ?? 20));
  // Hostel guests: the ticket is pay what you want (at the villa); only the dinner, if chosen, has a price.
  const unit = hotelGuest ? 0 : priceCents;
  const dinnerEach = dinner && dinnerCents != null && dinnerCents > 0 ? dinnerCents : 0;
  const n = Math.min(qty, maxQty);
  const total = (unit + dinnerEach) * n;
  // Deposit events: only the deposit is sent now by InstaPay / Vodafone Cash; the rest is paid at the villa.
  const deposit = !hotelGuest && depositCents && (method === 'instapay' || method === 'vodafone_cash') ? Math.min(total, depositCents * Math.min(qty, maxQty)) : null;
  const chosen = useMemo(() => dates.find((d) => d.date === date), [dates, date]);
  // Weekly menu: the dishes of the chosen date's weekday (0 = Sunday).
  const dayMeal = date ? menu[new Date(date + 'T12:00:00Z').getUTCDay()] ?? null : null;
  const dayName = chosen?.label ?? null;

  const M: Record<Method, { t: string; d: string; icon: React.ReactNode }> = {
    paymob: {
      t: ar ? 'بطاقة أو محفظة إلكترونية' : 'Card or mobile wallet',
      d: ar ? 'فيزا، ماستركارد أو ميزة. دفع آمن عبر Paymob والتذكرة تصلك فورًا.' : 'Visa, Mastercard or Meeza. Secure checkout by Paymob, ticket instantly.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6 15h4" /></svg>,
    },
    instapay: {
      t: 'InstaPay',
      d: ar ? 'بعد ما تبعت رسالة الحجز على واتساب، الاستقبال هيبعتلك رقم InstaPay تحوّل عليه.' : 'After you send the booking message on WhatsApp, reception sends you the InstaPay details.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>,
    },
    vodafone_cash: {
      t: ar ? 'فودافون كاش' : 'Vodafone Cash',
      d: ar ? 'بعد ما تبعت رسالة الحجز على واتساب، الاستقبال هيبعتلك رقم فودافون كاش تحوّل عليه.' : 'After you send the booking message on WhatsApp, reception sends you the Vodafone Cash number.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>,
    },
    cash: {
      t: ar ? 'ادفع في المكان' : 'Pay at the villa',
      d: ar ? 'احجز مكانك الآن وادفع كاش عند الحضور.' : 'Reserve your place now and pay cash when you arrive.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>,
    },
  };

  return (
    <form action={bookEventAction} className="evb">
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="quantity" value={Math.min(qty, maxQty)} />
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hp" />

      <fieldset className="evb-step">
        <legend><span className="evb-n">1</span>{ar ? 'اختر اليوم' : 'Choose a date'}</legend>
        <div className="evb-dates" role="radiogroup" aria-label={ar ? 'اليوم' : 'Date'}>
          {(showAll ? dates : dates.slice(0, 6)).map((d) => {
            const full = d.left === 0;
            const on = d.date === date;
            return (
              <button
                type="button" key={d.date} role="radio" aria-checked={on} disabled={full}
                className={`evb-date ${on ? 'on' : ''}`} onClick={() => { setDate(d.date); setQty((q) => Math.min(q, Math.max(1, d.left ?? 20))); }}
              >
                <span className="evb-radio" aria-hidden />
                <span className="evb-date-t"><b>{d.label}</b><small>{d.sub}</small></span>
                <span className={`evb-date-s ${full ? 'full' : d.left != null && d.left <= 5 ? 'few' : ''}`}>
                  {full ? (ar ? 'مكتمل' : 'Full') : d.left != null && d.left <= 5 ? (ar ? `باقي ${d.left} أماكن` : `${d.left} left`) : (ar ? 'متاح' : 'Available')}
                </span>
              </button>
            );
          })}
        </div>
        {dates.length > 6 && (
          <button type="button" className="evb-more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? (ar ? 'أيام أقل' : 'Fewer dates') : (ar ? `أيام أكثر (${dates.length - 6})` : `More dates (${dates.length - 6})`)}
          </button>
        )}
      </fieldset>

      <fieldset className="evb-step">
        <legend><span className="evb-n">2</span>{ar ? 'عدد التذاكر' : 'Tickets'}</legend>
        <div className="evb-qty">
          <span>{ar ? 'عدد الأشخاص' : 'People'}</span>
          <div className="evb-stepper">
            <button type="button" aria-label={ar ? 'أقل' : 'Fewer'} onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>−</button>
            <output aria-live="polite" className="num">{Math.min(qty, maxQty)}</output>
            <button type="button" aria-label={ar ? 'أكثر' : 'More'} onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty}>+</button>
          </div>
        </div>
        {options.length > 0 && (
          <div className="evb-opts" role="radiogroup" aria-label={ar ? 'النوع' : 'Option'}>
            {options.map((o) => (
              <label key={o.key} className={`evb-opt ${option === o.key ? 'on' : ''}`}>
                <input type="radio" name="option" value={o.key} checked={option === o.key} onChange={() => setOption(o.key)} required />
                {o.label}
              </label>
            ))}
          </div>
        )}
        {options.some((o) => isMealOption(o.label)) && !(dinnerCents != null && dinnerCents > 0) && <MealLink ar={ar} meal={dayMeal} day={dayName} onOpen={() => setMealOpen(true)} />}
        <label className="evb-check">
          <input type="checkbox" name="hotelGuest" checked={hotelGuest} onChange={(e) => setHotelGuest(e.target.checked)} />
          <span>{ar ? 'أنا نازل في فيلا ليلى · التذكرة «ادفع اللي تحبه»' : 'I’m staying at Villa Layla · ticket is “pay what you want”'}</span>
        </label>
        {hotelGuest && <p className="evb-fine">{ar ? 'بنتأكد إنك نازل عندنا في الفيلا بالاسم والرقم. التذكرة بتدفع فيها اللي تحبه، والعشاء بسعره العادي.' : 'We check your stay at the villa with your name and phone. You pay what you want for the ticket; dinner is at its normal price.'}</p>}
        {dinnerCents != null && dinnerCents > 0 && (
          <label className={`evb-addon ${dinner ? 'on' : ''}`}>
            <input type="checkbox" name="dinner" checked={dinner} onChange={(e) => setDinner(e.target.checked)} />
            <span className="evb-addon-ic" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M6 13v8M17 3c-1.7 0-3 2-3 5s1.3 4 3 4v9" /></svg>
            </span>
            <span className="evb-addon-t">
              <b>{ar ? 'وجبة عشاء بيتي بجانب المسبح' : 'Home-cooked dinner by the pool'}</b>
              <small>{ar ? 'اختياري · للفرد' : 'Optional · per person'}</small>
            </span>
            <span className="evb-addon-p num" dir="ltr">+{fmt(dinnerCents, currency, ar)}</span>
          </label>
        )}
        {dinnerCents != null && dinnerCents > 0 && <MealLink ar={ar} meal={dayMeal} day={dayName} onOpen={() => setMealOpen(true)} />}
        {mealOpen && <MealModal ar={ar} meal={dayMeal} day={dayName} priceLabel={dinnerCents ? fmt(dinnerCents, currency, ar) : null} onClose={closeMeal} />}
      </fieldset>

      <fieldset className="evb-step">
        <legend><span className="evb-n">3</span>{ar ? 'بياناتك' : 'Your details'}</legend>
        <div className="evb-field"><label htmlFor="evb-name">{ar ? 'الاسم بالكامل' : 'Full name'}</label><input id="evb-name" name="fullName" required minLength={2} maxLength={80} autoComplete="name" /></div>
        <div className="evb-field"><label htmlFor="evb-email">{ar ? 'البريد الإلكتروني' : 'Email'}</label><input id="evb-email" name="email" type="email" required autoComplete="email" dir="ltr" /></div>
        <div className="evb-field"><label htmlFor="evb-phone">{ar ? 'رقم الموبايل / واتساب' : 'Mobile / WhatsApp'}</label><input id="evb-phone" name="phone" type="tel" required autoComplete="tel" dir="ltr" placeholder="+20 1xx xxx xxxx" /></div>
      </fieldset>

      <fieldset className="evb-step">
        <legend><span className="evb-n">4</span>{ar ? 'الدفع' : 'Payment'}</legend>
        {depositCents != null && depositCents > 0 && (methods.includes('instapay') || methods.includes('vodafone_cash')) && (
          <p className="evb-fine">{ar ? `مع InstaPay أو فودافون كاش تدفع عربون ${fmt(depositCents, currency, ar)} للتذكرة الآن، والباقي في الفيلا يوم الإيفنت.` : `With InstaPay or Vodafone Cash you send a deposit of ${fmt(depositCents, currency, ar)} per ticket now, and pay the rest at the villa on the day.`}</p>
        )}
        <div className="evb-pay" role="radiogroup">
          {methods.map((m) => (
            <label key={m} className={`evb-method ${method === m ? 'on' : ''}`}>
              <input type="radio" name="payMethod" value={m} checked={method === m} onChange={() => setMethod(m)} />
              <span className="ic">{M[m].icon}</span>
              <span><b>{M[m].t}</b><small>{M[m].d}</small></span>
            </label>
          ))}
        </div>
        {(method === 'instapay' || method === 'vodafone_cash') && (
          <div className="evb-wallet">
            {deposit != null && deposit < total && <p className="evb-fine"><b>{ar ? 'عربون فقط' : 'Deposit only'}</b>: {fmt(deposit, currency, ar)} · {ar ? 'الباقي' : 'the rest'} {fmt(total - deposit, currency, ar)} {ar ? 'تدفعه في الفيلا' : 'is paid at the villa'}.</p>}
            <p className="evb-fine">{ar ? `مفيش تحويل دلوقتي: بعد تأكيد الحجز هتتحول لواتساب الفيلا، والاستقبال هيرد عليك برقم ${method === 'instapay' ? 'InstaPay' : 'فودافون كاش'} والمبلغ.` : `Nothing to transfer now: after you confirm, you go to the villa’s WhatsApp and reception replies with the ${method === 'instapay' ? 'InstaPay' : 'Vodafone Cash'} details and the amount.`}</p>
          </div>
        )}
      </fieldset>

      <div className="evb-sum">
        <div>
          {/* Line by line: tickets, dinner, total (the server computes the same: (ticket + dinner) × people). */}
          {chosen && <small>{chosen.label} · {n} {ar ? (n === 1 ? 'فرد' : 'أفراد') : n === 1 ? 'person' : 'people'}</small>}
          <ul className="evb-lines">
            <li>
              <span>{ar ? 'التذاكر' : 'Tickets'}{!hotelGuest && <small> {ar ? `(${n} ${n === 1 ? 'فرد' : 'أفراد'})` : `${n} × ${fmt(unit, currency, ar)}`}</small>}</span>
              <b className={hotelGuest ? '' : 'num'} dir={hotelGuest || ar ? undefined : 'ltr'}>{hotelGuest ? (ar ? 'ادفع اللي تحبه' : 'Pay what you want') : fmt(unit * n, currency, ar)}</b>
            </li>
            {dinnerEach > 0 && (
              <li>
                <span>{ar ? 'العشاء' : 'Dinner'}<small> {ar ? `(${n} ${n === 1 ? 'فرد' : 'أفراد'})` : `${n} × ${fmt(dinnerEach, currency, ar)}`}</small></span>
                <b className="num" dir={ar ? undefined : 'ltr'}>{fmt(dinnerEach * n, currency, ar)}</b>
              </li>
            )}
          </ul>
          <div className="evb-total">
            <span>{ar ? 'الإجمالي' : 'Total'}</span>
            {hotelGuest
              ? <b>{dinnerEach > 0 ? <><span className="num" dir={ar ? undefined : 'ltr'}>{fmt(total, currency, ar)}</span> {ar ? '+ اللي تحبه' : '+ what you want'}</> : (ar ? 'ادفع اللي تحبه' : 'Pay what you want')}</b>
              : <b className="num" dir={ar ? undefined : 'ltr'}>{fmt(total, currency, ar)}</b>}
          </div>
          {deposit != null && deposit < total && <small>{ar ? `الآن ${fmt(deposit, currency, ar)} · في الفيلا ${fmt(total - deposit, currency, ar)}` : `Now ${fmt(deposit, currency, ar)} · at the villa ${fmt(total - deposit, currency, ar)}`}</small>}
        </div>
        <Submit
          label={method === 'paymob' ? (ar ? 'ادفع واحصل على التذكرة' : 'Pay & get ticket') : (ar ? 'تأكيد الحجز عبر واتساب' : 'Confirm booking on WhatsApp')}
          busy={ar ? 'جارٍ الحجز…' : 'Booking…'}
        />
      </div>
      {method !== 'paymob' && (
        <p className="evb-fine evb-wa-note">
          {ar ? 'بعد التأكيد يتسجل حجزك وتتحول لمحادثة واتساب الفيلا ' : 'Your booking is saved and you are taken to the villa’s WhatsApp '}
          (<bdi dir="ltr">+20 104 055 1515</bdi>)
          {ar ? ' والرسالة جاهزة ببياناتك، اضغط إرسال فقط.' : ' with a ready message — just press send.'}
        </p>
      )}
      <p className="evb-fine">{ar ? 'بالضغط على تأكيد الحجز توافق على سياسات فيلا ليلى. تذكرتك ورابطها بيوصلوك في رسالة واتساب.' : 'By booking you agree to Villa Layla’s policies. Your ticket link is in the WhatsApp message.'}</p>
    </form>
  );
}
