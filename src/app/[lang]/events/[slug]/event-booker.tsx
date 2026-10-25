'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { bookEventAction } from '../actions';
import { MealLink, MealModal, DATE_EVENT, type DayMeal } from './meal-modal';
import { methodsFor } from '@/lib/event-pay';

type DateChip = { date: string; label: string; sub: string; left: number | null };
type Method = 'paymob' | 'instapay' | 'vodafone_cash' | 'cash';
type WalletInfo = { instapay: { address: string; phone: string; name: string; link: string }; vodafone_cash: { number: string; name: string } };

const fmt = (cents: number, cur: string, ar: boolean) => {
  const v = (cents / 100).toLocaleString(ar ? 'ar-EG-u-nu-latn' : 'en-US', { maximumFractionDigits: 2 });
  return ar && cur === 'EGP' ? `${v} ج.م` : `${cur} ${v}`;
};

const BOOK_ERR: Record<string, { ar: string; en: string }> = {
  no_availability: { ar: 'عذرًا، الأماكن المتبقية في هذا اليوم لا تكفي. اختر يومًا آخر أو عددًا أقل.', en: 'Sorry, there aren’t enough places left on that date. Pick another date or fewer tickets.' },
  invalid_dates: { ar: 'هذا اليوم لم يعد متاحًا. اختر يومًا آخر.', en: 'That date is no longer available. Please pick another one.' },
  'invalid_input:pay_method': { ar: 'طريقة الدفع دي مش متاحة. اختار طريقة تانية.', en: 'That payment method isn’t available. Choose another one.' },
  'invalid_input:option': { ar: 'من فضلك اختر نوع التذكرة.', en: 'Please choose an option.' },
  pwyw: { ar: 'اكتب المبلغ اللي حابب تدفعه للتذاكر (رقم، صفر أو أكتر).', en: 'Write how much you want to pay for the tickets (a number, 0 or more).' },
  rate_limit: { ar: 'محاولات كثيرة. انتظر دقائق وحاول مرة أخرى.', en: 'Too many attempts. Please wait a few minutes and try again.' },
  not_found: { ar: 'الفعالية دي مش متاحة للحجز دلوقتي.', en: 'This event isn’t open for booking right now.' },
  invalid_input: { ar: 'راجع بياناتك وحاول مرة أخرى.', en: 'Please check your details and try again.' },
};

