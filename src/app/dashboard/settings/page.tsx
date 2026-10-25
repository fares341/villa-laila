import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { getSetting, hostelInfo } from '@/services/settings';
import { DEFAULT_FAQ } from '@/content/faq';
import { PageHeader, Card, Flash, Input, Lbl, Btn, BtnGhost, dt } from '@/components/dash';
import { saveHostelAction, saveTextsAction, saveBookingRulesAction, saveFaqAction, saveGuestVideosAction, createUserAction, updateUserAction, savePolicyRuleAction } from '../actions';

const LANGS: [string, string][] = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['ar', 'العربية']];

export default async function Settings({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser('settings.manage');
  const sp = await searchParams;
  const h: any = await hostelInfo();
  const vids = (await getSetting<string[] | undefined>('guest_videos')) ?? [];
  const cur = await getSetting<string>('currency');
  const pay = await getSetting<any>('payment_instructions'), canc = await getSetting<any>('cancellation_policy'), rules = await getSetting<any>('house_rules');
  const faq = await getSetting<any>('faq');
  const users = await q<any>('SELECT * FROM users ORDER BY created_at');
  const pol = await q<any>('SELECT * FROM policy_rules ORDER BY created_at DESC NULLS LAST, name').catch(() => q<any>('SELECT * FROM policy_rules ORDER BY name'));
  const num = async (k: string) => Number(await getSetting(k));
  const tg = { token: !!process.env.TELEGRAM_BOT_TOKEN, staff: !!process.env.TELEGRAM_STAFF_CHAT_ID, gemini: !!process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash', or: !!process.env.OPENROUTER_API_KEY, orModel: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.5-flash' };
  const ok = (b: boolean) => <span className={b ? 'text-emerald-800' : 'text-red-800'}>{b ? 'Set' : 'Not set'}</span>;
  return (
    <>
      <PageHeader title="Settings" sub="Owner only. Anything left empty is shown to guests as “to be confirmed” — nothing is invented." />
      <Flash sp={sp} />
      <nav aria-label="Set-up pages" className="mb-6 grid gap-3 sm:grid-cols-2">
        <a href="/dashboard/rooms" className="rounded-xl border border-cocoa-200 bg-white p-4 hover:border-cocoa-600"><b className="block">Rooms, beds & prices</b><span className="text-sm text-slate-600">Add or rename rooms and beds, set nightly prices.</span></a>
        <a href="/dashboard/import" className="rounded-xl border border-cocoa-200 bg-white p-4 hover:border-cocoa-600"><b className="block">Import old bookings</b><span className="text-sm text-slate-600">One-time upload of reservations from an Excel / CSV file.</span></a>
      </nav>
      <div className="space-y-6">
        <Card title="Hostel details">
          <form action={saveHostelAction} className="grid gap-3 sm:grid-cols-2">
            {([['name', 'Hostel name', h.name], ['city', 'City / country', h.city], ['address', 'Street address', h.address], ['map_url', 'Google Maps link', h.map_url], ['phone', 'Phone', h.phone], ['whatsapp', 'WhatsApp', h.whatsapp], ['email', 'Public email', h.email], ['checkin_time', 'Check-in time (e.g. from 14:00)', h.checkin_time], ['checkout_time', 'Check-out time (e.g. until 12:00)', h.checkout_time]] as const).map(([k, l, v]) => <div key={k}><Lbl htmlFor={`h_${k}`}>{l}</Lbl><input id={`h_${k}`} name={k} defaultValue={v ?? ''} className={Input} /></div>)}
            <div><Lbl htmlFor="cur">Currency code</Lbl><input id="cur" name="currency" defaultValue={cur} maxLength={5} className={Input} /></div>
            <div className="sm:col-span-2"><button className={Btn}>Save hostel details</button></div></form>
        </Card>
        <Card title="Booking rules">
          <form action={saveBookingRulesAction} className="grid gap-3 sm:grid-cols-4">
            <div><Lbl htmlFor="hh">Hours a website/Telegram request holds beds</Lbl><input id="hh" name="holdHours" type="number" min={1} defaultValue={await num('pending_hold_hours')} className={Input} /></div>
            <div><Lbl htmlFor="hm">Minutes a staff “temporary hold” lasts</Lbl><input id="hm" name="holdMinutes" type="number" min={5} defaultValue={await num('temp_hold_minutes')} className={Input} /></div>
            <div><Lbl htmlFor="mn">Longest stay bookable online (nights)</Lbl><input id="mn" name="maxNights" type="number" min={1} max={365} defaultValue={await num('max_nights')} className={Input} /></div>
            <div><Lbl htmlFor="dp">Verified deposit needed before confirming ({cur}, 0 = none)</Lbl><input id="dp" name="deposit" defaultValue={(await num('confirm_requires_deposit_cents')) / 100} className={Input} /></div>
            <div className="sm:col-span-4"><button className={Btn}>Save booking rules</button></div></form>
        </Card>
        <Card title="Payment instructions, cancellation policy, house rules">
          <p className="mb-3 text-sm text-slate-600">Write these exactly as the hostel wants guests to read them. They appear on the website and are used by the Telegram bot word-for-word. Leave a language empty if you have not written it yet.</p>
          <form action={saveTextsAction} className="space-y-5">{[['payment_instructions', 'Payment instructions', pay], ['cancellation_policy', 'Cancellation policy', canc], ['house_rules', 'House rules', rules]].map(([k, l, v]: any) => (
            <fieldset key={k}><legend className="mb-2 font-semibold">{l}</legend><div className="grid gap-3 sm:grid-cols-2">{LANGS.map(([c, n]) => <div key={c}><Lbl htmlFor={`${k}_${c}`}>{n}</Lbl><textarea id={`${k}_${c}`} rows={3} name={`${k}_${c}`} defaultValue={v?.[c] ?? ''} dir={c === 'ar' ? 'rtl' : 'ltr'} className={Input} /></div>)}</div></fieldset>))}
            <button className={Btn}>Save texts</button></form>
        </Card>
        <Card title="Telegram & AI connection (set in the server .env file, not here)">
          <ul className="text-sm"><li>Bot token (TELEGRAM_BOT_TOKEN): {ok(tg.token)}</li><li>Reception notification chat (TELEGRAM_STAFF_CHAT_ID): {ok(tg.staff)}</li><li>AI key, OpenRouter (OPENROUTER_API_KEY): {ok(tg.or)} · model {tg.orModel}</li><li>Alternative: Gemini key (GEMINI_API_KEY): {ok(tg.gemini)} · model {tg.model} {tg.or ? '(not used: OpenRouter takes priority)' : ''}</li></ul>
          <p className="mt-2 text-xs text-slate-500">Keys are never shown or stored in the database or the browser. Restart the worker after changing them (see the setup guide).</p>
        </Card>
        <Card title="Who can book (house rules)">
          <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">House rules for who can book (for example: Egyptian guests and mixed dorms). A rule does nothing until it is switched <b>Active</b>. An active rule can refuse a booking made online, or flag it for reception to check; bookings typed in by staff are only flagged. Every change is kept as a new version.</p>
          <div className="space-y-4">{[...pol, null].map((p: any, i) => (
            <form key={p?.id ?? 'new'} action={savePolicyRuleAction} className="rounded-lg border border-slate-200 p-4"><input type="hidden" name="id" value={p?.id ?? ''} />
              <p className="mb-2 text-sm font-semibold">{p ? `${p.name} · version ${p.version} · ${p.active ? 'ACTIVE' : 'inactive'}` : 'Add a new rule'}</p>
              <div className="grid gap-3 sm:grid-cols-2"><div><Lbl>Rule name</Lbl><input name="name" required defaultValue={p?.name ?? ''} className={Input} /></div>
                <div><Lbl>What happens when it matches</Lbl><select name="action" defaultValue={p?.action ?? 'review'} className={Input}><option value="inform">Just show the guest a message</option><option value="ask">Ask extra questions</option><option value="review">Send the booking to staff review</option><option value="require_approval">Require manager approval</option><option value="block">Refuse the booking request (guest channels only)</option></select></div>
                <div className="sm:col-span-2"><Lbl>When — conditions (JSON). Example: nationality equals EG</Lbl><textarea name="conditions" rows={2} defaultValue={JSON.stringify(p?.conditions ?? [{ field: 'nationality', op: 'eq', value: 'EG' }])} className={`${Input} font-mono`} /></div>
                {LANGS.map(([c, n]) => <div key={c}><Lbl>Message to guest ({n})</Lbl><textarea name={`message_${c}`} rows={2} defaultValue={p?.message?.[c] ?? ''} dir={c === 'ar' ? 'rtl' : 'ltr'} className={Input} /></div>)}
                <div className="sm:col-span-2"><Lbl>Internal notes (source of the rule, who approved it)</Lbl><input name="notes" defaultValue={p?.notes ?? ''} className={Input} /></div></div>
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p?.active} /> Active (applies to new bookings)</label>
              <button className={`${p ? BtnGhost : Btn} mt-3`}>{p ? 'Save new version' : 'Add rule'}</button></form>))}</div>
        </Card>
        <Card title="Guest videos (homepage)">
          <p className="mb-3 text-sm text-slate-600">Up to 3 videos guests posted about their stay. Paste the link to an Instagram reel, TikTok, YouTube Short or an .mp4 file. Ask the guest before using their video.</p>
          <form action={saveGuestVideosAction} className="grid gap-3">
            {[0, 1, 2].map((i) => <div key={i}><Lbl htmlFor={`v${i + 1}`}>Video {i + 1}</Lbl><input id={`v${i + 1}`} name={`v${i + 1}`} defaultValue={vids[i] ?? ''} placeholder="https://www.instagram.com/reel/…" className={Input} dir="ltr" /></div>)}
            <div><button className={Btn}>Save videos</button></div>
          </form>
        </Card>
        <Card title="Website FAQ">
          <form action={saveFaqAction}><Lbl htmlFor="faq">FAQ as JSON (leave empty to use the default list). Format: [{'{'}"q":{'{'}"en":"…","es":"…","fr":"…","ar":"…"{'}'},"a":{'{'}…{'}'}{'}'}]</Lbl>
            <textarea id="faq" name="faq" rows={8} defaultValue={faq ? JSON.stringify(faq, null, 2) : ''} placeholder={JSON.stringify(DEFAULT_FAQ.slice(0, 1), null, 2)} className={`${Input} font-mono`} /><button className={`${Btn} mt-2`}>Save FAQ</button></form>
        </Card>
        <Card title="Dashboard logins (email + password)">
          <div className="space-y-3">{users.map((u) => (
            <form key={u.id} action={updateUserAction} className="grid items-end gap-2 sm:grid-cols-[1.4fr_9rem_1fr_auto_auto]"><input type="hidden" name="id" value={u.id} />
              <div><p className="text-sm font-medium">{u.name}</p><p className="text-xs text-slate-500">{u.email}</p></div>
              <div><Lbl>Role</Lbl><select name="role" defaultValue={u.role} className={Input}><option value="receptionist">Receptionist</option><option value="event_manager">Event manager</option><option value="manager">Manager</option><option value="owner">Owner</option></select></div>
              <div><Lbl>New password (optional)</Lbl><input name="password" type="password" autoComplete="new-password" minLength={10} className={Input} /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={u.active} /> Active</label><button className={BtnGhost}>Save</button></form>))}</div>
          <form action={createUserAction} className="mt-5 grid gap-3 border-t pt-4 sm:grid-cols-5"><p className="text-sm font-semibold sm:col-span-5">Add a dashboard login <span className="font-normal text-slate-500">(email + password for this website; POS staff and PINs are added under Team)</span></p>
            <div><Lbl>Name</Lbl><input name="name" required className={Input} /></div><div><Lbl>Email</Lbl><input name="email" type="email" required className={Input} /></div>
            <div><Lbl>Password (10+ chars)</Lbl><input name="password" type="password" minLength={10} required autoComplete="new-password" className={Input} /></div>
            <div><Lbl>Role</Lbl><select name="role" className={Input}><option value="receptionist">Receptionist</option><option value="event_manager">Event manager</option><option value="manager">Manager</option><option value="owner">Owner</option></select></div><div className="flex items-end"><button className={Btn}>Create</button></div></form>
          <p className="mt-3 text-xs text-slate-500">Receptionist: reservations, calendar, guests, inbox, extensions, recording payments. Manager: also inventory, rates, verify payments, reports, import, cancel. Owner: everything incl. settings and staff. Event manager: events only (add and edit events, the weekly dinner menu, event bookings).</p>
        </Card>
      </div>
    </>
  );
}
