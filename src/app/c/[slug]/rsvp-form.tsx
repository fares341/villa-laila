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
};

/** "I'm coming": name, phone, how many people; then a thank-you with add-to-calendar and share. */
export function RsvpForm({ slug, ar, askEmail, maxPeople, title, partner, calendarUrl }: { slug: string; ar: boolean; askEmail: boolean; maxPeople: number; title: string; partner: string; calendarUrl: string | null }) {
  const L = (en: string, a: string) => (ar ? a : en);
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
      const r = await fetch('/api/collab/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...Object.fromEntries(f.entries()), slug, people }) });
      const d = await r.json().catch(() => null);
      if (d?.ok) { setDone({ name: String(f.get('fullName') || '').split(' ')[0], people, updated: !!d.updated }); document.getElementById('join')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else { const m = ERR[d?.error] ?? ERR[String(d?.error ?? '').split(':')[0]]; setErr(m ? (ar ? m[1] : m[0]) : L('Something went wrong. Try again or message us on WhatsApp.', 'حصلت مشكلة. جرب تاني أو كلمنا على واتساب.')); }
    } catch { setErr(L('No connection. Try again.', 'مفيش اتصال. جرب تاني.')); }
    setBusy(false);
  };

  if (done) {
    const share = `${title} · Villa Layla & ${partner}\n${typeof window !== 'undefined' ? window.location.href.split('#')[0] : ''}`;
    return (
      <div className="cbx-done">
        <div className="cbx-tick" aria-hidden><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></div>
        <h3>{done.updated ? L(`Updated, ${done.name}!`, `اتعدّل يا ${done.name}!`) : L(`You’re on the list, ${done.name}!`, `اسمك اتسجل يا ${done.name}!`)}</h3>
        <p>{L(`${done.people} ${done.people === 1 ? 'person' : 'people'} · see you there. We’ll message you on WhatsApp before the event.`, `${done.people} ${done.people === 1 ? 'فرد' : 'أفراد'} · مستنيينك. هنبعتلك على واتساب قبل الإيفنت.`)}</p>
        <div className="cbx-done-acts">
          {calendarUrl && <a className="btn btn-line" href={calendarUrl} target="_blank" rel="noopener noreferrer">{L('Add to calendar', 'ضيفه للتقويم')}</a>}
          <a className="btn btn-wa" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">{L('Send to a friend', 'ابعته لصاحبك')}</a>
        </div>
      </div>
    );
  }

  return (
    <form className="evb" onSubmit={submit}>
      <p className="evb-fine cbx-sub">{L('It takes 20 seconds. No payment now.', 'هتاخد ٢٠ ثانية. مفيش دفع دلوقتي.')}</p>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="cbx-hp" />
      <div className="evb-field"><label htmlFor="cb-name">{L('Full name', 'الاسم')}</label><input id="cb-name" name="fullName" required minLength={2} maxLength={80} autoComplete="name" /></div>
      <div className="evb-field"><label htmlFor="cb-phone">{L('Mobile / WhatsApp', 'رقم الموبايل / واتساب')}</label><input id="cb-phone" name="phone" type="tel" required minLength={7} maxLength={30} autoComplete="tel" dir="ltr" placeholder="+20 1xx xxx xxxx" /></div>
      {askEmail && <div className="evb-field"><label htmlFor="cb-email">{L('Email', 'البريد الإلكتروني')}</label><input id="cb-email" name="email" type="email" required autoComplete="email" dir="ltr" /></div>}
      <div className="evb-qty">
        <span>{L('How many people?', 'عددكم كام؟')}</span>
        <div className="evb-stepper">
          <button type="button" onClick={() => setPeople((p) => Math.max(1, p - 1))} disabled={people <= 1} aria-label={L('Fewer', 'أقل')}>−</button>
          <output aria-live="polite" className="num">{people}</output>
          <button type="button" onClick={() => setPeople((p) => Math.min(maxPeople, p + 1))} disabled={people >= maxPeople} aria-label={L('More', 'أكتر')}>+</button>
        </div>
      </div>
      <div className="evb-field"><label htmlFor="cb-ig">{L('Instagram (optional)', 'إنستجرام (اختياري)')}</label><input id="cb-ig" name="instagram" maxLength={60} dir="ltr" placeholder="@" /></div>
      <div className="evb-field"><label htmlFor="cb-note">{L('Anything we should know? (optional)', 'حاجة عايزنا نعرفها؟ (اختياري)')}</label><textarea id="cb-note" name="note" rows={2} maxLength={300} /></div>
      {err && <p className="form-msg evb-err" role="alert">{err}</p>}
      <button type="submit" className={`btn btn-book evb-submit ${busy ? 'loading' : ''}`} disabled={busy} aria-busy={busy}>{busy ? L('Saving…', 'بنسجل…') : L('Confirm I’m coming', 'أكّد حضوري')}</button>
    </form>
  );
}
