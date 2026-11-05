import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import React from 'react';
import { isSiteLang } from '@/i18n/site';
import { policyText } from '@/services/settings';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs } from '@/components/claude-shell';
import './policies.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return lang === 'ar'
    ? { title: 'السياسات وقواعد البيت', description: 'إزاي الحجز بيتم، الدفع، الإلغاء وقواعد البيت في فيلا ليلى هوستل.' }
    : { title: 'Policies & house rules', description: 'How booking works, payment, cancellation and house rules at Villa Layla Hostel, Cairo.' };
}

type Group = { title: string | null; lines: string[] };
/** "## Title" starts a group; "- " lines are points; other lines are paragraphs. */
const groups = (text: string): Group[] => {
  const out: Group[] = [{ title: null, lines: [] }];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('## ')) out.push({ title: l.slice(3).trim(), lines: [] });
    else out[out.length - 1].lines.push(l);
  }
  return out.filter((g) => g.title || g.lines.length);
};
const Body = ({ lines }: { lines: string[] }) => {
  const out: React.ReactNode[] = [];
  let pts: string[] = [];
  const flush = () => { if (pts.length) out.push(<ul key={out.length}>{pts.map((x, i) => <li key={i}>{x}</li>)}</ul>); pts = []; };
  for (const l of lines) {
    if (/^[-•*]\s+/.test(l)) pts.push(l.replace(/^[-•*]\s+/, ''));
    else { flush(); out.push(<p key={out.length}>{l}</p>); }
  }
  flush();
  return <>{out}</>;
};

const IC: Record<string, string> = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  home: '<path d="m3 11 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6"/>',
  smoke: '<path d="M3 15h14v4H3zM20 15v4M17 11c0-2 2-2 2-4s-2-2-2-4"/>',
  wave: '<path d="M2 17c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 13V5a2 2 0 0 1 4 0M12 13V8h4"/>',
  child: '<circle cx="12" cy="5" r="2.5"/><path d="M12 8v7M8 11h8M9 21l3-6 3 6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  heart: '<path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.1 5.2 3 1.6-1.9 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', x: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>', out: '<path d="M14 4h6v16h-6M10 17l5-5-5-5M15 12H3"/>',
};
const Ic = ({ n }: { n: string }) => <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden dangerouslySetInnerHTML={{ __html: IC[n] ?? IC.check }} />;
// Icon for a house-rules / cancellation heading (English or Arabic).
const iconFor = (t: string) => {
  const s = t.toLowerCase();
  const m: [RegExp, string][] = [[/check-in|تسجيل/, 'key'], [/quiet|هدوء/, 'moon'], [/visitor|زوار/, 'users'], [/smok|تدخين/, 'smoke'], [/pool|سباحة/, 'wave'], [/child|famil|أطفال/, 'child'],
    [/belong|شخصية/, 'lock'], [/respect|احترام/, 'heart'], [/free|مجاني/, 'check'], [/late|متأخر/, 'clock'], [/no-show|الحضور/, 'x'], [/early|بدري/, 'out']];
  return m.find(([r]) => r.test(s))?.[1] ?? 'check';
};
const tone = (t: string) => (/free|مجاني/i.test(t) ? 'ok' : /late|متأخر/i.test(t) ? 'warn' : /no-show|الحضور/i.test(t) ? 'bad' : 'info');

