import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dict, isSiteLang, fill } from '@/i18n/site';
import { q } from '@/lib/db';
import { money } from '@/components/site';
import { ClaudeHeader, ClaudeFooter, ClaudeFabs } from '@/components/claude-shell';
import { BookingSteps } from '@/components/booking-steps';
import { CopyButton } from '@/components/copy-button';
import { paymobEnabled } from '@/services/paymob';
import { getWallets, walletOn } from '@/services/wallets';
import { reservationPaymentInfo } from '@/services/online-payments';
import { payReservationPaymobAction, submitReservationInstapayAction } from '../../book/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Request received', robots: { index: false } };

export default async function Booked({ params, searchParams }: { params: Promise<{ lang: string; ref: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { lang, ref } = await params;
  if (!isSiteLang(lang)) notFound();
  const sp = await searchParams;
  // Deliberately exposes NO personal data: only the reference, dates, status, amount and hold deadline.
  const r = (await q<any>('SELECT id,reference,status,check_in,check_out,hold_expires_at,needs_review,total_cents,currency FROM reservations WHERE reference=$1', [ref.toUpperCase()]))[0];
  if (!r) notFound();
  const d = dict(lang);
  const ar = lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const until = r.hold_expires_at ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG-u-nu-latn' : lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.HOSTEL_TZ || 'Africa/Cairo' }).format(new Date(r.hold_expires_at)) : '—';
  const confirmed = ['confirmed', 'checked_in', 'checked_out'].includes(r.status);
  const open = ['pending', 'confirmed', 'hold'].includes(r.status);
  const pay = await reservationPaymentInfo(r.id, Number(r.total_cents)).catch(() => ({ due: Number(r.total_cents), paid: false, pendingInstapay: false }));
  const due = money(pay.due, r.currency, lang);
  const canPaymob = open && pay.due > 0 && paymobEnabled(r.currency);
  const wallets = await getWallets();
  const canInstapay = open && pay.due > 0 && !pay.pendingInstapay && walletOn(wallets, 'instapay', r.currency);
  const ip = wallets.instapay;
  // Same product listed twice (e.g. once per category) is shown once.
  const extras = (await q<any>(`SELECT name, price_cents, currency, unit_label FROM products WHERE is_active AND public_visible ORDER BY sort_order, name`).catch(() => []))
    .filter((x: any, i: number, all: any[]) => all.findIndex((y: any) => y.name === x.name && y.price_cents === x.price_cents && y.currency === x.currency) === i);

  const banner =
    sp.payment === 'paid' ? { cls: 'ok', text: L('Payment received — thank you! It’s already on your booking.', 'تم استلام الدفع — شكرًا! تم تسجيله على حجزك.') } :
    sp.payment === 'failed' ? { cls: 'bad', text: L('The payment didn’t go through. Your request is still saved; you can try again below.', 'لم يتم الدفع. طلبك محفوظ ويمكنك المحاولة مرة أخرى بالأسفل.') } :
    sp.payment === 'pending' ? { cls: 'wait', text: L('Your payment is processing. Refresh this page in a minute.', 'الدفع قيد المعالجة. حدّث الصفحة بعد دقيقة.') } :
    sp.payment === 'submitted' ? { cls: 'wait', text: L('Thanks! We’ll check your InstaPay transfer and confirm.', 'شكرًا! سنراجع تحويل InstaPay ونؤكد.') } :
    sp.payment === 'unavailable' ? { cls: 'bad', text: L('Card payment isn’t available right now. Your request is saved; pay with InstaPay or at the villa.', 'الدفع بالبطاقة غير متاح الآن. طلبك محفوظ؛ ادفع بـ InstaPay أو في الفيلا.') } :
    sp.payment === 'error' || sp.error ? { cls: 'bad', text: sp.error === 'proof_required' ? L('Attach the screenshot of your InstaPay transfer.', 'ارفع صورة إيصال تحويل InstaPay.') : sp.error === 'instapay_input' ? L('Enter the sender name and the transfer reference.', 'اكتب اسم المحوِّل ورقم العملية.') : L('Something went wrong. Please try again.', 'حدث خطأ. حاول مرة أخرى.') } :
    null;

  return (
    <div className="vl-page min-h-screen flex flex-col">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <div className="wrap bk">
          <BookingSteps lang={lang} current={5} />
          {banner && <p role="status" className={`tk-banner ${banner.cls}`}>{banner.text}</p>}

          <section className="bkd">
            <span className="kicker">{confirmed ? L('Confirmed', 'مؤكد') : d.booked.title}</span>
            <h1>{confirmed ? L('See you at the villa!', 'نشوفك في الفيلا!') : d.booked.lead}</h1>
            <div className="bkd-ref">
              <small>{d.booked.reference}</small>
              <b dir="ltr">{r.reference}</b>
              <span className="num" dir="ltr">{r.check_in} → {r.check_out}</span>
              <CopyButton text={r.reference} label={L('Copy reference', 'انسخ الرقم')} done={L('Copied', 'تم النسخ')} className="btn btn-line btn-sm" />
            </div>
            <dl className="bkd-pay">
              <div><dt>{L('Total', 'الإجمالي')}</dt><dd dir="ltr">{money(Number(r.total_cents), r.currency, lang)}</dd></div>
              <div><dt>{L('Payment', 'الدفع')}</dt><dd>
                {pay.paid ? <span className="tk-status ok">{L('Paid', 'مدفوع')}</span>
                  : pay.pendingInstapay ? <span className="tk-status wait">{L('InstaPay being checked', 'جارٍ مراجعة InstaPay')}</span>
                  : <span className="tk-status wait">{L('Due', 'مستحق')}: <span dir="ltr">{due}</span></span>}
              </dd></div>
            </dl>
            {!confirmed && <p role="status" className="bkd-warn">{fill(d.booked.warning, { until })}</p>}
            {r.needs_review && <p className="bkd-sub">{d.booked.review}</p>}
          </section>

          {(canPaymob || canInstapay) && (
            <section className="tk-pay" id="pay" aria-labelledby="payH">
              <h2 id="payH">{L('Pay now to secure your stay', 'ادفع الآن لتأمين إقامتك')}</h2>
              <p className="tk-due">{L('Amount due', 'المبلغ المطلوب')}: <b dir="ltr">{due}</b></p>
              <div className="tk-pay-grid">
                {canPaymob && (
                  <form action={payReservationPaymobAction} className="tk-pay-card">
                    <input type="hidden" name="lang" value={lang} /><input type="hidden" name="ref" value={r.reference} />
                    <h3>{L('Card or mobile wallet', 'بطاقة أو محفظة إلكترونية')}</h3>
                    <p>{L('Secure checkout by Paymob. Recorded on your booking instantly.', 'دفع آمن عبر Paymob ويُسجَّل على حجزك فورًا.')}</p>
                    <button className="btn btn-book" type="submit">{L('Pay', 'ادفع')} <span dir="ltr">{due}</span></button>
                  </form>
                )}
                {canInstapay && (
                  <form action={submitReservationInstapayAction} className={`tk-pay-card ${sp.pay === 'instapay' ? 'focus' : ''}`}>
                    <input type="hidden" name="lang" value={lang} /><input type="hidden" name="ref" value={r.reference} />
                    <h3>InstaPay</h3>
                    <ol className="tk-steps">
                      <li>{L('Send', 'حوّل')} <b dir="ltr">{due}</b> {L('from your bank app or InstaPay', 'من تطبيق البنك أو InstaPay')}</li>
                      {ip.address && <li>{L('To InstaPay address', 'على عنوان InstaPay')} <b dir="ltr" className="sel">{ip.address}</b></li>}
                      {ip.phone && <li>{L('Or to mobile number', 'أو على رقم')} <b dir="ltr" className="sel">{ip.phone}</b></li>}
                      <li>{L('Account name', 'اسم الحساب')}: <b>{ip.name}</b></li>
                      <li>{L('Write your booking reference in the note:', 'اكتب رقم الحجز في ملاحظة التحويل:')} <b dir="ltr" className="sel">{r.reference}</b></li>
                    </ol>
                    {ip.link && <a className="btn btn-line btn-sm" href={ip.link} target="_blank" rel="noopener noreferrer">{L('Open InstaPay link', 'افتح رابط InstaPay')}</a>}
                    <div className="evb-field"><label htmlFor="ip-name">{L('Sender name', 'اسم المحوِّل')}</label><input id="ip-name" name="payerName" required minLength={2} maxLength={80} /></div>
                    <div className="evb-field"><label htmlFor="ip-ref">{L('Transfer reference number', 'رقم العملية (Reference)')}</label><input id="ip-ref" name="payerRef" required minLength={3} maxLength={60} dir="ltr" /></div>
                    <div className="evb-field"><label htmlFor="ip-proof">{L('Transfer screenshot (required)', 'صورة إيصال التحويل (مطلوبة)')}</label><input id="ip-proof" name="proof" type="file" accept="image/*,application/pdf" required /></div>
                    <button className="btn btn-primary" type="submit">{L('I’ve sent the transfer', 'حوّلت المبلغ')}</button>
                  </form>
                )}
              </div>
              <p className="evb-fine">{L('Prefer to pay at check-in? No need to do anything now.', 'تفضّل الدفع عند الوصول؟ مش محتاج تعمل حاجة دلوقتي.')}</p>
            </section>
          )}

          {extras.length > 0 && (
            <section className="bkd-next" aria-labelledby="exH">
              <h2 id="exH">{L('Extras at the villa', 'إضافات متاحة في الفيلا')}</h2>
              <p className="bkd-sub">{L('Ask at reception during your stay; it is added to your room bill.', 'اطلبها من الاستقبال أثناء إقامتك وتُضاف على فاتورة غرفتك.')}</p>
              <ul className="bkd-extras">
                {extras.map((x: any) => <li key={`${x.name}-${x.price_cents}-${x.currency}`}><span>{x.name}{x.unit_label ? ` · ${x.unit_label}` : ''}</span><b dir="ltr">{money(Number(x.price_cents), x.currency, lang)}</b></li>)}
              </ul>
            </section>
          )}

          <section className="bkd-next">
            <h2>{d.booked.next}</h2>
            <ol>
              <li>{d.booked.step1}</li>
              <li>{pay.paid ? L('Your payment is already recorded.', 'دفعتك مسجلة بالفعل.') : d.booked.step2}</li>
              <li>{d.booked.step3}</li>
            </ol>
            <div className="tk-actions">
              <Link href={`/${lang}`} className="btn btn-line">{d.booked.home}</Link>
              <Link href={`/${lang}#events`} className="btn btn-line">{L('Events at the villa', 'فعاليات الفيلا')}</Link>
              <a className="btn btn-wa" href={`https://wa.me/201040551515?text=${encodeURIComponent('Booking ' + r.reference)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
            </div>
          </section>
        </div>
      </main>
      <ClaudeFooter lang={lang} />
      <ClaudeFabs lang={lang} />
    </div>
  );
}
