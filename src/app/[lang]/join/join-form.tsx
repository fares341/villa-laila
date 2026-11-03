'use client';

import React, { useState } from 'react';

const ERR: Record<string, [string, string]> = {
  'invalid_input:name': ['Write your full name.', 'اكتب اسمك بالكامل.'],
  'invalid_input:birth': ['Write your date of birth.', 'اكتب تاريخ ميلادك.'],
  'invalid_input:phone': ['Write a phone number we can reach on WhatsApp.', 'اكتب رقم موبايل عليه واتساب.'],
  'invalid_input:email': ['Write a valid e-mail, or leave it empty.', 'اكتب إيميل صحيح أو سيبه فاضي.'],
  'invalid_input:languages': ['Tell us which languages you speak.', 'قولّنا بتتكلم لغات إيه.'],
  'invalid_input:experience': ['Tell us about your experience (or write “none”).', 'احكيلنا عن خبرتك (أو اكتب «مفيش»).'],
  'invalid_input:why': ['Tell us why you would like to join.', 'قولّنا ليه حابب تنضم لينا.'],
  'invalid_input:availability': ['Choose full-time and/or part-time.', 'اختار دوام كامل أو جزئي.'],
  'invalid_input:shifts': ['Answer the question about rotating shifts.', 'جاوب على سؤال الشيفتات.'],
  'invalid_input:start': ['Tell us when you can start.', 'قولّنا تقدر تبدأ إمتى.'],
  'invalid_input:stay': ['Tell us how long you can volunteer.', 'قولّنا تقدر تتطوع قد إيه.'],
  rate_limit: ['Too many tries. Please wait a while.', 'محاولات كتير. استنى شوية وجرب تاني.'],
};

/**
 * The application form: the same questions as the villa's job form (name, date of birth, WhatsApp, e-mail,
 * languages, experience, why us, full/part time, rotating shifts, start date, anything else), plus "how long" for
 * volunteers. Job or volunteer is picked at the top.
 */
