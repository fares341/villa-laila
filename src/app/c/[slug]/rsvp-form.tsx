'use client';

import React, { useState } from 'react';

const ERR: Record<string, [string, string]> = {
  'invalid_input:name': ['Write your name.', 'اكتب اسمك.'],
  'invalid_input:phone': ['Write a phone number we can reach on WhatsApp.', 'اكتب رقم موبايل عليه واتساب.'],
  'invalid_input:email': ['Write a valid e-mail.', 'اكتب إيميل صحيح.'],
  'invalid_input:people': ['Choose how many people (1–10).', 'اختار عددكم (من 1 لـ 10).'],
  no_availability: ['Not enough places left for that many people.', 'مفيش أماكن كفاية للعدد ده.'],
  'bad_state:over': ['This event has already taken place.', 'الإيفنت ده خلص.'],
  rate_limit: ['Too many tries. Please wait a few minutes.', 'محاولات كتير. استنى دقايق وجرب تاني.'],
  'invalid_input:offer': ['Write how much you would like to pay per ticket (0 is fine).', 'اكتب المبلغ اللي حابب تدفعه للتذكرة (صفر عادي).'],
};

type Q = { id: string; label: { ar?: string; en?: string }; type: 'text' | 'choice' | 'multi'; options: { ar?: string; en?: string }[]; required: boolean };

