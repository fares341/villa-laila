import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, fmt, Btn, BtnGhost, Input, Lbl } from '@/components/dash';
import { Icon } from '@/components/icons';
import { EVENT_COLS, tr, hiddenReason, eventMedia } from '@/services/events';
import { eventSave } from '../../../pms-actions';
import { EventMediaManager } from '@/components/event-media-manager';
import { RichTextarea } from '@/components/rich-textarea';

import { MapPicker } from './map-picker';
import { ImageInput } from '@/components/image-input';

export const dynamic = 'force-dynamic';
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function EditEvent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('events.manage');
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === 'new';
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const e: any = isNew ? { kind: sp.kind === 'day_use' ? 'day_use' : 'event', recurrence: 'once', weekdays: [], pay_methods: ['paymob', 'instapay', 'cash'], active: true, start_time: '19:00', end_time: '22:00', includes: [] }
    : (await q<any>(`SELECT ${EVENT_COLS} FROM events WHERE id=$1`, [id]))[0];
  if (!e) notFound();
  const v = (n: number | null | undefined) => (n == null ? '' : Number(n) / 100);
  const media = isNew ? [] : await eventMedia(e.id);
  const others = await q<any>(`SELECT id, title, price_cents, recurrence, weekdays, once_date FROM events WHERE active AND ($1::uuid IS NULL OR id <> $1::uuid) ORDER BY sort_order, slug LIMIT 40`, [isNew ? null : e.id]);
  const why = isNew ? null : hiddenReason(e);
  const profitPer = Number(e.price_cents ?? 0) - Number(e.cost_per_attendee_cents ?? 0);

  return (
    <>
      <PageHeader title={isNew ? (e.kind === 'day_use' ? 'New day-use package' : 'New event') : tr(e.title, 'en')} sub="Saving publishes it on the website right away (if active). Bookings stop automatically when capacity is reached.">
        <Link href="/dashboard/events" className={BtnGhost}><Icon name="chevron-left" size={16} /> Events</Link>
        {!isNew && e.active && <a href={`/en/events/${e.slug}`} target="_blank" rel="noopener" className={BtnGhost}><Icon name="external-link" size={16} /> View on website</a>}
      </PageHeader>
      <Flash sp={sp} />
      {why && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950"><b>Not on the website right now:</b> {why}.</p>}
      <form action={eventSave} className="grid gap-5 xl:grid-cols-3">
        {!isNew && <input type="hidden" name="id" value={e.id} />}
        <div className="space-y-5 xl:col-span-2">
          <Card title="Details">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Lbl htmlFor="e-k">Type</Lbl>
                <select id="e-k" name="kind" defaultValue={e.kind} className={Input}><option value="event">Event (party, night, workshop)</option><option value="day_use">Day-use (pool day, day pass)</option></select></div>
              <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={e.active} /> Published on the website</label>
              <div><Lbl htmlFor="e-te">Title (English)</Lbl><input id="e-te" name="titleEn" required defaultValue={e.title?.en ?? ''} className={Input} /></div>
              <div><Lbl htmlFor="e-ta">Title (Arabic)</Lbl><input id="e-ta" name="titleAr" dir="rtl" defaultValue={e.title?.ar ?? ''} className={Input} /></div>
              <div><Lbl htmlFor="e-se">Short summary (English)</Lbl><input id="e-se" name="summaryEn" defaultValue={e.summary?.en ?? ''} className={Input} /></div>
              <div><Lbl htmlFor="e-sa">Short summary (Arabic)</Lbl><input id="e-sa" name="summaryAr" dir="rtl" defaultValue={e.summary?.ar ?? ''} className={Input} /></div>
              <div className="sm:col-span-2"><Lbl htmlFor="e-de">Description (English)</Lbl><RichTextarea id="e-de" name="descriptionEn" defaultValue={e.description?.en ?? ''} placeholder="What the event is, what happens, what to bring…" /></div>
              <div className="sm:col-span-2"><Lbl htmlFor="e-da">Description (Arabic)</Lbl><RichTextarea id="e-da" name="descriptionAr" dir="rtl" defaultValue={e.description?.ar ?? ''} placeholder="الإيفنت عن إيه، هيحصل فيه إيه، تجيب معاك إيه…" /></div>
              <div className="sm:col-span-2"><Lbl htmlFor="e-in">What’s included (one per line)</Lbl><textarea id="e-in" name="includes" rows={3} defaultValue={(e.includes ?? []).map((x: any) => x.en).join('\n')} className={Input} /></div>
            </div>
          </Card>

          <Card title="Event page look, videos & meal photos" className="scroll-mt-6" id="media">
            <EventMediaManager eventId={isNew ? null : e.id} items={media.map((m) => ({ id: m.id, kind: m.kind, src: m.src, external: m.external, orientation: m.orientation, size: m.size, mime: m.mime }))} />
          </Card>
          <Card title="Date & time">
            <div className="grid gap-3 sm:grid-cols-3">
              <div><Lbl htmlFor="e-r">Repeats</Lbl>
                <select id="e-r" name="recurrence" defaultValue={e.recurrence} className={Input}><option value="once">One date</option><option value="weekly">Weekly</option><option value="daily">Every day</option></select></div>
              <div><Lbl htmlFor="e-od">Date (one-off)</Lbl><input id="e-od" name="onceDate" type="date" defaultValue={e.once_date ?? ''} className={Input} /></div>
              <div><Lbl htmlFor="e-end">Repeat until (optional)</Lbl><input id="e-end" name="endsOn" type="date" defaultValue={e.ends_on ?? ''} className={Input} /></div>
              <div><Lbl htmlFor="e-st">Starts</Lbl><input id="e-st" name="startTime" type="time" required defaultValue={e.start_time} className={Input} /></div>
              <div><Lbl htmlFor="e-et">Ends</Lbl><input id="e-et" name="endTime" type="time" required defaultValue={e.end_time} className={Input} /></div>
            </div>
            <fieldset className="mt-3"><legend className="mb-1 text-sm font-medium text-slate-700">Weekdays (weekly)</legend>
              <div className="flex flex-wrap gap-2">{WD.map((d, i) => (
                <label key={d} className="flex items-center gap-1.5 rounded-lg border border-cocoa-200 px-3 py-1.5 text-sm has-[:checked]:border-cocoa-800 has-[:checked]:bg-cocoa-800 has-[:checked]:text-white">
                  <input type="checkbox" name="weekdays" value={i} defaultChecked={(e.weekdays ?? []).includes(i)} className="sr-only" />{d}</label>))}</div>
            </fieldset>
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Price, cost & capacity">
            <div className="grid grid-cols-2 gap-3">
              <div><Lbl htmlFor="e-p">Visitor price (not staying at the villa), EGP</Lbl><input id="e-p" name="price" type="number" min={0} step="0.01" required defaultValue={v(e.price_cents)} className={Input} /></div>
              <div><Lbl htmlFor="e-c">Cost per attendee (EGP)</Lbl><input id="e-c" name="cost" type="number" min={0} step="0.01" defaultValue={v(e.cost_per_attendee_cents)} className={Input} /></div>
              <div><Lbl htmlFor="e-cap">Capacity per date</Lbl><input id="e-cap" name="capacity" type="number" min={1} placeholder="Unlimited" defaultValue={e.capacity ?? ''} className={Input} /></div>
            </div>
            <fieldset className="mt-4 rounded-xl border border-cocoa-200 p-3">
              <legend className="px-1 text-sm font-semibold text-cocoa-800">Villa guests (staying at the hostel)</legend>
              <p className="mb-2 text-xs text-slate-500">Shown in the price on the event page and card, next to the visitor price.</p>
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2"><input type="radio" name="guestMode" value="pwyw" defaultChecked={(e.guest_mode ?? 'pwyw') === 'pwyw'} className="mt-1" /> <span><b>Pay what you want</b> · the booking form shows «I’m staying at Villa Layla» and they write what they’ll pay, at the villa</span></label>
                <label className="flex items-start gap-2"><input type="radio" name="guestMode" value="fixed" defaultChecked={e.guest_mode === 'fixed'} className="mt-1" /> <span><b>A fixed price</b> for villa guests, paid at the villa:</span></label>
                <div className="ps-6"><input name="guestPrice" type="number" min={0} step="0.01" placeholder="Price per villa guest (EGP)" defaultValue={v(e.guest_price_cents)} className={Input} /></div>
                <label className="flex items-start gap-2"><input type="radio" name="guestMode" value="free" defaultChecked={e.guest_mode === 'free'} className="mt-1" /> <span><b>Free</b> for villa guests</span></label>
                <label className="flex items-start gap-2"><input type="radio" name="guestMode" value="percent" defaultChecked={e.guest_mode === 'percent'} className="mt-1" /> <span><b>A discount</b> off the visitor price, in %:</span></label>
                <div className="ps-6"><input name="guestPct" type="number" min={1} max={100} step="1" placeholder="e.g. 30 (%)" defaultValue={e.guest_discount_pct ?? ''} className={Input} /></div>
                <label className="flex items-start gap-2"><input type="radio" name="guestMode" value="none" defaultChecked={e.guest_mode === 'none'} className="mt-1" /> <span><b>No villa-guest option</b> · everyone books at the normal price</span></label>
              </div>
            </fieldset>
            {!isNew && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Profit per ticket: <b>{fmt(profitPer)}</b>{e.capacity ? <> · full house: <b>{fmt(profitPer * e.capacity)}</b></> : null}</p>}
          </Card>
          <Card title="Dinner add-on">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="dinnerOn" defaultChecked={isNew ? e.kind !== 'day_use' : e.dinner_cents != null} /> Offer «Home-cooked dinner by the pool» when booking</label>
            <div className="mt-2"><Lbl htmlFor="e-dinner">Dinner price per person (EGP)</Lbl>
              <input id="e-dinner" name="dinner" type="number" min={1} step="0.01" defaultValue={isNew ? 300 : e.dinner_cents != null ? v(e.dinner_cents) : 300} className={Input} />
              <p className="mt-1 text-xs text-slate-500">The guest ticks it on the booking form: total = (ticket + dinner) × people. It shows on the booking, the ticket, Telegram and the POS so the kitchen knows how many dinners.</p></div>
          </Card>
          <Card title="Add another event the same day">
            {others.length === 0 ? <p className="text-sm text-slate-500">No other events yet.</p> : (
              <div className="space-y-2 text-sm">
                <p className="text-xs text-slate-500">Ticked events are offered on this event’s booking form when they also happen on the chosen day (e.g. Pool Day + Poolside Dinner). The guest pays both together; seats are held in both.</p>
                {others.map((o: any) => (
                  <label key={o.id} className="flex items-center gap-2"><input type="checkbox" name="addonEvents" value={o.id} defaultChecked={(e.addon_event_ids ?? []).includes(o.id)} /> {tr(o.title, 'en')} <span className="text-xs text-slate-500">· {fmt(Number(o.price_cents))} · {o.recurrence === 'once' ? o.once_date : o.recurrence === 'daily' ? 'daily' : (o.weekdays as number[]).map((d) => WD[d]).join(', ')}</span></label>
                ))}
              </div>
            )}
          </Card>
          <Card title="Address & map">
            <MapPicker addressAr={e.address?.ar ?? ''} addressEn={e.address?.en ?? ''} mapUrl={e.map_url ?? ''} />
          </Card>
          <Card title="WhatsApp group of this event">
            <Lbl htmlFor="e-wg">Group invite link (optional)</Lbl>
            <input id="e-wg" name="waGroup" dir="ltr" defaultValue={e.whatsapp_group ?? ''} placeholder="https://chat.whatsapp.com/…" className={Input} />
            <p className="mt-1 text-xs text-slate-500">Shown on the event page as «Join the event’s WhatsApp group». Empty = the page shows the Villa Layla community instead. In WhatsApp: group → Invite via link → Copy link.</p>
          </Card>
          <Card title="Meal shown on the page">
            <select name="menuKind" defaultValue={e.menu_kind ?? ''} className={Input}>
              <option value="">Automatic (dinner menu when there is a dinner add-on or meal photos)</option>
              <option value="dinner">Weekly dinner menu</option>
              <option value="breakfast">Weekly breakfast menu</option>
              <option value="none">No menu</option>
            </select>
            <p className="mt-1 text-xs text-slate-500">The menus are in <Link className="underline" href="/dashboard/events/menu">Events → Weekly menu</Link>.</p>
          </Card>
          <Card title="Payment on the website">
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="payMethods" value="paymob" defaultChecked={(e.pay_methods ?? []).includes('paymob')} /> Paymob (card / wallet, ticket issued instantly)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="payMethods" value="instapay" defaultChecked={(e.pay_methods ?? []).includes('instapay')} /> InstaPay (receipt uploaded, you approve)</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="payMethods" value="cash" defaultChecked={(e.pay_methods ?? []).includes('cash')} /> Pay cash at the villa</label>
              <div className="pt-2"><Lbl htmlFor="e-dep">Deposit per ticket for InstaPay (EGP)</Lbl>
                <input id="e-dep" name="deposit" type="number" min={1} step="0.01" placeholder="Empty = pay the full price online" defaultValue={v(e.deposit_cents)} className={Input} />
                <p className="mt-1 text-xs text-slate-500">The guest sends only the deposit online; the rest is taken at the villa on the POS (Events → Booked online).</p></div>
              <p className="text-xs text-slate-500">Accounts are set in <Link className="underline" href="/dashboard/events?tab=settings">Events → Payment accounts</Link>.</p>
            </div>
          </Card>
          <Card title="Cover photo">
            {e.image && <img src={e.image} alt="" className="mb-3 aspect-video w-full rounded-lg object-cover" />}
            <ImageInput name="image" max={2400} className="block w-full text-sm" label="Upload image" />
            <p className="mt-1 text-xs text-slate-500">JPG, PNG or WebP. Big phone photos are made lighter before saving. 16:9 looks best.</p>
            <div className="mt-3"><Lbl htmlFor="e-iu">Or image URL</Lbl><input id="e-iu" name="imageUrl" dir="ltr" defaultValue={e.has_upload ? '' : e.image ?? ''} className={Input} /></div>
          </Card>
          <button className={Btn + ' w-full py-3 text-base'}><Icon name="check" size={18} /> {isNew ? 'Create and publish' : 'Save changes'}</button>
        </div>
      </form>

    </>
  );
}
