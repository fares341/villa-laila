import { notFound } from 'next/navigation';
import { isSiteLang } from '@/i18n/site';
import { ClaudeHeader, ClaudeFooter } from '@/components/claude-shell';
import { getTicket, ticketValid, tr } from '@/services/events';
import { priceLabel } from '@/services/event-view';
import { paymobEnabled } from '@/services/paymob';
import { getWallets } from '@/services/wallets';
import { liveMethods } from '@/services/events';
import { timeLabel, dateLabel } from '@/lib/event-dates';
import { qrSvg } from '@/lib/qr';
import { siteBase } from '@/lib/base-url';
import { currentUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { retryEventPaymobAction, submitEventWalletAction, confirmAttendanceAction } from '../../events/actions';
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
  const wallets = await getWallets();
  const ip = wallets.instapay;
  const methods = liveMethods(ev, wallets);
  const walletMethods = (['instapay', 'vodafone_cash'] as const).filter((m) => methods.includes(m));
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
    sp.attend === 'ok' ? { cls: 'ok', text: L('Thanks for confirming. See you soon!', 'شكرًا على التأكيد. مستنيينك!') } :
    sp.payment === 'submitted' ? { cls: 'wait', text: L('Thanks! We received your receipt. We’ll check the transfer and confirm your booking on WhatsApp shortly.', 'شكرًا! وصلنا الإيصال. هنراجع التحويل ونأكد حجزك على واتساب قريبًا.') } :
    sp.payment === 'unavailable' ? { cls: 'bad', text: L('Card payment isn’t available right now. Pay with InstaPay or message us on WhatsApp.', 'الدفع بالبطاقة غير متاح الآن. ادفع بـ InstaPay أو راسلنا على واتساب.') } :
    sp.error ? { cls: 'bad', text: sp.error === 'proof_required' ? L('Attach the screenshot of your InstaPay transfer.', 'ارفع صورة إيصال تحويل InstaPay.') : sp.error === 'instapay_input' ? L('Enter the sender name and the transfer reference.', 'اكتب اسم المحوِّل ورقم العملية.') : L('Something went wrong. Please try again.', 'حدث خطأ. حاول مرة أخرى.') } :
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
                {walletMethods.map((m) => (
                  <form key={m} action={submitEventWalletAction} className="tk-pay-card">
                    <input type="hidden" name="lang" value={lang} /><input type="hidden" name="code" value={b.ticket_code} /><input type="hidden" name="method" value={m} />
                    <h3>{m === 'instapay' ? 'InstaPay' : L('Vodafone Cash', 'فودافون كاش')}</h3>
                    <ol className="tk-steps">
                      <li>{L('Send', 'حوّل')} <b dir="ltr">{total}</b></li>
                      {m === 'instapay' && ip.address && <li>{L('To InstaPay address', 'على عنوان InstaPay')} <b dir="ltr" className="sel">{ip.address}</b></li>}
                      {m === 'instapay' && ip.phone && <li>{L('Or to mobile number', 'أو على رقم')} <b dir="ltr" className="sel">{ip.phone}</b></li>}
                      {m === 'vodafone_cash' && <li>{L('To Vodafone Cash number', 'على رقم فودافون كاش')} <b dir="ltr" className="sel">{wallets.vodafone_cash.number}</b></li>}
                      <li>{L('Account name', 'اسم الحساب')}: <b>{m === 'instapay' ? ip.name : wallets.vodafone_cash.name}</b></li>
                      <li>{L('Upload the receipt here', 'ارفع صورة الإيصال هنا')}</li>
                    </ol>
                    {m === 'instapay' && ip.link && <a className="btn btn-line btn-sm" href={ip.link} target="_blank" rel="noopener noreferrer">{L('Open InstaPay link', 'افتح رابط InstaPay')}</a>}
                    <div className="evb-field"><label htmlFor={`${m}-name`}>{L('Sender name', 'اسم المحوِّل')}</label><input id={`${m}-name`} name="payerName" required minLength={2} maxLength={80} defaultValue={b.full_name} /></div>
                    <div className="evb-field"><label htmlFor={`${m}-ref`}>{L('Transaction number (if shown)', 'رقم العملية (لو موجود)')}</label><input id={`${m}-ref`} name="payerRef" maxLength={60} dir="ltr" /></div>
                    <div className="evb-field"><label htmlFor={`${m}-proof`}>{L('Receipt screenshot (required)', 'صورة الإيصال (مطلوبة)')}</label><input id={`${m}-proof`} name="proof" type="file" accept="image/*,application/pdf" required /></div>
                    <button className="btn btn-primary" type="submit">{L('Send the receipt', 'ابعت الإيصال')}</button>
                  </form>
                ))}
                {!paymobEnabled(b.currency) && !walletMethods.length && (
                  <div className="tk-pay-card">
                    <p>{L('Online payment isn’t available right now. Message us and we’ll sort it out.', 'الدفع أونلاين غير متاح الآن. راسلنا وهنظبطها.')}</p>
                    <a className="btn btn-wa" href={`https://wa.me/201040551515?text=${encodeURIComponent('Ticket ' + b.ticket_code)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
                  </div>
                )}
              </div>
            </section>
          )}

          {b.status === 'pending_verification' && (
            <p className="tk-note">{L('We received your receipt. We check transfers during front-desk hours (8 AM–10 PM); your booking is confirmed as soon as it’s checked and you get a WhatsApp message.', 'وصلنا الإيصال. بنراجع التحويلات من ٨ صباحًا لـ ١٠ مساءً، وحجزك بيتأكد أول ما نراجعه وبيوصلك رسالة على واتساب.')}</p>
          )}
          {['paid', 'pay_on_site', 'pending_verification'].includes(b.status) && !b.attendance_confirmed_at && (sp.attend === '1' || b.reminder_sent_at) && (
            <form action={confirmAttendanceAction} className="tk-attend">
              <input type="hidden" name="lang" value={lang} /><input type="hidden" name="code" value={b.ticket_code} />
              <p>{L('Are you still coming? Let us know so we keep your place ready.', 'لسه جاي؟ أكد لنا عشان نجهز مكانك.')}</p>
              <button className="btn btn-primary" type="submit">{L('Yes, I’m coming', 'أيوه، جاي')}</button>
            </form>
          )}
          {b.attendance_confirmed_at && sp.attend !== 'ok' && <p className="tk-note">{L('You confirmed you’re coming. See you there!', 'أكدت حضورك. مستنيينك!')}</p>}
          {b.status === 'expired' && (
            <p className="tk-note">{L('This booking was not paid in time and the place was released.', 'لم يتم الدفع في الوقت وتم إلغاء حجز المكان.')} <a href={`/${lang}/events/${ev.slug}`}>{L('Book again', 'احجز من جديد')}</a></p>
          )}
        </div>
      </main>
      <ClaudeFooter lang={lang} />
    </div>
  );
}
