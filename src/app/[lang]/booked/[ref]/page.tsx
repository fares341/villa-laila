import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dict, isSiteLang, fill } from '@/i18n/site';
import { q } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request received', robots: { index: false } };

export default async function Booked({ params }: { params: Promise<{ lang: string; ref: string }> }) {
  const { lang, ref } = await params;
  if (!isSiteLang(lang)) notFound();
  // Deliberately exposes NO personal data: only the reference, dates, status and hold deadline.
  const r = (await q<any>('SELECT reference,status,check_in,check_out,hold_expires_at,needs_review FROM reservations WHERE reference=$1', [ref.toUpperCase()]))[0];
  if (!r) notFound();
  const d = dict(lang);
  const until = r.hold_expires_at ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.HOSTEL_TZ || 'Africa/Cairo' }).format(new Date(r.hold_expires_at)) : '—';
  const confirmed = r.status === 'confirmed';
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-5xl text-lapis-800">{d.booked.title}</h1>
      <p className="mt-3 text-lg text-lapis-600">{d.booked.lead}</p>
      <div className="mx-auto mt-8 max-w-sm rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-sm text-lapis-600">{d.booked.reference}</p>
        <p className="kufi mt-1 text-4xl font-semibold tracking-wider text-lapis-800" dir="ltr">{r.reference}</p>
        <p className="mt-3 text-lapis-600" dir="ltr">{r.check_in} → {r.check_out}</p>
      </div>
      {!confirmed && <p role="status" className="mx-auto mt-6 max-w-lg rounded-xl bg-amber-50 p-4 text-amber-950">{fill(d.booked.warning, { until })}</p>}
      {r.needs_review && <p className="mt-3 text-sm text-lapis-600">{d.booked.review}</p>}
      <h2 className="mt-10 text-2xl text-lapis-800">{d.booked.next}</h2>
      <ol className="mx-auto mt-3 max-w-md list-decimal space-y-2 ps-6 text-start text-lapis-800"><li>{d.booked.step1}</li><li>{d.booked.step2}</li><li>{d.booked.step3}</li></ol>
      <Link href={`/${lang}`} className="v-btn v-btn-line mt-10">{d.booked.home}</Link>
    </div>
  );
}