/** "I'm coming": name, phone, how many people; then a thank-you with add-to-calendar and share. */
export function RsvpForm({ slug, ar, askEmail, maxPeople, title, partner, calendarUrl, questions = [], priceMode = 'free', priceCents = null }: {
  slug: string; ar: boolean; askEmail: boolean; maxPeople: number; title: string; partner: string; calendarUrl: string | null;
  questions?: Q[]; priceMode?: 'free' | 'pwyw' | 'fixed'; priceCents?: number | null;
}) {
  const L = (en: string, a: string) => (ar ? a : en);
  const tx = (x: { ar?: string; en?: string }) => (ar ? x.ar || x.en : x.en || x.ar) || '';
  const money = (c: number) => (ar ? `${(c / 100).toLocaleString('en-US')} ج.م` : `EGP ${(c / 100).toLocaleString('en-US')}`);
  const [people, setPeople] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | { name: string; people: number; updated: boolean }>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true); setErr(null);
    try {
      // Answers to the extra questions ("a_<id>"; several values for checkboxes).
      const answers: Record<string, string | string[]> = {};
      for (const qn of questions) { const all = f.getAll('a_' + qn.id).map(String).filter(Boolean); answers[qn.id] = qn.type === 'multi' ? all : all[0] ?? ''; }
      const missing = questions.find((qn) => qn.required && (Array.isArray(answers[qn.id]) ? !answers[qn.id].length : !answers[qn.id]));
      if (missing) { setErr(L(`Please answer: ${tx(missing.label)}`, `جاوب على: ${tx(missing.label)}`)); setBusy(false); return; }
      const base = Object.fromEntries([...f.entries()].filter(([k]) => !k.startsWith('a_')));
      const r = await fetch('/api/collab/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, slug, people, answers }) });
      const d = await r.json().catch(() => null);
      if (d?.ok) { setDone({ name: String(f.get('fullName') || '').split(' ')[0], people, updated: !!d.updated }); document.getElementById('join')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (String(d?.error ?? '').startsWith('invalid_input:q:')) { const qn = questions.find((x) => x.id === String(d.error).slice(16)); setErr(L(`Please answer: ${qn ? tx(qn.label) : ''}`, `جاوب على: ${qn ? tx(qn.label) : ''}`)); }
      else { const m = ERR[d?.error] ?? ERR[String(d?.error ?? '').split(':')[0]]; setErr(m ? (ar ? m[1] : m[0]) : L('Something went wrong. Try again or message us on WhatsApp.', 'حصلت مشكلة. جرب تاني أو كلمنا على واتساب.')); }
    } catch { setErr(L('No connection. Try again.', 'مفيش اتصال. جرب تاني.')); }
    setBusy(false);
  };

  if (done) {
    const share = `${title} · Villa Layla & ${partner}\n${typeof window !== 'undefined' ? window.location.href.split('#')[0] : ''}`;
    return (
      <div className="cbx-done">
        <div className="cbx-tick" aria-hidden><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></div>
        <h3>{done.updated ? L(`Ticket updated, ${done.name}!`, `تذكرتك اتعدلت يا ${done.name}!`) : L(`Your ticket is booked, ${done.name}!`, `تذكرتك اتحجزت يا ${done.name}!`)}</h3>
        <p>{L(`${done.people} ${done.people === 1 ? 'ticket' : 'tickets'} · see you there. We’ll message you on WhatsApp before the event.`, `${done.people} ${done.people === 1 ? 'تذكرة' : 'تذاكر'} · مستنيينك. هنبعتلك على واتساب قبل الإيفنت.`)}</p>
        <div className="cbx-done-acts">
          {calendarUrl && <a className="btn btn-line" href={calendarUrl} target="_blank" rel="noopener noreferrer">{L('Add to calendar', 'ضيفه للتقويم')}</a>}
          <a className="btn btn-wa" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">{L('Send to a friend', 'ابعته لصاحبك')}</a>
        </div>
      </div>
    );
  }

  return (
    <form className="evb" onSubmit={submit}>
      <p className="evb-fine cbx-sub">{priceMode === 'fixed' && priceCents
        ? L(`Ticket ${money(priceCents)} · paid at the villa, nothing to pay now.`, `التذكرة ${money(priceCents)} · الدفع في الفيلا، مفيش دفع دلوقتي.`)
        : priceMode === 'pwyw' ? L('Pay what you want · you pay at the villa, nothing now.', 'ادفع اللي تحبه · الدفع في الفيلا، مفيش دفع دلوقتي.')
        : L('Free ticket · takes 20 seconds, no payment now.', 'تذكرة مجانية · هتاخد ٢٠ ثانية ومفيش دفع دلوقتي.')}</p>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="cbx-hp" />
      <div className="evb-field"><label htmlFor="cb-name">{L('Full name', 'الاسم')}</label><input id="cb-name" name="fullName" required minLength={2} maxLength={80} autoComplete="name" /></div>
      <div className="evb-field"><label htmlFor="cb-phone">{L('Mobile / WhatsApp', 'رقم الموبايل / واتساب')}</label><input id="cb-phone" name="phone" type="tel" required minLength={7} maxLength={30} autoComplete="tel" dir="ltr" placeholder="+20 1xx xxx xxxx" /></div>
      {askEmail && <div className="evb-field"><label htmlFor="cb-email">{L('Email', 'البريد الإلكتروني')}</label><input id="cb-email" name="email" type="email" required autoComplete="email" dir="ltr" /></div>}
      <div className="evb-qty">
        <span>{L('How many tickets?', 'عدد التذاكر')}</span>
        <div className="evb-stepper">
          <button type="button" onClick={() => setPeople((p) => Math.max(1, p - 1))} disabled={people <= 1} aria-label={L('Fewer', 'أقل')}>−</button>
          <output aria-live="polite" className="num">{people}</output>
          <button type="button" onClick={() => setPeople((p) => Math.min(maxPeople, p + 1))} disabled={people >= maxPeople} aria-label={L('More', 'أكتر')}>+</button>
        </div>
      </div>
      {priceMode === 'pwyw' && (
        <div className="evb-field"><label htmlFor="cb-offer">{L('How much would you like to pay per ticket? (EGP)', 'حابب تدفع كام للتذكرة؟ (جنيه)')}</label>
          <input id="cb-offer" name="offer" type="number" inputMode="decimal" min={0} step="any" required dir="ltr" placeholder={priceCents ? String(priceCents / 100) : '0'} />
          {priceCents ? <small className="evb-fine">{L(`Suggested: ${money(priceCents)}`, `المقترح: ${money(priceCents)}`)}</small> : null}</div>
      )}
      {priceMode === 'fixed' && priceCents ? <p className="cbx-total">{L('To pay at the villa', 'المطلوب في الفيلا')}: <b dir="ltr">{money(priceCents * people)}</b></p> : null}
      {questions.map((qn) => (
        qn.type === 'text' ? (
          <div className="evb-field" key={qn.id}><label htmlFor={'cb-' + qn.id}>{tx(qn.label)}{!qn.required && L(' (optional)', ' (اختياري)')}</label>
            <input id={'cb-' + qn.id} name={'a_' + qn.id} required={qn.required} maxLength={500} /></div>
        ) : (
          <fieldset className="cbx-q" key={qn.id}>
            <legend>{tx(qn.label)}{!qn.required && L(' (optional)', ' (اختياري)')}{qn.type === 'multi' && <small>{L(' · choose any', ' · اختار أكتر من واحد')}</small>}</legend>
            {qn.options.map((o, k) => (
              <label key={k} className="cbx-opt"><input type={qn.type === 'multi' ? 'checkbox' : 'radio'} name={'a_' + qn.id} value={o.en || o.ar} required={qn.type === 'choice' && qn.required} /> <span>{tx(o)}</span></label>
            ))}
          </fieldset>
        )
      ))}
      <div className="evb-field"><label htmlFor="cb-ig">{L('Instagram (optional)', 'إنستجرام (اختياري)')}</label><input id="cb-ig" name="instagram" maxLength={60} dir="ltr" placeholder="@" /></div>
      <div className="evb-field"><label htmlFor="cb-note">{L('Anything we should know? (optional)', 'حاجة عايزنا نعرفها؟ (اختياري)')}</label><textarea id="cb-note" name="note" rows={2} maxLength={300} /></div>
      {err && <p className="form-msg evb-err" role="alert">{err}</p>}
      <button type="submit" className={`btn btn-book evb-submit ${busy ? 'loading' : ''}`} disabled={busy} aria-busy={busy}>{busy ? L('Booking…', 'بنحجز…') : L('Book my ticket', 'احجز تذكرتي')}</button>
    </form>
  );
}
