import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, Flash, fmt, dt, Btn, BtnGhost, BtnDanger, Input, Lbl, Empty, SubTabs, Pill } from '@/components/dash';
import { listInstapaySubmissions } from '@/services/online-payments';
import { getWallets, walletOn, walletLabel } from '@/services/wallets';
import { getAdminBotConfig } from '@/services/admin-bot';
import { getWhatsAppConfig, normalizePhone } from '@/services/whatsapp';
import { tr, eventProfit, listPublicEvents, hiddenReason, EVENT_COLS } from '@/services/events';
import { Icon } from '@/components/icons';
import {
  checkInEventAction, cancelEventBookingAction, confirmEventBookingAction, findTicketAction,
  saveWalletsAction, saveAdminBotAction, testAdminBotAction, saveWhatsAppAction,
} from './actions';

export const dynamic = 'force-dynamic';

const ST: Record<string, [string, string]> = {
  paid: ['Paid', 'bg-emerald-100 text-emerald-900'],
  pay_on_site: ['Pay at door', 'bg-sky-100 text-sky-900'],
  pending_verification: ['Receipt to check', 'bg-amber-100 text-amber-900'],
  awaiting_payment: ['Awaiting payment', 'bg-slate-100 text-slate-800'],
  expired: ['Expired', 'bg-slate-200 text-slate-600'],
  cancelled: ['Cancelled', 'bg-red-100 text-red-900'],
};
const METHOD: Record<string, string> = { paymob: 'Card (Paymob)', instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash', cash: 'Pay at the door', card: 'Card (POS)' };
const mask = (t: string) => (t ? `${t.slice(0, 6)}…${t.slice(-4)}` : '');

export default async function EventsDashboard({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser('events.bookings');
  const sp = await searchParams;
  const tab = sp.tab === 'events' ? 'events' : sp.tab === 'settings' ? 'settings' : 'bookings';
  const today = todayLocal();
  const from = sp.from || today;
  const to = sp.to || addDays(today, 13);
  const canVerify = can(user.role, 'frontdesk.use');
  const canEdit = can(user.role, 'events.manage');
  const isOwner = can(user.role, 'settings.manage');
  const [receipts, wallets, bot] = await Promise.all([listInstapaySubmissions(), getWallets(true), getAdminBotConfig()]);

  const tabs = [
    { href: '/dashboard/events', label: 'Bookings', icon: 'ticket' },
    { href: '/dashboard/events?tab=events', label: 'Events list', icon: 'calendar-days' },
    ...(canEdit ? [{ href: '/dashboard/events/menu', label: 'Weekly dinner menu', icon: 'utensils' }] : []),
    ...(canEdit ? [{ href: '/dashboard/events?tab=settings', label: 'Payment accounts & bots', icon: 'settings' }] : []),
  ];
  const current = tab === 'bookings' ? '/dashboard/events' : `/dashboard/events?tab=${tab}`;
  const anyWallet = walletOn(wallets, 'instapay') || walletOn(wallets, 'vodafone_cash');

  return (
    <>
      <PageHeader title="Events" sub="Bookings from the website, receipts to check, the events shown on the website, and how guests pay.">
        <form action={findTicketAction} className="flex gap-2">
          <input name="code" placeholder="Ticket code EV-…" className={Input + ' w-44'} aria-label="Ticket code" />
          <button className={BtnGhost + ' whitespace-nowrap'}>Find ticket</button>
        </form>
        {canEdit && <Link href="/dashboard/events/edit/new" className={Btn}><Icon name="plus" size={16} /> New event</Link>}
      </PageHeader>
      <SubTabs tabs={tabs} current={current} />
      <Flash sp={sp} />

      {tab === 'bookings' && <Bookings {...{ sp, from, to, today, receipts, canVerify }} />}
      {tab === 'events' && <EventsList {...{ from, to, canEdit }} />}
      {tab === 'settings' && canEdit && <Settings {...{ wallets, bot, isOwner }} />}
      {tab === 'bookings' && canEdit && (!anyWallet || !bot.token) && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {!anyWallet && <>No InstaPay or Vodafone Cash account is set, so guests cannot pay by transfer. </>}
          {!bot.token && <>The Telegram admin bot is not connected yet, so new bookings are not sent to you. </>}
          <Link className="font-semibold underline" href="/dashboard/events?tab=settings">Open settings</Link>
        </p>
      )}
    </>
  );
}

async function Bookings({ sp, from, to, today, receipts, canVerify }: any) {
  const bookings = await q<any>(`
    SELECT b.*, e.title, e.slug, e.start_time, e.options
    FROM event_bookings b JOIN events e ON e.id=b.event_id
    WHERE b.event_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR b.status=$3)
      AND NOT (b.status='awaiting_payment' AND b.hold_expires_at < now())
    ORDER BY b.event_date, e.start_time, b.created_at`, [from, to, sp.status || null]);
  const byDay = new Map<string, any[]>();
  for (const b of bookings) byDay.set(b.event_date, [...(byDay.get(b.event_date) ?? []), b]);
  const live = bookings.filter((b) => ['paid', 'pay_on_site', 'pending_verification'].includes(b.status));
  const people = live.reduce((s, b) => s + b.quantity, 0);
  const paidEgp = bookings.filter((b) => b.status === 'paid').reduce((s, b) => s + Number(b.total_cents), 0);
  const todayCount = live.filter((b) => b.event_date === today).reduce((s, b) => s + b.quantity, 0);
  // Dinner add-on: meals the kitchen prepares (live bookings only).
  const dinners = (rows: any[]) => rows.filter((b) => b.dinner && ['paid', 'pay_on_site', 'pending_verification'].includes(b.status)).reduce((s, b) => s + b.quantity, 0);
  const dinnersToday = dinners(live.filter((b) => b.event_date === today));

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Guests today', String(todayCount)], ['Dinners today (kitchen)', String(dinnersToday)], ['Booked (period)', String(people)], ['Paid (period)', fmt(paidEgp)], ['Receipts to check', String(receipts.length)]].map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-cocoa-200 bg-white p-4"><p className="text-xs text-slate-600">{k}</p><p className="mt-1 text-2xl font-semibold text-cocoa-800">{v}</p></div>
        ))}
      </div>

      {receipts.length > 0 && <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><b>{receipts.length}</b> InstaPay / Vodafone Cash receipt(s) waiting. <Link className="font-semibold underline" href="/dashboard/payments">Check them in Payments to check</Link>.</p>}
      <Card title="Event bookings">
        <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
          <label>From <input type="date" name="from" defaultValue={from} className={Input + ' w-40'} /></label>
          <label>To <input type="date" name="to" defaultValue={to} className={Input + ' w-40'} /></label>
          <label>Status
            <select name="status" defaultValue={sp.status || ''} className={Input + ' w-48'}>
              <option value="">All</option>
              {Object.entries(ST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <button className={BtnGhost}>Filter</button>
        </form>
        {bookings.length === 0 ? <Empty>No event bookings in this period.</Empty> : (
          [...byDay.entries()].map(([day, rows]) => (
            <div key={day} className="mb-5">
              <h3 className="mb-2 font-semibold text-cocoa-800">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))}{day === today && ' · today'}{dinners(rows) > 0 && <span className="ms-2 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">{dinners(rows)} dinner{dinners(rows) === 1 ? '' : 's'} for the kitchen</span>}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-slate-600"><tr><th className="py-1.5">Ticket</th><th>Event</th><th>Guest</th><th>Qty</th><th>Total</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {rows.map((b: any) => {
                      const [label, cls] = ST[b.status] ?? [b.status, 'bg-slate-100'];
                      const opt = b.option_key ? (b.options as any[]).find((o) => o.key === b.option_key)?.en : null;
                      const phone = normalizePhone(b.phone);
                      const open = !['cancelled', 'expired'].includes(b.status);
                      return (
                        <tr key={b.id} className="border-t border-slate-100 align-top">
                          <td className="py-2 font-mono"><Link className="underline" href={`/${b.language || 'en'}/tickets/${b.ticket_code}`}>{b.ticket_code}</Link></td>
                          <td>{tr(b.title, 'en')} <span className="text-slate-500">{b.start_time}</span>{opt && <div className="text-xs text-slate-600">{opt}</div>}{b.dinner && <div className="text-xs font-semibold text-amber-800">+ Dinner by the pool × {b.quantity}</div>}</td>
                          <td>{b.full_name}<div className="text-xs text-slate-600">{b.phone || b.email}</div>{b.is_hotel_guest && <div className="text-xs text-emerald-800">Hotel guest {b.stay_reference}</div>}</td>
                          <td className="num">{b.quantity}</td>
                          <td className="whitespace-nowrap">{fmt(Number(b.total_cents), b.currency)}<div className="text-xs text-slate-500">{METHOD[b.pay_method] ?? b.pay_method}</div></td>
                          <td>
                            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                            {open && b.confirmed_at && <div className="mt-1 text-xs text-emerald-800">Confirmed</div>}
                            {b.attendance_confirmed_at && <div className="text-xs text-emerald-800">Said they are coming</div>}
                            {b.checked_in_at && <div className="text-xs text-emerald-800">Checked in {dt(b.checked_in_at)}</div>}
                          </td>
                          <td className="whitespace-nowrap">
                            <div className="flex flex-wrap gap-1">
                              {open && !b.confirmed_at && b.status !== 'pending_verification' && (
                                <form action={confirmEventBookingAction}><input type="hidden" name="id" value={b.id} /><button className={BtnGhost} title="Tells the guest on WhatsApp the booking is confirmed">Send confirmation</button></form>
                              )}
                              {b.status === 'paid' && !b.checked_in_at && (
                                <form action={checkInEventAction}><input type="hidden" name="id" value={b.id} /><button className={Btn}>Check in</button></form>
                              )}
                              {['pay_on_site', 'awaiting_payment'].includes(b.status) && (
                                <a href="/pos" target="_blank" rel="noopener" className={BtnGhost} title="POS → Event ticket payment">Pay on POS</a>
                              )}
                              {phone && <a className={BtnGhost} href={`https://wa.me/${phone}`} target="_blank" rel="noopener" title="Open WhatsApp chat"><Icon name="message-square" size={16} /></a>}
                              {open && !b.checked_in_at && (
                                <form action={cancelEventBookingAction}><input type="hidden" name="id" value={b.id} /><button className={BtnGhost} title="The guest is told on WhatsApp">Cancel</button></form>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </Card>
    </>
  );
}

async function EventsList({ from, to, canEdit }: { from: string; to: string; canEdit: boolean }) {
  const [events, profit, pubEvents, mediaCounts] = await Promise.all([
    q<any>(`SELECT ${EVENT_COLS} FROM events ORDER BY active DESC, sort_order, slug`),
    eventProfit(from, to), listPublicEvents(),
    q<any>(`SELECT event_id, count(*) FILTER (WHERE kind='meal')::int meals, count(*) FILTER (WHERE kind='video')::int videos FROM event_media GROUP BY event_id`).catch(() => []),
  ]);
  const liveById = new Map(pubEvents.map((e) => [e.id, e]));
  const profitById = new Map(profit.map((p: any) => [p.id, p]));
  const media = new Map(mediaCounts.map((m: any) => [m.event_id, m]));
  return (
    <Card title="Events & day-use">
      <p className="mb-3 text-sm text-slate-600">Everything published here is on the website (home page and Events page) right away. Profit = (ticket price − cost per attendee) × tickets sold, {from} to {to}.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-600"><tr><th className="py-2">Event</th><th>On the website</th><th>Schedule</th><th className="text-right">Price</th><th>Next date</th><th className="text-right">Sold</th><th className="text-right">Profit</th><th /></tr></thead>
          <tbody>
            {events.map((e: any) => {
              const pe = liveById.get(e.id); const pr: any = profitById.get(e.id) ?? { tickets: 0, revenue: 0 };
              const profitCents = Number(pr.revenue) - Number(e.cost_per_attendee_cents) * pr.tickets;
              const why = hiddenReason(e); const m: any = media.get(e.id) ?? { meals: 0, videos: 0 };
              return (
                <tr key={e.id} className="border-t border-slate-100 align-top">
                  <td className="py-2"><b>{tr(e.title, 'en')}</b><div className="text-xs text-slate-500">{e.kind === 'day_use' ? 'Day-use' : 'Event'} · {m.meals} meal photo(s) · {m.videos} video(s)</div></td>
                  <td className="text-xs">{why ? <span className="text-amber-800">Hidden: {why}</span> : <a className="font-semibold text-emerald-800 underline" href={`/en/events/${e.slug}`} target="_blank" rel="noopener">Live · open</a>}</td>
                  <td className="text-xs">{e.recurrence === 'once' ? e.once_date : e.recurrence === 'daily' ? 'Daily' : 'Weekly ' + (e.weekdays as number[]).map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}<br />{e.start_time}–{e.end_time}</td>
                  <td className="text-right tabular-nums">{fmt(Number(e.price_cents))}</td>
                  <td className="text-xs">{why ? '—' : pe?.soldOut ? <Pill tone="red">Sold out</Pill> : pe?.nextDate ? <>{pe.nextDate}{e.capacity != null && <div className="text-slate-500">{pe.seatsLeftNext} of {e.capacity} left</div>}</> : '—'}</td>
                  <td className="text-right tabular-nums">{pr.tickets}{pr.pending ? <div className="text-xs text-amber-700">+{pr.pending} pending</div> : null}</td>
                  <td className="text-right font-semibold tabular-nums text-emerald-700">{fmt(profitCents)}</td>
                  <td className="text-right">{canEdit && <Link href={`/dashboard/events/edit/${e.id}`} className={BtnGhost}>Edit</Link>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function Settings({ wallets, bot, isOwner }: { wallets: Awaited<ReturnType<typeof getWallets>>; bot: Awaited<ReturnType<typeof getAdminBotConfig>>; isOwner: boolean }) {
  const wa = await getWhatsAppConfig();
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Payment accounts (shown to guests)">
        <form action={saveWalletsAction} className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="mb-1 flex w-full items-center justify-between font-semibold text-cocoa-800">InstaPay
              <label className="flex items-center gap-2 text-sm font-normal"><input type="checkbox" name="ipOn" defaultChecked={wallets.instapay.enabled} /> Offer on the website</label></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Lbl htmlFor="ip-a">InstaPay address (IPA)</Lbl><input id="ip-a" name="ipAddress" dir="ltr" placeholder="villalayla@instapay" defaultValue={wallets.instapay.address} className={Input} /></div>
              <div><Lbl htmlFor="ip-p">Or mobile number</Lbl><input id="ip-p" name="ipPhone" dir="ltr" placeholder="01xxxxxxxxx" defaultValue={wallets.instapay.phone} className={Input} /></div>
              <div><Lbl htmlFor="ip-n">Account name</Lbl><input id="ip-n" name="ipName" defaultValue={wallets.instapay.name} className={Input} /></div>
              <div><Lbl htmlFor="ip-l">Payment link (optional)</Lbl><input id="ip-l" name="ipLink" dir="ltr" placeholder="https://ipn.eg/S/…" defaultValue={wallets.instapay.link} className={Input} /></div>
            </div>
          </fieldset>
          <fieldset className="space-y-3 border-t border-cocoa-100 pt-4">
            <legend className="mb-1 flex w-full items-center justify-between font-semibold text-cocoa-800">Vodafone Cash
              <label className="flex items-center gap-2 text-sm font-normal"><input type="checkbox" name="vfOn" defaultChecked={wallets.vodafone_cash.enabled} /> Offer on the website</label></legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Lbl htmlFor="vf-n">Vodafone Cash number</Lbl><input id="vf-n" name="vfNumber" dir="ltr" placeholder="010xxxxxxxx" defaultValue={wallets.vodafone_cash.number} className={Input} /></div>
              <div><Lbl htmlFor="vf-a">Name on the wallet</Lbl><input id="vf-a" name="vfName" defaultValue={wallets.vodafone_cash.name} className={Input} /></div>
            </div>
          </fieldset>
          <p className="text-xs text-slate-500">Guests who pick one of these see the account, send the money and upload the receipt with the booking. You approve it here or on Telegram; then the booking is confirmed.</p>
          <button className={Btn}><Icon name="check" size={16} /> Save accounts</button>
        </form>
      </Card>

      <Card title="Telegram admin bot">
        {isOwner ? (
          <>
            <p className="mb-3 text-sm text-slate-600">New bookings and receipts are sent here with buttons to confirm, cancel or edit them. You can also create and edit events, add meal photos and videos from the bot. Make the bot in <b>@BotFather</b> (a different bot from the guest bot) and paste its token.</p>
            <form action={saveAdminBotAction} className="space-y-3">
              <div><Lbl htmlFor="ab-t">Bot token {bot.token && <span className="font-normal text-emerald-700">· saved ({mask(bot.token)})</span>}</Lbl>
                <input id="ab-t" name="token" type="password" autoComplete="off" dir="ltr" placeholder={bot.token ? 'Leave empty to keep the saved token' : '123456789:AA…'} className={Input} /></div>
              <div><Lbl htmlFor="ab-c">Chat IDs that may use the bot</Lbl><input id="ab-c" name="chatIds" dir="ltr" defaultValue={bot.chat_ids.join(', ')} className={Input} /></div>
              <div className="flex flex-wrap gap-2"><button className={Btn}><Icon name="check" size={16} /> Save</button></div>
            </form>
            {bot.token && <form action={testAdminBotAction} className="mt-2"><button className={BtnGhost}>Send a test message</button></form>}
            <p className="mt-3 text-xs text-slate-500">After saving, open the bot in Telegram and press Start. Commands: /bookings, /today, /events, /new.</p>
          </>
        ) : <p className="text-sm text-slate-600">Only the owner can change the bot.</p>}
      </Card>

      <Card title="WhatsApp messages to guests" className="xl:col-span-2">
        {isOwner ? (
          <>
            <p className="mb-3 text-sm text-slate-600">
              Guests get WhatsApp messages when a booking is confirmed or cancelled, and one hour before the event asking them to confirm they are coming.
              {wa.token && wa.phone_number_id ? ' They are sent automatically.' : ' Until the WhatsApp Cloud API is connected below, the Telegram bot gives you a one-tap WhatsApp link with the message already written.'}
            </p>
            <form action={saveWhatsAppAction} className="grid gap-3 md:grid-cols-3">
              <div><Lbl htmlFor="wa-t">Cloud API access token {wa.token && <span className="font-normal text-emerald-700">· saved</span>}</Lbl><input id="wa-t" name="token" type="password" autoComplete="off" dir="ltr" placeholder={wa.token ? 'Leave empty to keep it' : 'EAAG…'} className={Input} /></div>
              <div><Lbl htmlFor="wa-p">Phone number ID</Lbl><input id="wa-p" name="phoneNumberId" dir="ltr" defaultValue={wa.phone_number_id} className={Input} /></div>
              <div><Lbl htmlFor="wa-l">Template language</Lbl><input id="wa-l" name="templateLang" dir="ltr" defaultValue={wa.template_lang} className={Input} /></div>
              <div><Lbl htmlFor="wa-r">Reminder template name</Lbl><input id="wa-r" name="tplReminder" dir="ltr" defaultValue={wa.template_reminder} className={Input} /></div>
              <div><Lbl htmlFor="wa-c">Cancellation template name</Lbl><input id="wa-c" name="tplCancel" dir="ltr" defaultValue={wa.template_cancel} className={Input} /></div>
              <div><Lbl htmlFor="wa-k">Confirmation template name</Lbl><input id="wa-k" name="tplConfirm" dir="ltr" defaultValue={wa.template_confirm} className={Input} /></div>
              <p className="text-xs text-slate-500 md:col-span-3">WhatsApp only lets a business start a conversation with a template approved by Meta. Each template gets 4 values in this order: first name, event name, date and time, ticket link.</p>
              <div className="md:col-span-3"><button className={Btn}><Icon name="check" size={16} /> Save WhatsApp settings</button></div>
            </form>
          </>
        ) : <p className="text-sm text-slate-600">Only the owner can change WhatsApp settings.</p>}
      </Card>
    </div>
  );
}