function Submit({ label, busy, loading }: { label: string; busy: string; loading?: boolean }) {
  const { pending } = useFormStatus();
  const isBusy = pending || loading;
  return (
    <button type="submit" className={`btn btn-book evb-submit ${isBusy ? 'loading' : ''}`} disabled={isBusy} aria-busy={isBusy}>
      {isBusy ? busy : label}
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
  const [pwywStr, setPwywStr] = useState('');
  const [dinner, setDinner] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    if (method === 'paymob') return; // Paymob checkout runs via server action

    e.preventDefault();
    if (submitting) return;

    const form = e.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    setSubmitting(true);
    const fd = new FormData(form);

    const buildFallbackWa = () => {
      const num = '201040551515';
      const optObj = options.find((o) => o.key === option);
      const optText = optObj ? ` (${optObj.label})` : '';
      const when = chosen ? `${chosen.label} (${date})` : date;
      const payLabel = method === 'cash' ? (ar ? 'كاش في المكان' : 'Cash at the villa')
        : method === 'instapay' ? 'InstaPay'
        : method === 'vodafone_cash' ? (ar ? 'فودافون كاش' : 'Vodafone Cash') : method;
      const lines = (ar ? [
        'مرحباً فيلا ليلى 👋',
        'أرغب في تأكيد حجز فعالية:',
        `• الفعالية: ${slug}${optText}`,
        `• الموعد: ${when}`,
        `• عدد التذاكر: ${n}`,
        `• العشاء: ${dinner ? `نعم (${n} وجبة)` : 'لا'}`,
        hotelGuest ? `• نزيل بالفيلا · ادفع اللي تحبه${pwyw != null ? ` · سأدفع ${fmt(pwyw, currency, ar)}` : ''}` : '',
        `• الإجمالي: ${fmt(grand, currency, ar)}`,
        `• طريقة الدفع: ${payLabel}`,
        `• الاسم: ${String(fd.get('fullName') || '')}`,
        `• الموبايل: ${String(fd.get('phone') || '')}`,
        `• الإيميل: ${String(fd.get('email') || '')}`,
      ] : [
        'Hello Villa Layla 👋',
        'I would like to confirm an event booking:',
        `• Event: ${slug}${optText}`,
        `• When: ${when}`,
        `• Tickets: ${n}`,
        `• Dinner: ${dinner ? `Yes (${n} meal)` : 'No'}`,
        hotelGuest ? `• Hostel guest · pay what you want${pwyw != null ? ` · I will pay ${fmt(pwyw, currency, ar)}` : ''}` : '',
        `• Total: ${fmt(grand, currency, ar)}`,
        `• Payment: ${payLabel}`,
        `• Name: ${String(fd.get('fullName') || '')}`,
        `• Phone: ${String(fd.get('phone') || '')}`,
        `• Email: ${String(fd.get('email') || '')}`,
      ]).filter(Boolean).join(String.fromCharCode(10));
      return `https://wa.me/${num}?text=${encodeURIComponent(lines)}`;
    };

    setFormErr(null);
    try {
      const res = await fetch('/api/events/book', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json().catch(() => null);
      if (data?.ok && data?.waUrl) {
        window.location.href = data.waUrl;
        return;
      }
      // The booking was refused (sold out, date gone, missing amount…): say why and let them fix it.
      if (res.status >= 400 && res.status < 500 && data?.error) {
        const code = String(data.error);
        const msg = BOOK_ERR[code] ?? BOOK_ERR[code.split(':')[0]] ?? BOOK_ERR.invalid_input;
        setFormErr(ar ? msg.ar : msg.en);
        setSubmitting(false);
        return;
      }
    } catch (err) {
      console.error('[Event booking submit error]:', err);
    }

    // Server unreachable: still let the guest reach reception on WhatsApp with their details.
    window.location.href = buildFallbackWa();
  };
  const [mealOpen, setMealOpen] = useState(false);
  const closeMeal = useCallback(() => setMealOpen(false), []);
  const isMealOption = (label: string) => /عشاء|dinner|meal|وجبة/i.test(label);
  // An event can have both options like "game only" / "game + dinner" and the dinner add-on: keep them in step so
  // the price is right (picking "+ dinner" ticks the add-on, unticking the add-on goes back to the option without it).
  const hasDinner = dinnerCents != null && dinnerCents > 0;
  const mealOpt = hasDinner ? options.find((o) => isMealOption(o.label)) : undefined;
  const plainOpt = hasDinner ? options.find((o) => !isMealOption(o.label)) : undefined;
  const pickOption = (key: string) => {
    setOption(key);
    if (mealOpt) setDinner(key === mealOpt.key);
  };
  const toggleDinner = (on: boolean) => {
    setDinner(on);
    if (mealOpt && on) setOption(mealOpt.key);
    else if (mealOpt && !on && option === mealOpt.key && plainOpt) setOption(plainOpt.key);
  };
  useEffect(() => { if (mealOpt && option === mealOpt.key) setDinner(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Only hostel guests may pay at the villa; everyone else pays by InstaPay and is sent to WhatsApp.
  const shownMethods = methodsFor(methods, hotelGuest) as Method[];
  const [method, setMethod] = useState<Method>(shownMethods[0] ?? methods[0]);
  // Ticking / unticking "staying at the villa" picks the first method of the new list (guests: pay at the villa).
  useEffect(() => { if (shownMethods.length) setMethod(shownMethods[0]); }, [hotelGuest]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = dates.find((d) => d.date === date)?.left ?? null;
  const maxQty = Math.max(1, Math.min(20, left ?? 20));
  // Hostel guests: the ticket is pay what you want (at the villa); only the dinner, if chosen, has a price.
  const unit = hotelGuest ? 0 : priceCents;
  const dinnerEach = dinner && dinnerCents != null && dinnerCents > 0 ? dinnerCents : 0;
  const n = Math.min(qty, maxQty);
  // Hostel guest: the amount they want to pay for all the tickets (whole pounds; Arabic digits accepted).
  const pwywNum = Number(pwywStr.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,\s]/g, ''));
  const pwyw = hotelGuest && pwywStr.trim() !== '' && Number.isFinite(pwywNum) && pwywNum >= 0 ? Math.round(pwywNum * 100) : null;
  const total = (unit + dinnerEach) * n;
  const grand = total + (pwyw ?? 0);
  // Deposit events: only the deposit is sent now by InstaPay / Vodafone Cash; the rest is paid at the villa.
  const deposit = !hotelGuest && depositCents && (method === 'instapay' || method === 'vodafone_cash') ? Math.min(total, depositCents * Math.min(qty, maxQty)) : null;
  const chosen = useMemo(() => dates.find((d) => d.date === date), [dates, date]);
  // Weekly menu: the dishes of the chosen date's weekday (0 = Sunday).
  const dayMeal = date ? menu[new Date(date + 'T12:00:00Z').getUTCDay()] ?? null : null;
  const dayName = chosen?.label ?? null;
  // The meal card beside the booking box shows the chosen date's meal.
  useEffect(() => { if (date) window.dispatchEvent(new CustomEvent(DATE_EVENT, { detail: date })); }, [date]);

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
    <form action={bookEventAction} onSubmit={handleSubmit} className="evb">
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
                <input type="radio" name="option" value={o.key} checked={option === o.key} onChange={() => pickOption(o.key)} required />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        )}
        {options.some((o) => isMealOption(o.label)) && !(dinnerCents != null && dinnerCents > 0) && <MealLink ar={ar} meal={dayMeal} day={dayName} onOpen={() => setMealOpen(true)} />}
        <label className="evb-check">
          <input type="checkbox" name="hotelGuest" checked={hotelGuest} onChange={(e) => setHotelGuest(e.target.checked)} />
          <span>{ar ? 'أنا نازل في فيلا ليلى · ادفع اللي تحبه' : 'I’m staying at Villa Layla · pay what you want'}</span>
        </label>
        {hotelGuest && (
          <div className="evb-pwyw">
            <p className="evb-pwyw-msg">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" /></svg>
              <span>{ar
                ? <>استمتع بالإيفنت، ولو عجبك ادعمنا باللي تحس إنه مناسب.<br />مساهمتك بتساعدنا نفضل نعمل لحظات حلوة زي دي.</>
                : <>Enjoy the event, and if you love it, support us with whatever feels right.<br />Your contribution helps us keep creating more moments like this!</>}</span>
            </p>
            <label htmlFor="evb-pwyw">{ar ? `حابب تدفع كام للتذاكر؟ (${n === 1 ? 'لفرد واحد' : `عددكم ${n}`})` : `How much would you like to pay for the tickets? (${n} ${n === 1 ? 'person' : 'people'})`}</label>
            <div className="evb-pwyw-in">
              <input id="evb-pwyw" name="pwyw" required inputMode="numeric" pattern="[0-9٠-٩,\s]{1,9}" maxLength={9} dir="ltr" placeholder="0" value={pwywStr} onChange={(e) => setPwywStr(e.target.value)} />
              <span>{ar ? (currency === 'EGP' ? 'ج.م' : currency) : currency}</span>
            </div>
            <p className="evb-fine">{ar ? 'المبلغ للتذاكر كلها وبتدفعه في الفيلا. بنتأكد إنك نازل عندنا بالاسم والرقم، والعشاء بسعره العادي.' : 'It covers all the tickets and is paid at the villa. We check your stay by name and phone; dinner is at its normal price.'}</p>
          </div>
        )}
        {dinnerCents != null && dinnerCents > 0 && (
          <label className={`evb-addon ${dinner ? 'on' : ''}`}>
            <input type="checkbox" name="dinner" checked={dinner} onChange={(e) => toggleDinner(e.target.checked)} />
            <span className="evb-addon-t">
              <b>{(dayMeal && (ar ? dayMeal.title.ar || dayMeal.title.en : dayMeal.title.en || dayMeal.title.ar)) || (ar ? 'أضف العشاء' : 'Add dinner')}</b>
            </span>
            <span className="evb-addon-p num" dir="ltr">+{fmt(dinnerCents, currency, ar)}</span>
          </label>
        )}
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
        {depositCents != null && depositCents > 0 && (shownMethods.includes('instapay') || shownMethods.includes('vodafone_cash')) && (
          <p className="evb-fine">{ar ? `مع InstaPay أو فودافون كاش تدفع عربون ${fmt(depositCents, currency, ar)} للتذكرة الآن، والباقي في الفيلا يوم الإيفنت.` : `With InstaPay or Vodafone Cash you send a deposit of ${fmt(depositCents, currency, ar)} per ticket now, and pay the rest at the villa on the day.`}</p>
        )}
        {shownMethods.length === 0 && <p className="evb-fine">{ar ? 'الدفع أونلاين مش متاح دلوقتي. لو نازل في الفيلا علّم «أنا نازل في فيلا ليلى»، أو كلمنا على واتساب.' : 'Online payment isn’t available right now. If you are staying at the villa, tick “I’m staying at Villa Layla”, or message us on WhatsApp.'}</p>}
        <div className="evb-pay" role="radiogroup">
          {shownMethods.map((m) => (
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
              <b className={hotelGuest && pwyw == null ? '' : 'num'} dir={(hotelGuest && pwyw == null) || ar ? undefined : 'ltr'}>{hotelGuest ? (pwyw != null ? fmt(pwyw, currency, ar) : (ar ? 'ادفع اللي تحبه' : 'Pay what you want')) : fmt(unit * n, currency, ar)}</b>
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
            {hotelGuest && pwyw == null
              ? <b>{dinnerEach > 0 ? <><span className="num" dir={ar ? undefined : 'ltr'}>{fmt(total, currency, ar)}</span> {ar ? '+ اللي تحبه' : '+ what you want'}</> : (ar ? 'ادفع اللي تحبه' : 'Pay what you want')}</b>
              : <b className="num" dir={ar ? undefined : 'ltr'}>{fmt(grand, currency, ar)}</b>}
          </div>
          {deposit != null && deposit < total && <small>{ar ? `الآن ${fmt(deposit, currency, ar)} · في الفيلا ${fmt(total - deposit, currency, ar)}` : `Now ${fmt(deposit, currency, ar)} · at the villa ${fmt(total - deposit, currency, ar)}`}</small>}
        </div>
        {formErr && <p role="alert" className="form-msg evb-err">{formErr}</p>}
        <Submit
          label={method === 'paymob' ? (ar ? 'ادفع واحصل على التذكرة' : 'Pay & get ticket') : (ar ? 'تأكيد الحجز عبر واتساب' : 'Confirm booking on WhatsApp')}
          busy={ar ? 'جارٍ تحويلك لواتساب…' : 'Connecting to WhatsApp…'}
          loading={submitting}
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
