'use client';

import React, { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitBooking } from './actions';
import { EG_GOVERNORATES } from '@/content/countries';

type Method = 'paymob' | 'instapay' | 'hostel';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={`btn btn-book ${pending ? 'loading' : ''}`} disabled={pending} aria-busy={pending}>{pending ? busy : label}</button>;
}

export function BookingDetails(p: {
  lang: string; checkIn: string; checkOut: string; guests: number; roomTypeId: string; roomCode: string; total: string;
  /** The amount actually charged, in EGP, when the visitor sees another currency (Paymob charges EGP). */
  totalEgp?: string | null;
  /** Paid online by Paymob: only the deposit; the rest is collected at the hotel. */
  deposit?: { pct: number; now: string; nowEgp: string; atHotel: string };
  needNationality: boolean; needGov: boolean; methods: Method[];
  /** Countries the guest may pick (Arab countries are left out for a mixed dorm). */
  countries: { code: string; name: string }[]; mixedDorm: boolean;
  /** Every country, for the address (Country/Region). */
  allCountries: { code: string; name: string }[];
  /** Cancellation and deposit terms from the booking engine. */
  terms?: { cancellation: string | null; deposit: string | null } | null;
  labels: { fullName: string; email: string; phone: string; nationality: string; idGovernorate: string; notes: string };
}) {
  const ar = p.lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const [stage, setStage] = useState<'details' | 'payment'>('details');
  const [method, setMethod] = useState<Method>(p.methods[0]);
  const [nat, setNat] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const checkConfirm = () => {
    const c = confirmRef.current; if (!c) return;
    c.setCustomValidity(c.value && emailRef.current && c.value.trim().toLowerCase() !== emailRef.current.value.trim().toLowerCase() ? L('The two e-mails are not the same', 'الإيميلين مش زي بعض') : '');
  };
  const times = ['', ...Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)];
  const detailsRef = useRef<HTMLFieldSetElement>(null);

  const go = (s: 'details' | 'payment') => {
    setStage(s);
    document.getElementById('bk-steps')?.setAttribute('data-current', s === 'payment' ? '4' : '3');
    document.getElementById('details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const next = () => {
    const inputs = Array.from(detailsRef.current?.querySelectorAll('input, textarea, select') ?? []) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[];
    checkConfirm();
    for (const el of inputs) if (!el.checkValidity()) { el.reportValidity(); return; }
    go('payment');
  };

  const M: Record<Method, { t: string; d: string }> = {
    paymob: { t: L('Card or mobile wallet', 'بطاقة أو محفظة إلكترونية'), d: L('Visa, Mastercard, Meeza, wallets — secure checkout by Paymob. You pay the deposit now and the rest at the hotel.', 'فيزا، ماستركارد، ميزة، المحافظ — دفع آمن عبر Paymob. بتدفع العربون دلوقتي والباقي في الفندق.') },
    instapay: { t: 'InstaPay', d: L('Transfer from your bank app. We show you the InstaPay address on the next page.', 'حوّل من تطبيق البنك. هتلاقي عنوان InstaPay في الصفحة الجاية.') },
    hostel: { t: L('Pay at the villa', 'ادفع عند الوصول'), d: L('Send the request now and pay at check-in. Reception confirms your booking.', 'أرسل الطلب الآن وادفع عند تسجيل الوصول. الاستقبال يؤكد حجزك.') },
  };

  return (
    <form action={submitBooking} className="bk-form">
      <input type="hidden" name="lang" value={p.lang} />
      <input type="hidden" name="checkIn" value={p.checkIn} />
      <input type="hidden" name="checkOut" value={p.checkOut} />
      <input type="hidden" name="guests" value={p.guests} />
      <input type="hidden" name="roomTypeId" value={p.roomTypeId} />
      <input type="hidden" name="room" value={p.roomCode} />
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hp" />

      <fieldset ref={detailsRef} className="evb-step" hidden={stage !== 'details'}>
        <legend><span className="evb-n">3</span>{L('Your details', 'بياناتك')}</legend>
        <div className="bk-fields">
          <div className="evb-field"><label htmlFor="fn">{L('First name', 'الاسم الأول')}</label><input id="fn" name="firstName" required minLength={1} maxLength={40} autoComplete="given-name" /></div>
          <div className="evb-field"><label htmlFor="ln">{L('Last name', 'اسم العائلة')}</label><input id="ln" name="lastName" required minLength={1} maxLength={40} autoComplete="family-name" /></div>
          <div className="evb-field"><label htmlFor="em">{p.labels.email}</label><input id="em" ref={emailRef} name="email" type="email" required autoComplete="email" dir="ltr" onChange={checkConfirm} /></div>
          <div className="evb-field"><label htmlFor="em2">{L('Confirm e-mail', 'تأكيد الإيميل')}</label><input id="em2" ref={confirmRef} name="emailConfirm" type="email" required autoComplete="email" dir="ltr" onChange={checkConfirm} onPaste={(e) => e.preventDefault()} /></div>
          <div className="evb-field"><label htmlFor="ph">{L('Phone', 'رقم الموبايل')}</label><input id="ph" name="phone" type="tel" required minLength={6} maxLength={30} autoComplete="tel" dir="ltr" /></div>
          <div className="evb-field"><label htmlFor="ad1">{L('Address', 'العنوان')}</label><input id="ad1" name="address1" required maxLength={120} autoComplete="address-line1" /></div>
          <div className="evb-field"><label htmlFor="ad2">{L('Address (additional line)', 'العنوان (سطر إضافي)')} <small>{L('optional', 'اختياري')}</small></label><input id="ad2" name="address2" maxLength={120} autoComplete="address-line2" /></div>
          <div className="evb-field"><label htmlFor="ci2">{L('City', 'المدينة')}</label><input id="ci2" name="city" required maxLength={60} autoComplete="address-level2" /></div>
          <div className="evb-field"><label htmlFor="st">{L('State', 'الولاية / المحافظة')} <small>{L('optional', 'اختياري')}</small></label><input id="st" name="state" maxLength={60} autoComplete="address-level1" /></div>
          <div className="evb-field"><label htmlFor="pc">{L('Post code', 'الرمز البريدي')}</label><input id="pc" name="postcode" required maxLength={20} autoComplete="postal-code" dir="ltr" /></div>
          <div className="evb-field"><label htmlFor="cr">{L('Country/Region', 'الدولة/المنطقة')}</label>
            <select id="cr" name="country" required defaultValue="" autoComplete="country">
              <option value="" disabled>{L('Select a country...', 'اختر الدولة...')}</option>
              {p.allCountries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          {p.needNationality && (
            <div className="evb-field"><label htmlFor="na">{p.labels.nationality}</label>
              <select id="na" name="nationality" required value={nat} onChange={(e) => setNat(e.target.value)}>
                <option value="" disabled>{L('Choose your country', 'اختر دولتك')}</option>
                {p.countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
          )}
          {p.needGov && nat === 'EG' && (
            <div className="evb-field"><label htmlFor="gv">{p.labels.idGovernorate}</label>
              <select id="gv" name="idGovernorate" required defaultValue="">
                <option value="" disabled>{L('Choose the governorate', 'اختر المحافظة')}</option>
                {EG_GOVERNORATES.map((g) => <option key={g.value} value={g.value}>{ar ? g.ar : g.en}</option>)}
              </select>
            </div>
          )}
          <p className="evb-fine wide">{L('Help us ensure a warm welcome and smooth check-in at your arrival.', 'ساعدنا نستقبلك كويس ونخلّص تسجيل الوصول بسرعة.')}</p>
          <div className="evb-field"><label htmlFor="at">{L('Planned arrival time?', 'ميعاد وصولك المتوقع؟')}</label>
            <select id="at" name="arrivalTime" defaultValue="">
              {times.map((t) => <option key={t || 'x'} value={t}>{t || L('Select time', 'اختر الوقت')}</option>)}
            </select>
          </div>
          <div className="evb-field wide"><label htmlFor="no">{L('Any personal requests?', 'أي طلبات خاصة؟')}</label><textarea id="no" name="notes" rows={3} maxLength={500} /></div>
          <p className="evb-fine wide">{L('For security purposes, please do not enter your credit card details on this page.', 'لأمانك، متكتبش بيانات الكارت في الصفحة دي.')}</p>
        </div>
        <div className="bk-nav">
          <button type="button" className="btn btn-primary" onClick={next}>{L('Continue to payment', 'متابعة للدفع')}</button>
        </div>
      </fieldset>

      <fieldset className="evb-step" hidden={stage !== 'payment'}>
        <legend><span className="evb-n">4</span>{L('Payment', 'الدفع')}</legend>
        <div className="evb-pay" role="radiogroup">
          {p.methods.map((m) => (
            <label key={m} className={`evb-method ${method === m ? 'on' : ''}`}>
              <input type="radio" name="payMethod" value={m} checked={method === m} onChange={() => setMethod(m)} />
              <span><b>{M[m].t}</b><small>{M[m].d}</small></span>
            </label>
          ))}
        </div>
        <div className="evb-sum">
          {method === 'paymob' && p.deposit ? (
            <div>
              <small>{L('Total for your stay', 'إجمالي الإقامة')}: <span dir="ltr">{p.total}</span></small>
              <small className="bk-dep">{L(`Pay now (${p.deposit.pct}% deposit)`, `ادفع الآن (عربون ${p.deposit.pct}%)`)}</small>
              <b className="num" dir="ltr">{p.deposit.now}</b>
              {p.totalEgp && <small className="bk-egp">{L(`Charged in Egyptian pounds: ${p.deposit.nowEgp}`, `بيتدفع بالجنيه المصري: ${p.deposit.nowEgp}`)}</small>}
              <small className="bk-egp">{L(`The rest, ${p.deposit.atHotel}, is paid at the hotel.`, `الباقي ${p.deposit.atHotel} بيتدفع في الفندق.`)}</small>
            </div>
          ) : (
            <div><small>{L('Total for your stay', 'إجمالي الإقامة')}</small><b className="num" dir="ltr">{p.total}</b>{p.totalEgp && <small className="bk-egp">{L(`Charged in Egyptian pounds: ${p.totalEgp}`, `بيتدفع بالجنيه المصري: ${p.totalEgp}`)}</small>}</div>
          )}
          <Submit
            label={method === 'paymob' ? (p.deposit ? L('Pay deposit', 'ادفع العربون') : L('Pay now', 'ادفع الآن')) : method === 'instapay' ? L('Book & pay with InstaPay', 'احجز وادفع بـ InstaPay') : L('Send booking request', 'أرسل طلب الحجز')}
            busy={L('Booking…', 'جارٍ الحجز…')}
          />
        </div>
        <div className="bk-nav">
          <button type="button" className="btn btn-line" onClick={() => go('details')}>{L('Back', 'رجوع')}</button>
        </div>
        {p.terms && (p.terms.cancellation || p.terms.deposit) && <p className="evb-fine">{[p.terms.cancellation, p.terms.deposit].filter(Boolean).join(' · ')}</p>}
        <p className="evb-fine">{method === 'paymob'
          ? L('After you pay, reception reviews your booking and confirms it by e-mail and WhatsApp. If it can’t be confirmed, the payment is refunded.', 'بعد الدفع، الاستقبال بيراجع حجزك ويأكده بالإيميل والواتساب. لو الحجز ماتأكدش، المبلغ بيرجعلك.')
          : L('Reception confirms every booking. Beds are held for you while it’s reviewed.', 'الاستقبال يؤكد كل حجز، والأسرّة محجوزة لك أثناء المراجعة.')}</p>
      </fieldset>
    </form>
  );
}
