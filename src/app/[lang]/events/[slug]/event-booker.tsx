'use client';

import React, { useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { bookEventAction } from '../actions';

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
  options: { key: string; label: string }[]; priceCents: number; guestPriceCents: number | null; depositCents?: number | null; currency: string; methods: Method[]; wallets?: WalletInfo;
}) {
  const { lang, slug, dates, options, priceCents, guestPriceCents, depositCents = null, currency, methods, wallets } = props;
  const ar = lang === 'ar';
  const [date, setDate] = useState(props.initialDate);
  const [showAll, setShowAll] = useState(() => dates.findIndex((d) => d.date === props.initialDate) >= 6);
  const [qty, setQty] = useState(1);
  const [option, setOption] = useState(options[0]?.key ?? '');
  const [hotelGuest, setHotelGuest] = useState(false);
  const [method, setMethod] = useState<Method>(methods[0]);

  const left = dates.find((d) => d.date === date)?.left ?? null;
  const maxQty = Math.max(1, Math.min(20, left ?? 20));
  const unit = hotelGuest && guestPriceCents != null ? guestPriceCents : priceCents;
  const total = unit * Math.min(qty, maxQty);
  // Deposit events: only the deposit is sent now by InstaPay / Vodafone Cash; the rest is paid at the villa.
  const deposit = depositCents && (method === 'instapay' || method === 'vodafone_cash') ? Math.min(total, depositCents * Math.min(qty, maxQty)) : null;
  const chosen = useMemo(() => dates.find((d) => d.date === date), [dates, date]);

  const M: Record<Method, { t: string; d: string; icon: React.ReactNode }> = {
    paymob: {
      t: ar ? 'بطاقة أو محفظة إلكترونية' : 'Card or mobile wallet',
      d: ar ? 'فيزا، ماستركارد، ميزة، فودافون كاش… دفع آمن عبر Paymob والتذكرة تصلك فورًا.' : 'Visa, Mastercard, Meeza, Vodafone Cash… secure checkout by Paymob, ticket instantly.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6 15h4" /></svg>,
    },
    instapay: {
      t: 'InstaPay',
      d: ar ? 'حوّل على حساب InstaPay بتاعنا وارفع صورة الإيصال. بنأكد الحجز أول ما نراجع التحويل.' : 'Send the amount to our InstaPay account and upload the receipt. We confirm your booking as soon as we check it.',
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>,
    },
    vodafone_cash: {
      t: ar ? 'فودافون كاش' : 'Vodafone Cash',
      d: ar ? 'حوّل على رقم فودافون كاش بتاعنا وارفع صورة الإيصال. بنأكد الحجز أول ما نراجع التحويل.' : 'Send the amount to our Vodafone Cash number and upload the receipt. We confirm your booking as soon as we check it.',
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
        {guestPriceCents != null && (
          <label className="evb-check">
            <input type="checkbox" name="hotelGuest" checked={hotelGuest} onChange={(e) => setHotelGuest(e.target.checked)} />
            <span>{ar ? `أنا مقيم في فيلا ليلى (سعر النزلاء ${fmt(guestPriceCents, currency, ar)})` : `I’m staying at Villa Layla (guest price ${fmt(guestPriceCents, currency, ar)})`}</span>
          </label>
        )}
        {hotelGuest && (
          <div className="evb-field">
            <label htmlFor="evb-stay">{ar ? 'رقم حجز الإقامة' : 'Your booking reference'}</label>
            <input id="evb-stay" name="stayRef" required placeholder="VL-XXXXXX" dir="ltr" autoCapitalize="characters" maxLength={20} />
          </div>
        )}
      </fieldset>

      <fieldset className="evb-step">
        <legend><span className="evb-n">3</span>{ar ? 'بياناتك' : 'Your details'}</legend>
        <div className="evb-field"><label htmlFor="evb-name">{ar ? 'الاسم بالكامل' : 'Full name'}</label><input id="evb-name" name="fullName" required minLength={2} maxLength={80} autoComplete="name" /></div>
        <div className="evb-field"><label htmlFor="evb-email">{ar ? 'البريد الإلكتروني' : 'Email'}</label><input id="evb-email" name="email" type="email" required autoComplete="email" dir="ltr" /></div>
        <div className="evb-field"><label htmlFor="evb-phone">{ar ? 'رقم الموبايل / واتساب' : 'Mobile / WhatsApp'}</label><input id="evb-phone" name="phone" type="tel" required autoComplete="tel" dir="ltr" placeholder="+20 1xx xxx xxxx" /></div>
      </fieldset>

      <fieldset className="evb-step">
        <legend><span className="evb-n">4</span>{ar ? 'الدفع' : 'Payment'}</legend>
        <div className="evb-pay" role="radiogroup">
          {methods.map((m) => (
            <label key={m} className={`evb-method ${method === m ? 'on' : ''}`}>
              <input type="radio" name="payMethod" value={m} checked={method === m} onChange={() => setMethod(m)} />
              <span className="ic">{M[m].icon}</span>
              <span><b>{M[m].t}</b><small>{M[m].d}</small></span>
            </label>
          ))}
        </div>
        {(method === 'instapay' || method === 'vodafone_cash') && wallets && (
          <div className="evb-wallet">
            {deposit != null && deposit < total && <p className="evb-fine"><b>{ar ? 'عربون فقط الآن' : 'Deposit only now'}</b>: {fmt(deposit, currency, ar)} · {ar ? 'الباقي' : 'the rest'} {fmt(total - deposit, currency, ar)} {ar ? 'تدفعه في الفيلا' : 'is paid at the villa'}.</p>}
            <p className="evb-wallet-h">{ar ? 'حوّل' : 'Send'} <b dir="ltr">{fmt(deposit ?? total, currency, ar)}</b> {method === 'instapay' ? (ar ? 'على InstaPay:' : 'by InstaPay to:') : (ar ? 'على فودافون كاش:' : 'by Vodafone Cash to:')}</p>
            <dl>
              {method === 'instapay' && wallets.instapay.address && <div><dt>{ar ? 'العنوان' : 'Address'}</dt><dd dir="ltr" className="sel">{wallets.instapay.address}</dd></div>}
              {method === 'instapay' && wallets.instapay.phone && <div><dt>{ar ? 'الرقم' : 'Number'}</dt><dd dir="ltr" className="sel">{wallets.instapay.phone}</dd></div>}
              {method === 'vodafone_cash' && <div><dt>{ar ? 'الرقم' : 'Number'}</dt><dd dir="ltr" className="sel">{wallets.vodafone_cash.number}</dd></div>}
              <div><dt>{ar ? 'باسم' : 'Name'}</dt><dd>{method === 'instapay' ? wallets.instapay.name : wallets.vodafone_cash.name}</dd></div>
            </dl>
            {method === 'instapay' && wallets.instapay.link && <a className="btn btn-line btn-sm" href={wallets.instapay.link} target="_blank" rel="noopener noreferrer">{ar ? 'افتح رابط InstaPay' : 'Open InstaPay link'}</a>}
            <div className="evb-field">
              <label htmlFor="evb-proof">{ar ? 'صورة الإيصال' : 'Receipt screenshot'}</label>
              <input id="evb-proof" name="proof" type="file" accept="image/*,application/pdf" required />
            </div>
            <div className="evb-field">
              <label htmlFor="evb-ref">{ar ? 'رقم العملية (لو موجود)' : 'Transaction number (if shown)'}</label>
              <input id="evb-ref" name="payerRef" dir="ltr" maxLength={60} />
            </div>
            <p className="evb-fine">{ar ? 'الحجز بيتأكد بعد ما نراجع التحويل، وبيوصلك تأكيد على واتساب.' : 'Your booking is confirmed once we check the transfer, and you get the confirmation on WhatsApp.'}</p>
          </div>
        )}
      </fieldset>

      <div className="evb-sum">
        <div>
          <small>{chosen ? `${chosen.label} · ${Math.min(qty, maxQty)} × ${fmt(unit, currency, ar)}` : ''}</small>
          <b className="num" dir="ltr">{fmt(total, currency, ar)}</b>
        </div>
        <Submit
          label={method === 'paymob' ? (ar ? 'ادفع واحصل على التذكرة' : 'Pay & get ticket') : method === 'instapay' || method === 'vodafone_cash' ? (ar ? 'ابعت الحجز والإيصال' : 'Send booking & receipt') : (ar ? 'احجز مكاني' : 'Reserve my place')}
          busy={ar ? 'جارٍ الحجز…' : 'Booking…'}
        />
      </div>
      <p className="evb-fine">{ar ? 'بالضغط على الحجز توافق على سياسات فيلا ليلى. تذكرتك تُرسل لك بعد الدفع ويمكنك فتحها في أي وقت من الرابط.' : 'By booking you agree to Villa Layla’s policies. Your ticket opens right after payment and stays available from its link.'}</p>
    </form>
  );
}
