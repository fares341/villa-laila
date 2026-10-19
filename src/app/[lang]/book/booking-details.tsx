'use client';

import React, { useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitBooking } from './actions';

type Method = 'paymob' | 'instapay' | 'hostel';

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={`btn btn-book ${pending ? 'loading' : ''}`} disabled={pending} aria-busy={pending}>{pending ? busy : label}</button>;
}

export function BookingDetails(p: {
  lang: string; checkIn: string; checkOut: string; guests: number; roomTypeId: string; roomCode: string; total: string;
  needNationality: boolean; needGov: boolean; methods: Method[];
  labels: { fullName: string; email: string; phone: string; nationality: string; idGovernorate: string; notes: string };
}) {
  const ar = p.lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const [stage, setStage] = useState<'details' | 'payment'>('details');
  const [method, setMethod] = useState<Method>(p.methods[0]);
  const detailsRef = useRef<HTMLFieldSetElement>(null);

  const go = (s: 'details' | 'payment') => {
    setStage(s);
    document.getElementById('bk-steps')?.setAttribute('data-current', s === 'payment' ? '4' : '3');
    document.getElementById('details')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const next = () => {
    const inputs = Array.from(detailsRef.current?.querySelectorAll('input, textarea') ?? []) as (HTMLInputElement | HTMLTextAreaElement)[];
    for (const el of inputs) if (!el.checkValidity()) { el.reportValidity(); return; }
    go('payment');
  };

  const M: Record<Method, { t: string; d: string }> = {
    paymob: { t: L('Card or mobile wallet', 'بطاقة أو محفظة إلكترونية'), d: L('Visa, Mastercard, Meeza, wallets — secure checkout by Paymob. Your payment is recorded instantly.', 'فيزا، ماستركارد، ميزة، المحافظ — دفع آمن عبر Paymob ويُسجَّل فورًا.') },
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
          <div className="evb-field"><label htmlFor="fn">{p.labels.fullName}</label><input id="fn" name="fullName" required minLength={2} maxLength={80} autoComplete="name" /></div>
          <div className="evb-field"><label htmlFor="em">{p.labels.email}</label><input id="em" name="email" type="email" required autoComplete="email" dir="ltr" /></div>
          <div className="evb-field"><label htmlFor="ph">{p.labels.phone}</label><input id="ph" name="phone" type="tel" autoComplete="tel" dir="ltr" /></div>
          {p.needNationality && <div className="evb-field"><label htmlFor="na">{p.labels.nationality}</label><input id="na" name="nationality" required /></div>}
          {p.needGov && <div className="evb-field"><label htmlFor="gv">{p.labels.idGovernorate}</label><input id="gv" name="idGovernorate" /></div>}
          <div className="evb-field wide"><label htmlFor="no">{p.labels.notes}</label><textarea id="no" name="notes" rows={3} maxLength={500} /></div>
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
          <div><small>{L('Total for your stay', 'إجمالي الإقامة')}</small><b className="num" dir="ltr">{p.total}</b></div>
          <Submit
            label={method === 'paymob' ? L('Pay now', 'ادفع الآن') : method === 'instapay' ? L('Book & pay with InstaPay', 'احجز وادفع بـ InstaPay') : L('Send booking request', 'أرسل طلب الحجز')}
            busy={L('Booking…', 'جارٍ الحجز…')}
          />
        </div>
        <div className="bk-nav">
          <button type="button" className="btn btn-line" onClick={() => go('details')}>{L('Back', 'رجوع')}</button>
        </div>
        <p className="evb-fine">{L('Reception confirms every booking. Beds are held for you while it’s reviewed.', 'الاستقبال يؤكد كل حجز، والأسرّة محجوزة لك أثناء المراجعة.')}</p>
      </fieldset>
    </form>
  );
}