/** Policies: how booking works, payment, cancellation and house rules (texts from Settings, else the owner's text). */
export default async function Policies({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const ar = lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const [howto, pay, canc, rules] = await Promise.all([
    policyText('booking_howto', lang), policyText('payment_instructions', lang), policyText('cancellation_policy', lang), policyText('house_rules', lang),
  ]);
  const cg = groups(canc ?? ''), rg = groups(rules ?? '');
  const nav: [string, string][] = [['booking', L('How booking works', 'إزاي تحجز')], ['payment', L('Payment', 'الدفع')], ['cancellation', L('Cancellation', 'الإلغاء')], ['house-rules', L('House rules', 'قواعد البيت')]];
  const facts: [string, string, string][] = [
    ['card', L('10% deposit online', 'عربون 10% أونلاين'), L('The rest on arrival', 'والباقي لما توصل')],
    ['undo', L('Free cancellation', 'إلغاء مجاني'), L('Up to 72 h before check-in', 'لحد 72 ساعة قبل الوصول')],
    ['key', L('Check-in 3:00 PM', 'الدخول 3:00 العصر'), L('Check-out by 11:00 AM', 'الخروج لحد 11:00 الصبح')],
    ['moon', L('Quiet hours', 'ساعات الهدوء'), L('11:00 PM – 7:00 AM', '11:00 بالليل – 7:00 الصبح')],
  ];

  return (
    <div className="vl-page min-h-screen flex flex-col">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <section className="evd-hero pol-hero">
          <img src="/photos/hero-03-poster.jpg" alt="" className="evd-hero-media on" />
          <div className="wrap evd-hero-in">
            <span className="kicker">{L('Villa Layla Hostel', 'فيلا ليلى هوستل')}</span>
            <h1>{L('Policies & house rules', 'السياسات وقواعد البيت')}</h1>
            <p>{L('Everything to know before you book: deposit, cancellation and how we live together at the villa.', 'كل اللي محتاج تعرفه قبل ما تحجز: العربون، الإلغاء، وإزاي بنعيش سوا في الفيلا.')}</p>
          </div>
        </section>

        <nav className="pol-nav" aria-label={L('On this page', 'في الصفحة دي')}>
          <div className="wrap">{nav.map(([id, t]) => <a key={id} href={`#${id}`}>{t}</a>)}</div>
        </nav>

        <div className="wrap pol-wrap">
          <ul className="pol-facts">
            {facts.map(([i, b, s]) => <li key={b}><span className="pol-ic"><Ic n={i} /></span><span><b>{b}</b><small>{s}</small></span></li>)}
          </ul>

          <section id="booking" className="pol-sec">
            <h2><span className="pol-ic"><Ic n="calendar" /></span>{L('How booking works', 'إزاي الحجز بيتم')}</h2>
            <div className="pol-text pol-lead"><Body lines={groups(howto ?? '').flatMap((g) => g.lines)} /></div>
            <ol className="pol-steps">
              <li><b>1</b><span>{L('Choose your room and dates', 'اختار أوضتك وتواريخك')}</span></li>
              <li><b>2</b><span>{L('Pay the 10% deposit online', 'ادفع عربون 10% أونلاين')}</span></li>
              <li><b>3</b><span>{L('Your booking is confirmed', 'حجزك بيتأكد')}</span></li>
              <li><b>4</b><span>{L('Pay the other 90% on arrival', 'ادفع الـ 90% الباقيين لما توصل')}</span></li>
            </ol>
            <a className="btn btn-primary pol-cta" href={`/${lang}/book`}>{L('Check dates & book', 'شوف التواريخ واحجز')}</a>
          </section>

          <section id="payment" className="pol-sec">
            <h2><span className="pol-ic"><Ic n="card" /></span>{L('Payment policy', 'سياسة الدفع')}</h2>
            <div className="pol-text"><Body lines={groups(pay ?? '').flatMap((g) => g.lines)} /></div>
          </section>

          <section id="cancellation" className="pol-sec">
            <h2><span className="pol-ic"><Ic n="undo" /></span>{L('Cancellation policy', 'سياسة الإلغاء')}</h2>
            <div className="pol-cards">
              {cg.filter((g) => g.title).map((g) => (
                <article key={g.title} className={`pol-card t-${tone(g.title!)}`}>
                  <h3><span className="pol-ic"><Ic n={iconFor(g.title!)} /></span>{g.title}</h3>
                  <div className="pol-text"><Body lines={g.lines} /></div>
                </article>
              ))}
            </div>
            {cg.filter((g) => !g.title).map((g, i) => <div key={i} className="pol-text pol-note"><Body lines={g.lines} /></div>)}
          </section>

          <section id="house-rules" className="pol-sec">
            <h2><span className="pol-ic"><Ic n="home" /></span>{L('House rules', 'قواعد البيت')}</h2>
            {rg.filter((g) => !g.title).map((g, i) => <div key={i} className="pol-text pol-lead"><Body lines={g.lines} /></div>)}
            <div className="pol-cards pol-rules">
              {rg.filter((g) => g.title).map((g) => (
                <article key={g.title} className="pol-card">
                  <h3><span className="pol-ic"><Ic n={iconFor(g.title!)} /></span>{g.title}</h3>
                  <div className="pol-text"><Body lines={g.lines} /></div>
                </article>
              ))}
            </div>
          </section>

          <div className="pol-help">
            <p>{L('Questions, changes or cancellations? Our reception team is here to help.', 'عندك سؤال أو عايز تعدّل أو تلغي؟ فريق الاستقبال موجود يساعدك.')}</p>
            <a className="btn btn-wa" href="https://wa.me/201040551515" target="_blank" rel="noopener noreferrer">WhatsApp</a>
          </div>
        </div>
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
    </div>
  );
}
