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
  saveWalletsAction, saveAdminBotAction, testAdminBotAction, saveWhatsAppAction, moveEventAction,
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
          {!anyWallet && <>No InstaPay account is set, so guests cannot pay by transfer. </>}
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

      {receipts.length > 0 && <p className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><b>{receipts.length}</b> InstaPay receipt(s) waiting. <Link className="font-semibold underline" href="/dashboard/payments">Check them in Payments to check</Link>.</p>}
      <section className="rounded-2xl border border-cocoa-200 bg-white p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {[['Today', today, today], ['Tomorrow', addDays(today, 1), addDays(today, 1)], ['Next 7 days', today, addDays(today, 6)], ['Next 14 days', today, addDays(today, 13)], ['Next 30 days', today, addDays(today, 29)]].map(([l, f, t]) => {
            const on = from === f && to === t;
            return <Link key={l} href={`/dashboard/events?from=${f}&to=${t}${sp.status ? `&status=${sp.status}` : ''}`} className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on ? 'border-cocoa-800 bg-cocoa-800 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-cocoa-50'}`}>{l}</Link>;
          })}
          <form className="ms-auto flex flex-wrap items-center gap-2 text-sm">
            {sp.status && <input type="hidden" name="status" value={sp.status} />}
            <input type="date" name="from" defaultValue={from} aria-label="From" className="h-10 w-40 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
            <span className="text-slate-400">→</span>
            <input type="date" name="to" defaultValue={to} aria-label="To" className="h-10 w-40 rounded-lg border border-slate-300 bg-white px-2 text-sm" />
            <button className={BtnGhost}>Show</button>
          </form>
        </div>
        <div className="mb-5 flex flex-wrap gap-1.5 text-xs">
          {[['', 'All'], ...Object.entries(ST).map(([k, [l]]) => [k, l])].map(([k, l]) => (
            <Link key={k} href={`/dashboard/events?from=${from}&to=${to}${k ? `&status=${k}` : ''}`} className={`rounded-full px-2.5 py-1 font-semibold ${(sp.status || '') === k ? 'bg-cocoa-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{l}</Link>
          ))}
        </div>
        {bookings.length === 0 ? <Empty>No event bookings in this period.</Empty> : (
          [...byDay.entries()].map(([day, rows]) => (
            <div key={day} className="mb-6 last:mb-0">
              <h3 className="sticky top-0 z-[1] mb-2 flex flex-wrap items-center gap-2 bg-white py-1 text-sm font-semibold text-cocoa-800">
                {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'))}
                {day === today && <span className="rounded-full bg-cocoa-800 px-2 py-0.5 text-xs text-white">Today</span>}
                <span className="text-xs font-normal text-slate-500">{rows.filter((b: any) => !['cancelled', 'expired'].includes(b.status)).reduce((t: number, b: any) => t + b.quantity, 0)} guest(s)</span>
                {dinners(rows) > 0 && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">{dinners(rows)} dinner{dinners(rows) === 1 ? '' : 's'} for the kitchen</span>}
              </h3>
              <ul className="grid gap-2">
                {[...rows].sort((x: any, y: any) => Number(['cancelled', 'expired'].includes(x.status)) - Number(['cancelled', 'expired'].includes(y.status))).map((b: any) => {
                  const [label, cls] = ST[b.status] ?? [b.status, 'bg-slate-100'];
                  const opt = b.option_key ? (b.options as any[]).find((o) => o.key === b.option_key)?.en : null;
                  const phone = normalizePhone(b.phone);
                  const open = !['cancelled', 'expired'].includes(b.status);
                  return (
                    <li key={b.id} className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border px-4 py-3 ${open ? 'border-slate-200' : 'border-slate-100 bg-slate-50 opacity-70'}`}>
                      <div className="w-14 shrink-0 text-center"><b className="block text-sm tabular-nums text-cocoa-800">{b.start_time}</b><span className="text-[11px] text-slate-500">× {b.quantity}</span></div>
                      <div className="min-w-[12rem] flex-1">
                        <p className="font-semibold text-slate-900">{b.full_name}{b.is_hotel_guest && <span className="ms-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800">Hotel guest {b.stay_reference}</span>}</p>
                        <p className="text-xs text-slate-600">{tr(b.title, 'en')}{opt ? ` · ${opt}` : ''}{b.dinner ? ' · + dinner' : ''} · <Link className="font-mono underline" href={`/${b.language || 'en'}/tickets/${b.ticket_code}`}>{b.ticket_code}</Link></p>
                        <p className="text-xs text-slate-500">{b.phone || b.email}</p>
                      </div>
                      <div className="text-end">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                        <p className="mt-1 text-sm font-semibold tabular-nums">{fmt(Number(b.total_cents), b.currency)}</p>
                        <p className="text-[11px] text-slate-500">{METHOD[b.pay_method] ?? b.pay_method}{b.checked_in_at ? ' · checked in' : b.attendance_confirmed_at ? ' · coming' : open && b.confirmed_at ? ' · confirmed' : ''}</p>
                      </div>
                      <div className="flex w-full flex-wrap justify-end gap-1.5 sm:w-auto">
                        {b.status === 'paid' && !b.checked_in_at && <form action={checkInEventAction}><input type="hidden" name="id" value={b.id} /><button className={Btn}>Check in</button></form>}
                        {['pay_on_site', 'awaiting_payment'].includes(b.status) && <a href="/pos" target="_blank" rel="noopener" className={Btn} title="POS → Event ticket payment">Pay on POS</a>}
                        {open && !b.confirmed_at && b.status !== 'pending_verification' && <form action={confirmEventBookingAction}><input type="hidden" name="id" value={b.id} /><button className={BtnGhost} title="Tells the guest on WhatsApp the booking is confirmed">Confirm</button></form>}
                        {phone && <a className={BtnGhost} href={`https://wa.me/${phone}`} target="_blank" rel="noopener" title="Open WhatsApp chat" aria-label="WhatsApp"><Icon name="message-square" size={16} /></a>}
                        {open && !b.checked_in_at && <form action={cancelEventBookingAction}><input type="hidden" name="id" value={b.id} /><button className={BtnGhost + ' text-red-700'} title="The guest is told on WhatsApp">Cancel</button></form>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}


function OrderButtons({ id, first, last, peers }: { id: string; first: boolean; last: boolean; peers: string }) {
  const B = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-cocoa-50 disabled:opacity-30';
  const arrow = (d: string) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
  const btn = (dir: string, label: string, d: string, off: boolean) => (
    <form action={moveEventAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="dir" value={dir} /><input type="hidden" name="peers" value={peers} />
      <button className={B} disabled={off} title={label} aria-label={label}>{arrow(d)}</button></form>
  );
  return (
    <div className="flex items-center gap-1">
      {btn('top', 'Show first', 'M6 4h12M12 20V9M7 13l5-5 5 5', first)}
      {btn('up', 'Move up', 'M12 19V5M6 11l6-6 6 6', first)}
      {btn('down', 'Move down', 'M12 5v14M6 13l6 6 6-6', last)}
    </div>
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
  const rows = events.map((e: any) => ({ e, why: hiddenReason(e) }));
  const shown = rows.filter((r) => !r.why);
  const hidden = rows.filter((r) => r.why);
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const when = (e: any) => (e.recurrence === 'once' ? `${e.once_date}` : e.recurrence === 'daily' ? 'Every day' : (e.weekdays as number[]).map((d) => DAYS[d]).join(' · '));

  const card = ({ e, why }: { e: any; why: string | null }, idx: number, list: any[]) => {
    const pe = liveById.get(e.id); const pr: any = profitById.get(e.id) ?? { tickets: 0, revenue: 0 };
    const profitCents = Number(pr.revenue) - Number(e.cost_per_attendee_cents) * pr.tickets;
    const m: any = media.get(e.id) ?? { meals: 0, videos: 0 };
    return (
      <article key={e.id} className={`flex flex-col overflow-hidden rounded-2xl border bg-white ${why ? 'border-slate-200 opacity-80' : 'border-cocoa-200'}`}>
        <div className="relative aspect-[16/9] bg-cocoa-50">
          {e.image ? <img src={e.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="grid h-full place-items-center text-cocoa-400"><Icon name="calendar-days" size={36} /></div>}
          {!why && <span className="absolute start-3 top-3 grid h-8 min-w-8 place-items-center rounded-full bg-cocoa-800 px-2 text-sm font-bold text-white shadow" title="Position on the website">{idx + 1}</span>}
          <span className={`absolute end-3 top-3 rounded-full px-2.5 py-1 text-xs font-semibold shadow ${why ? 'bg-amber-100 text-amber-900' : 'bg-emerald-600 text-white'}`}>{why ? 'Hidden' : 'On the website'}</span>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div>
            <h3 className="text-base font-semibold leading-snug text-cocoa-900">{tr(e.title, 'en')}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{e.kind === 'day_use' ? 'Day-use' : 'Event'} · {when(e)} · {e.start_time}–{e.end_time}</p>
            {why && <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">{why}</p>}
          </div>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-cocoa-50 px-2 py-2"><dt className="text-[11px] text-slate-500">Price</dt><dd className="text-sm font-semibold tabular-nums">{fmt(Number(e.price_cents))}</dd></div>
            <div className="rounded-xl bg-cocoa-50 px-2 py-2"><dt className="text-[11px] text-slate-500">Sold</dt><dd className="text-sm font-semibold tabular-nums">{pr.tickets}{pr.pending ? <span className="text-xs text-amber-700"> +{pr.pending}</span> : null}</dd></div>
            <div className="rounded-xl bg-emerald-50 px-2 py-2"><dt className="text-[11px] text-slate-500">Profit</dt><dd className="text-sm font-semibold tabular-nums text-emerald-700">{fmt(profitCents)}</dd></div>
          </dl>
          {!why && <p className="text-xs text-slate-600">{pe?.soldOut ? <Pill tone="red">Sold out</Pill> : pe?.nextDate ? <>Next: <b>{pe.nextDate}</b>{e.capacity != null && <> · {pe.seatsLeftNext} of {e.capacity} seats left</>}</> : null}</p>}
          <p className="text-xs text-slate-500">{m.meals} meal photo{m.meals === 1 ? '' : 's'} · {m.videos} video{m.videos === 1 ? '' : 's'}</p>
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            {canEdit && !why && <OrderButtons id={e.id} first={idx === 0} last={idx === list.length - 1} peers={list.map((x: any) => x.e.id).join(',')} />}
            {!why && <a className={BtnGhost} href={`/en/events/${e.slug}`} target="_blank" rel="noopener">View</a>}
            {canEdit && <Link href={`/dashboard/events/edit/${e.id}`} className={Btn + ' ms-auto'}>Edit</Link>}
          </div>
        </div>
      </article>
    );
  };

  return (
    <>
      <div id="order" className="mb-4 rounded-xl border border-cocoa-200 bg-white px-4 py-3 text-sm text-slate-700">
        <b className="text-cocoa-800">{shown.length} on the website</b>, shown in this order on the home page and the Events page{canEdit ? ': use the arrows on each card to move it (the first arrow puts it first).' : '.'} Profit is for {from} to {to}.
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{shown.map((r, i) => card(r, i, shown))}</div>
      {hidden.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Hidden from the website ({hidden.length})</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{hidden.map((r, i) => card(r, i, hidden))}</div>
        </details>
      )}
    </>
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
          {/* Vodafone Cash is no longer offered (owner, Oct 2026). Its saved settings are kept as they are. */}
          <input type="hidden" name="vfOn" value="" />
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