export function JoinForm({ ar, initialKind }: { ar: boolean; initialKind: 'job' | 'volunteer' }) {
  const L = (en: string, a: string) => (ar ? a : en);
  const [kind, setKind] = useState<'job' | 'volunteer'>(initialKind);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    const availability = f.getAll('availability').map(String);
    if (!availability.length) { setErr(L('Choose full-time and/or part-time.', 'اختار دوام كامل أو جزئي.')); return; }
    setBusy(true); setErr(null);
    try {
      const body = { ...Object.fromEntries([...f.entries()].filter(([k]) => k !== 'availability')), availability, kind, lang: ar ? 'ar' : 'en' };
      const r = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => null);
      if (d?.ok) { setDone(String(f.get('fullName') || '').split(' ')[0]); document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else { const m = ERR[d?.error]; setErr(m ? (ar ? m[1] : m[0]) : L('Something went wrong. Try again or message us on WhatsApp.', 'حصلت مشكلة. جرب تاني أو كلمنا على واتساب.')); }
    } catch { setErr(L('No connection. Try again.', 'مفيش اتصال. جرب تاني.')); }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="jn-done">
        <div className="cbx-tick" aria-hidden><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></div>
        <h3>{L(`Thank you, ${done}!`, `شكرًا يا ${done}!`)}</h3>
        <p>{L('We got your application. If your profile is a good match, we’ll contact you on WhatsApp for the next step.', 'طلبك وصلنا. لو مناسب هنكلمك على واتساب للخطوة الجاية.')}</p>
      </div>
    );
  }

  const field = (id: string, label: string, el: React.ReactNode) => <div className="evb-field"><label htmlFor={id}>{label}</label>{el}</div>;
  return (
    <form className="evb jn-form" onSubmit={submit}>
      <div className="jn-kind" role="radiogroup" aria-label={L('I want to', 'عايز')}>
        {(['job', 'volunteer'] as const).map((k) => (
          <label key={k} className={`cbx-opt ${kind === k ? 'on' : ''}`}>
            <input type="radio" name="kindPick" checked={kind === k} onChange={() => setKind(k)} />
            <span>{k === 'job' ? L('Apply for a job (receptionist)', 'أقدّم على شغل (ريسبشن)') : L('Volunteer with us', 'أتطوع معاكم')}</span>
          </label>
        ))}
      </div>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden className="cbx-hp" />
      {field('jn-name', L('Full name', 'الاسم بالكامل'), <input id="jn-name" name="fullName" required minLength={2} maxLength={80} autoComplete="name" />)}
      {field('jn-birth', L('Date of birth', 'تاريخ الميلاد'), <input id="jn-birth" name="birthDate" type="date" required max={new Date().toISOString().slice(0, 10)} />)}
      {field('jn-phone', L('Phone number (WhatsApp preferred)', 'رقم الموبايل (ويفضّل واتساب)'), <input id="jn-phone" name="phone" type="tel" required minLength={7} maxLength={30} autoComplete="tel" dir="ltr" placeholder="+20 1xx xxx xxxx" />)}
      {field('jn-email', L('E-mail (optional)', 'الإيميل (اختياري)'), <input id="jn-email" name="email" type="email" autoComplete="email" dir="ltr" />)}
      {field('jn-lang', L('Which languages do you speak, and how well?', 'بتتكلم لغات إيه ومستواك في كل واحدة؟'), <textarea id="jn-lang" name="languages" required rows={3} maxLength={1000} placeholder={L('e.g. Arabic native, English fluent, French basic', 'مثال: عربي لغة أم، إنجليزي ممتاز، فرنساوي مبتدئ')} />)}
      {field('jn-exp', L('Any experience in reception, customer service or hospitality? If yes, tell us briefly.', 'عندك خبرة في الريسبشن أو خدمة العملاء أو الفنادق؟ لو آه احكيلنا باختصار.'), <textarea id="jn-exp" name="experience" required rows={4} maxLength={2000} />)}
      {field('jn-why', L('Why would you like to join the Villa Layla team?', 'ليه حابب تنضم لفريق فيلا ليلى؟'), <textarea id="jn-why" name="why" required rows={4} maxLength={2000} />)}
      <fieldset className="cbx-q">
        <legend>{L('Are you available for', 'متاح لـ')} <small>{L(' · choose one or both', ' · اختار واحد أو الاتنين')}</small></legend>
        <label className="cbx-opt"><input type="checkbox" name="availability" value="full_time" /> <span>{L('Full-time', 'دوام كامل')}</span></label>
        <label className="cbx-opt"><input type="checkbox" name="availability" value="part_time" /> <span>{L('Part-time', 'دوام جزئي')}</span></label>
      </fieldset>
      <fieldset className="cbx-q">
        <legend>{L('Are you OK with rotating shifts?', 'معندكش مشكلة في الشيفتات المتغيرة؟')}</legend>
        <label className="cbx-opt"><input type="radio" name="rotatingShifts" value="yes" required /> <span>{L('Yes, that’s fine', 'آه، عادي')}</span></label>
        <label className="cbx-opt"><input type="radio" name="rotatingShifts" value="no" /> <span>{L('No', 'لأ')}</span></label>
      </fieldset>
      {field('jn-start', L('When can you start?', 'تقدر تبدأ إمتى؟'), <input id="jn-start" name="startWhen" required maxLength={120} placeholder={L('e.g. right away, 1 December', 'مثال: على طول، أول ديسمبر')} />)}
      {kind === 'volunteer' && field('jn-stay', L('How long can you volunteer?', 'تقدر تتطوع قد إيه؟'), <input id="jn-stay" name="stayLength" required maxLength={120} placeholder={L('e.g. 1 month, 3 months', 'مثال: شهر، ٣ شهور')} />)}
      {field('jn-note', L('Anything else you’d like us to know? (optional)', 'حاجة تانية حابب تقولها؟ (اختياري)'), <textarea id="jn-note" name="note" rows={3} maxLength={2000} />)}
      {err && <p className="form-msg evb-err" role="alert">{err}</p>}
      <button type="submit" className={`btn btn-book evb-submit ${busy ? 'loading' : ''}`} disabled={busy} aria-busy={busy}>{busy ? L('Sending…', 'بنبعت…') : L('Send my application', 'ابعت طلبي')}</button>
    </form>
  );
}
