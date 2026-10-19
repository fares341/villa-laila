import { notFound } from 'next/navigation';
import { isSiteLang } from '@/i18n/site';
import { ClaudeHeader, ClaudeFooter } from '@/components/claude-shell';
import { getTicket, ticketValid, tr } from '@/services/events';
import { priceLabel } from '@/services/event-view';
import { paymobEnabled } from '@/services/paymob';
import { instapayEnabled, instapayDetails } from '@/services/instapay';
import { timeLabel, dateLabel } from '@/lib/event-dates';
import { qrSvg } from '@/lib/qr';
import { siteBase } from '@/lib/base-url';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { retryEventPaymobAction, submitEventInstapayAction } from '../../events/actions';
import { staffCheckInTicketAction } from '@/app/dashboard/events/actions';
import { CopyButton } from '@/components/copy-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your ticket', robots: { index: false } };

export default async function TicketPage({ params, searchParams }: { params: Promise<{ lang: string; code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { lang, code } = await params;
  if (!isSiteLang(lang)) notFound();
  const sp = await searchParams;
  const t = await getTicket(code);
  if (!t) notFound();
  const { booking: b, event: ev } = t;
  const ar = lang === 'ar';
  const L = (en: string, a: string) => (ar ? a : en);
  const valid = ticketValid(b.status);
  const base = await siteBase();
  const url = `${base}/${lang}/tickets/${b.ticket_code}`;
  const qr = qrSvg(url, { dark: '#2F2925', light: '#FFFFFF', title: b.ticket_code });
  const total = priceLabel(b.total_cents, b.currency, lang);
  const option = b.option_key ? ev.options.find((o) => o.key === b.option_key) : null;
  const firstName = String(b.full_name).split(/\s+/)[0];
  const ip = instapayDetails();
  const staff = await currentUser().catch(() => null);
  const canCheckIn = !!staff && can(staff.role, 'tours.manage');

  const STATUS: Record<string, { label: string; cls: string }> = {
    paid: { label: L('Paid · valid ticket', 'مدفوعة · تذكرة صالحة'), cls: 'ok' },
    pay_on_site: { label: L('Reserved · pay at the villa', 'محجوزة · الدفع في المكان'), cls: 'ok' },
    pending_verification: { label: L('Payment being checked', 'جارٍ التأكد من الدفع'), cls: 'wait' },
    awaiting_payment: { label: L('Waiting for payment', 'في انتظار الدفع'), cls: 'wait' },
    expired: { label: L('Expired · not paid in time', 'انتهت · لم يتم الدفع في الوقت'), cls: 'bad' },
    cancelled: { label: L('Cancelled', 'ملغاة'), cls: 'bad' },
  };
  const st = STATUS[b.status] ?? { label: b.status, cls: 'wait' };

  const banner =
    sp.payment === 'paid' ? { cls: 'ok', text: L('Payment received. Enjoy the event!', 'تم استلام الدفع. استمتع بالفعالية!') } :
    sp.payment === 'failed' ? { cls: 'bad', text: L('The payment didn’t go through. You can try again below.', 'لم تتم عملية الدفع. يمكنك المحاولة مرة أخرى بالأسفل.') } :
    sp.payment === 'pending' ? { cls: 'wait', text: L('Your payment is processing. This page updates once Paymob confirms it.', 'الدفع قيد المعالجة. ستتحدث الصفحة بعد تأكيد Paymob.') } :
    sp.payment === 'submitted' ? { cls: 'wait', text: L('Thanks! We’ll check the InstaPay transfer and activate your ticket shortly.', 'شكرًا! سنراجع تحويل InstaPay ونفعّل تذكرتك قريبًا.') } :
    sp.payment === 'unavailable' ? { cls: 'bad', text: L('Card payment isn’t available right now. Pay with InstaPay or message us on WhatsApp.', 'الدفع بالبطاقة غير متاح الآن. ادفع بـ InstaPay أو راسلنا على واتساب.') } :
    sp.error ? { cls: 'bad', text: sp.error === 'instapay_input' ? L('Enter the sender name and the transfer reference.', 'اكتب اسم المحوِّل ورقم العملية.') : L('Something went wrong. Please try again.', 'حدث خطأ. حاول مرة أخرى.') } :
    null;

  return (
    <div className="vl-page min-h-screen flex flex-col">
      <ClaudeHeader lang={lang} />
      <main id="main" className="flex-1">
        <div className="wrap tk-wrap">
          {banner && <p role="status" className={`tk-banner ${banner.cls}`}>{banner.text}</p>}

          <article className={`tk ${valid ? '' : 'tk-dim'}`} aria-label={L('Event ticket', 'تذكرة الفعالية')}>
            <div className="tk-main">
              {ev.image && <img className="tk-img" src={ev.image} alt="" />}
              <div className="tk-body">
                <span className={`tk-status ${st.cls}`}>{st.label}</span>
                <h1>{tr(ev.title, lang)}</h1>
                <dl className="tk-facts">
                  <div><dt>{L('Date', 'التاريخ')}</dt><dd>{dateLabel(b.event_date, lang, { weekday: 'long', day: 'numeric', month: 'long' })}</dd></div>
                  <div><dt>{L('Time', 'الوقت')}</dt><dd dir="ltr">{timeLabel(ev.start_time, lang)} – {timeLabel(ev.end_time, lang)}</dd></div>
                  <div><dt>{L('Guests', 'الأشخاص')}</dt><dd className="num">{b.quantity}{option ? ` · ${ar ? option.ar : option.en}` : ''}</dd></div>
                  <div><dt>{L('Name', 'الاسم')}</dt><dd>{firstName}</dd></div>
                  <div><dt>{L('Total', 'الإجمالي')}</dt><dd dir="ltr">{total}</dd></div>
                  <div><dt>{L('Place', 'المكان')}</dt><dd>{L('Villa Layla, 20 Safiya Zaghloul St', 'فيلا ليلى، ٢٠ ش صفية زغلول')}</dd></div>
                </dl>
              </div>
            </div>
            <div className="tk-stub">
              <div className="tk-qr" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="tk-code" dir="ltr">{b.ticket_code}</p>
              <p className="tk-hint">{valid ? L('Show this at the pool gate', 'اعرضها عند بوابة المسبح') : L('Activates after payment', 'تُفعّل بعد الدفع')}</p>
              {b.checked_in_at && <p className="tk-used">{L('Checked in', 'تم الدخول')}</p>}
            </div>
          </article>

          <div className="tk-actions">
            <CopyButton text={url} label={L('Copy ticket link', 'انسخ رابط التذكرة')} done={L('Link copied', 'تم نسخ الرابط')} />
            <a className="btn btn-line" href={`https://wa.me/?text=${encodeURIComponent(`${tr(ev.title, lang)} — ${url}`)}`} target="_blank" rel="noopener noreferrer">{L('Save to WhatsApp', 'احفظها على واتساب')}</a>
            <a className="btn btn-line" href={`/${lang}#events`}>{L('More events', 'فعاليات أخرى')}</a>
          </div>
          <p className="tk-save">{L('Keep this link: it’s your ticket. Staff can also find it with your code.', 'احتفظ بالرابط ده: هو تذكرتك. والموظفين يقدروا يلاقوها بالكود.')}</p>

          {canCheckIn && valid && !b.checked_in_at && (
            <form action={staffCheckInTicketAction} className="tk-staff">
              <input type="hidden" name="id" value={b.id} /><input type="hidden" name="back" value={`/${lang}/tickets/${b.ticket_code}`} />
              <span>{L('Staff:', 'للموظفين:')} {staff!.name}</span>
              <button className="btn btn-primary btn-sm" type="submit">{L('Check in guest', 'تسجيل دخول الضيف')}</button>
            </form>
          )}

          {b.status === 'awaiting_payment' && (
            <section className="tk-pay" id="pay" aria-labelledby="payH">
              <h2 id="payH">{L('Complete your payment', 'أكمل الدفع')}</h2>
              <p className="tk-due">{L('Amount due', 'المبلغ المطلوب')}: <b dir="ltr">{total}</b></p>
              <div className="tk-pay-grid">
                {paymobEnabled(b.currency) && (
                  <form action={retryEventPaymobAction} className="tk-pay-card">
                    <input type="hidden" name="lang" value={lang} /><input type="hidden" name="code" value={b.ticket_code} />
                    <h3>{L('Card or mobile wallet', 'بطاقة أو محفظة إلكترونية')}</h3>
                    <p>{L('Secure checkout by Paymob. Your ticket activates instantly.', 'دفع آمن عبر Paymob. التذكرة تتفعّل فورًا.')}</p>
                    <button className="btn btn-book" type="submit">{L('Pay now', 'ادفع الآن')}</button>
                  </form>
                )}
                {instapayEnabled(b.currency) && (
                  <form action={submitEventInstapayAction} className="tk-pay-card">
                    <input type="hidden" name="lang" value={lang} /><input type="hidden" name="code" value={b.ticket_code} />
                    <h3>InstaPay</h3>
                    <ol className="tk-steps">
                      <li>{L('Open your bank app or InstaPay and send', 'افتح تطبيق البنك أو InstaPay وحوّل')} <b dir="ltr">{total}</b></li>
                      {ip.address && <li>{L('To InstaPay address', 'على عنوان InstaPay')} <b dir="ltr" className="sel">{ip.address}</b></li>}
                      {ip.phone && <li>{L('Or to mobile number', 'أو على رقم')} <b dir="ltr" className="sel">{ip.phone}</b></li>}
                      <li>{L('Account name', 'اسم الحساب')}: <b>{ip.name}</b></li>
                      <li>{L('Write this code in the transfer note:', 'اكتب الكود ده في ملاحظة التحويل:')} <b dir="ltr" className="sel">{b.ticket_code}</b></li>
                    </ol>
                    {ip.link && <a className="btn btn-line btn-sm" href={ip.link} target="_blank" rel="noopener noreferrer">{L('Open InstaPay link', 'افتح رابط InstaPay')}</a>}
                    <div className="evb-field"><label htmlFor="ip-name">{L('Sender name', 'اسم المحوِّل')}</label><input id="ip-name" name="payerName" required minLength={2} maxLength={80} defaultValue={b.full_name} /></div>
                    <div className="evb-field"><label htmlFor="ip-ref">{L('Transfer reference number', 'رقم العملية (Reference)')}</label><input id="ip-ref" name="payerRef" required minLength={3} maxLength={60} dir="ltr" /></div>
                    <button className="btn btn-primary" type="submit">{L('I’ve sent the transfer', 'حوّلت المبلغ')}</button>
                  </form>
                )}
                {!paymobEnabled(b.currency) && !instapayEnabled(b.currency) && (
                  <div className="tk-pay-card">
                    <p>{L('Online payment isn’t available right now. Message us and we’ll sort it out.', 'الدفع أونلاين غير متاح الآن. راسلنا وهنظبطها.')}</p>
                    <a className="btn btn-wa" href={`https://wa.me/201040551515?text=${encodeURIComponent('Ticket ' + b.ticket_code)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                  </div>
                )}
              </div>
            </section>
          )}

          {b.status === 'pending_verification' && (
            <p className="tk-note">{L('We received your InstaPay details. Reception checks transfers during front-desk hours (8 AM–10 PM) and your ticket turns valid as soon as it’s confirmed.', 'وصلتنا بيانات تحويل InstaPay. الاستقبال بيراجع التحويلات من ٨ صباحًا لـ ١٠ مساءً، وتذكرتك تتفعّل أول ما يتأكد التحويل.')}</p>
          )}
          {b.status === 'expired' && (
            <p className="tk-note">{L('This booking was not paid in time and the place was released.', 'لم يتم الدفع في الوقت وتم إلغاء حجز المكان.')} <a href={`/${lang}/events/${ev.slug}`}>{L('Book again', 'احجز من جديد')}</a></p>
          )}
        </div>
      </main>
      <ClaudeFooter lang={lang} />
    </div>
  );
}
