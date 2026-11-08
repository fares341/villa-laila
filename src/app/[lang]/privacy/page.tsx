import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { isSiteLang } from '@/i18n/site';
import { policyText } from '@/services/settings';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs } from '@/components/claude-shell';
import { groups, Body } from '../policies/policy-text';
import '../policies/policies.css';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  return lang === 'ar'
    ? { title: 'سياسة الخصوصية', description: 'إزاي فيلا ليلى هوستل بتجمع بياناتك الشخصية وتستخدمها وتحميها.' }
    : { title: 'Privacy policy', description: 'How Villa Layla Hostel collects, uses and protects your personal information.' };
}

/** Privacy policy page (its own page, linked in the footer; text editable in Dashboard → Settings → Policies). */
export default async function Privacy({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isSiteLang(lang)) notFound();
  const ar = lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const g = groups((await policyText('privacy_policy', lang)) ?? '');
  return (
    <div className="vl-page min-h-screen flex flex-col">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <section className="evd-hero pol-hero">
          <img src="/photos/hero-03-poster.jpg" alt="" className="evd-hero-media on" />
          <div className="wrap evd-hero-in">
            <span className="kicker">{L('Villa Layla Hostel', 'فيلا ليلى هوستل')}</span>
            <h1>{L('Privacy policy', 'سياسة الخصوصية')}</h1>
            <p>{L('How we collect, use and protect your personal information.', 'إزاي بنجمع بياناتك الشخصية وبنستخدمها وبنحميها.')}</p>
          </div>
        </section>
        <div className="wrap pol-wrap">
          {g.filter((x) => !x.title).map((x, i) => <div key={i} className="pol-text pol-lead"><Body lines={x.lines} /></div>)}
          <div className="pol-cards pol-rules">
            {g.filter((x) => x.title).map((x) => (
              <article key={x.title} className="pol-card">
                <h3>{x.title}</h3>
                <div className="pol-text"><Body lines={x.lines} /></div>
              </article>
            ))}
          </div>
          <div className="pol-help">
            <p>{L('Also read our booking, cancellation and house-rules policies.', 'اقرا كمان سياسات الحجز والإلغاء وقواعد البيت.')}</p>
            <a className="btn btn-line" href={`/${lang}/policies`}>{L('Policies & house rules', 'السياسات وقواعد البيت')}</a>
          </div>
        </div>
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
    </div>
  );
}
