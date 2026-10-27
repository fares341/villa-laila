import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { can } from '@/lib/permissions';
import { todayLocal, addDays } from '@/lib/dates';
import { Badge, PageHeader, Card, Flash, fmt, dt, Input, Lbl, Btn, BtnGhost, BtnDanger, Pill, HK_LABEL, sourceLabel, STATUS_LABEL } from '@/components/dash';
import { Icon } from '@/components/icons';
import { ConfirmButton } from '@/components/ConfirmButton';
import { BookingError } from '@/services/errors';
import { getFolio } from '@/services/pms/folio';
import { moveOptions } from '@/services/pms/frontdesk';
import { freeNightsAfter } from '@/services/pms/extend';
import { confirmAction, rejectAction, cancelAction, noShowAction, changeDatesAction, addNoteAction, recordPaymentAction, verifyPaymentAction, createExtensionAction } from '../../actions';
import { fdCheckIn, fdCheckOut, fdMoveRoom, folioCharge, folioVoid, folioRateOverride } from '../../pms-actions';

export const dynamic = 'force-dynamic';

const KIND: Record<string, string> = { room: 'Night', pos: 'POS', custom: 'Extra', taxi: 'Taxi', event: 'Event', tour: 'Tour', adjustment: 'Adjustment', discount: 'Discount', comp: 'Free (owner)' };
const METHOD: Record<string, string> = { cash: 'Cash (POS)', card_terminal: 'Card (POS)', instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash', channel_prepaid: 'Paid to the booking site', bank_transfer: 'Bank transfer', online_provider: 'Online', paymob: 'Online card', other: 'Other' };
const RATE: Record<string, string> = { override: 'Changed by manager', booking: 'Booked price', local_rate: 'Our rate', little_hotelier: 'Imported rate', csv_import: 'Imported rate', manual: 'Manual' };
const HISTORY: Record<string, string> = {
  confirmed: 'Confirmed', checked_in: 'Checked in', checked_out: 'Checked out', cancelled: 'Cancelled', rejected: 'Rejected', expired: 'Request expired',
  no_show: 'No-show', dates_changed: 'Dates changed', room_move: 'Moved room / bed', unit_reassigned: 'Moved bed', rate_override: 'Price changed by manager',
  extension_requested: 'Extension asked', extension_applied: 'Stay extended', extension_rejected: 'Extension refused', note: 'Note added', imported: 'Imported',
};
const historyText = (a: string) => a.startsWith('created:') ? `Booked (${STATUS_LABEL[a.slice(8)] ?? a.slice(8)})` : HISTORY[a] ?? a.replace(/_/g, ' ');
const who = (actor: string) => actor?.replace(/^(pos|staff):/, '').replace(/@.*$/, '') || 'system';

/** One page per stay: booking details, the bill, payments, beds and history. Money is taken on the POS. */
export default async function StayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('reservation.view');
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let f;
  try { f = await getFolio(id); } catch (e) { if (e instanceof BookingError) notFound(); throw e; }
  const res = (await q<any>(`SELECT r.*, g.full_name, g.email, g.phone, g.nationality, g.address, g.id gid, t.name tname, t.kind FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN room_types t ON t.id=r.room_type_id WHERE r.id=$1`, [id]))[0];
  const live = ['hold', 'pending', 'confirmed', 'checked_in'].includes(res.status);
  const [units, pays, events, ext, mv] = await Promise.all([
    q<any>(`SELECT ru.id, ru.active, ru.during::text during, ru.guests, u.label, rm.name room, rm.hk_status, t.kind FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id
            WHERE ru.reservation_id=$1 ORDER BY ru.active DESC, lower(ru.during), rm.name, length(u.label), u.label`, [id]),
    q<any>(`SELECT p.*, b.name ver FROM payments p LEFT JOIN users b ON b.id=p.verified_by WHERE reservation_id=$1 ORDER BY created_at`, [id]),
    q<any>('SELECT * FROM reservation_events WHERE reservation_id=$1 ORDER BY created_at DESC LIMIT 40', [id]),
    q<any>(`SELECT * FROM extension_requests WHERE reservation_id=$1 AND status IN ('pending','conflict') ORDER BY created_at DESC`, [id]),
    live ? moveOptions(id) : Promise.resolve({ from: '', options: [] as any[] }),
  ]);
  const canExtend = ['confirmed', 'checked_in'].includes(res.status) && can(u.role, 'reservation.edit');
  const freeAfter = canExtend ? await freeNightsAfter(id) : 0;
  const cur = f.currency;
  const today = todayLocal();
  const back = `/dashboard/reservations/${id}`;
  const isMgr = can(u.role, 'rate.override');
  const canEdit = can(u.role, 'reservation.edit');
  const activeUnits = units.filter((x) => x.active && (x.during.slice(12, 22) > today || res.status !== 'checked_in'));
  const balance = f.balance;
  const pos = `/pos?guest=${id}`;

  return (
    <>
      <PageHeader title={res.full_name} sub={`${res.reference} · ${res.check_in} → ${res.check_out} · ${res.guests_count} guest(s) · ${sourceLabel(res.source)}${res.channel_ref ? ` ${res.channel_ref}` : ''}`}>
        <span className="self-center"><Badge status={res.status} /></span>
        {['hold', 'pending', 'expired'].includes(res.status) && can(u.role, 'reservation.confirm') && (
          <form action={confirmAction}><input type="hidden" name="id" value={id} /><ConfirmButton className={Btn} message="Confirm this booking? The guest is told it is confirmed.">Confirm</ConfirmButton></form>)}
        {['pending', 'confirmed'].includes(res.status) && res.check_in <= today && (
          <form action={fdCheckIn}><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} /><button className={Btn}><Icon name="log-in" size={16} /> Check in</button></form>)}
        {res.status === 'checked_in' && (balance <= 0 ? (
          <form action={fdCheckOut}><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} /><ConfirmButton className={Btn} message="Check this guest out? Keys and towels back?"><Icon name="log-out" size={16} /> Check out</ConfirmButton></form>
        ) : can(u.role, 'reservation.cancel') && (
          <form action={fdCheckOut}><input type="hidden" name="id" value={id} /><input type="hidden" name="force" value="1" /><input type="hidden" name="back" value={back} /><ConfirmButton className={BtnDanger} message="The guest still owes money. Check out anyway (manager)?">Check out unpaid</ConfirmButton></form>
        ))}
        {(live || balance > 0) && <a href={pos} target="_blank" rel="noopener" className={BtnGhost}><Icon name="shopping-cart" size={16} /> Open POS</a>}
      </PageHeader>
      <Flash sp={sp} />

      {res.needs_review && ['hold', 'pending'].includes(res.status) && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><b>Check before confirming:</b> {res.review_reason}</p>}
      {['hold', 'pending'].includes(res.status) && res.hold_expires_at && <p className="mb-4 text-sm text-slate-600">Beds are held until <b>{dt(res.hold_expires_at)}</b>, then released automatically.</p>}

      {/* Money strip: the only place staff read totals. Payment itself is on the POS. */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <div className="rounded-xl border border-cocoa-200 bg-white p-4"><p className="text-xs uppercase tracking-wide text-cocoa-500">Bill</p><p className="text-2xl font-bold tabular-nums">{fmt(f.charges + f.credits, cur)}</p></div>
        <div className="rounded-xl border border-cocoa-200 bg-white p-4"><p className="text-xs uppercase tracking-wide text-cocoa-500">Paid</p><p className="text-2xl font-bold tabular-nums text-emerald-800">{fmt(f.paid, cur)}</p>{f.pending > 0 && <p className="text-xs text-amber-700">{fmt(f.pending, cur)} receipt(s) to check</p>}</div>
        <div className="rounded-xl border border-cocoa-200 bg-white p-4"><p className="text-xs uppercase tracking-wide text-cocoa-500">{balance > 0 ? 'Still to pay' : balance < 0 ? 'Guest credit' : 'Fully paid'}</p><p className={`text-2xl font-bold tabular-nums ${balance > 0 ? 'text-red-800' : balance < 0 ? 'text-sky-700' : 'text-emerald-700'}`}>{fmt(Math.abs(balance), cur)}</p></div>
        {balance > 0 && <a href={pos} target="_blank" rel="noopener" className={Btn + ' self-stretch px-6 text-base'}><Icon name="wallet" size={18} /> Take payment on POS</a>}
      </div>

      {canExtend && (
        <section id="extend" className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-cocoa-200 bg-white px-4 py-3">
          <span className="me-1 text-sm font-semibold text-cocoa-800"><Icon name="calendar-days" size={16} className="me-1 inline-block align-[-3px]" />Extend stay</span>
          {[1, 2, 3, 7].map((n) => (
            <form key={n} action={createExtensionAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="nights" value={n} />
              <button disabled={n > freeAfter} title={n > freeAfter ? 'The same bed is taken then' : `New check-out ${addDays(res.check_out, n)}`} className={BtnGhost + ' disabled:opacity-40'}>+{n} night{n === 1 ? '' : 's'}</button></form>
          ))}
          <form action={createExtensionAction} className="flex items-center gap-2"><input type="hidden" name="id" value={id} />
            <input type="date" name="newCheckOut" required min={addDays(res.check_out, 1)} aria-label="Extend until" className={Input + ' w-40'} />
            <button className={BtnGhost + ' whitespace-nowrap'}>Extend until</button></form>
          <span className="ms-auto text-xs text-slate-500">{freeAfter > 0 ? `Same bed free for ${freeAfter >= 30 ? '30+' : freeAfter} more night${freeAfter === 1 ? '' : 's'}. Extra nights go on the bill; take the money on the POS.` : 'The same bed is taken from check-out: move the guest to a free bed first (Dates & beds).'}</span>
          <a href={`/pos?guest=${id}`} className={BtnGhost + ' whitespace-nowrap'}><Icon name="banknote" size={16} /> Take payment on POS</a>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Bill">
            {!f.roomPosted && f.lines.some((l) => l.kind === 'room') && <p className="mb-3 rounded-lg bg-cocoa-50 px-3 py-2 text-sm text-slate-700">Nights are added to the bill at check-in, at the booked prices shown here.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="py-2">Date</th><th>What</th><th className="text-right">Qty</th><th className="text-right">Amount</th><th /></tr></thead>
                <tbody>
                  {f.lines.map((l, i) => (
                    <tr key={l.id ?? i} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap py-2 tabular-nums">{l.date}</td>
                      <td>{l.description}{!l.posted && <span className="ml-1 text-xs text-slate-400">(at check-in)</span>}
                        <div className="text-xs text-slate-500">{KIND[l.kind] ?? l.kind}{l.kind === 'room' && isMgr && l.rate_source ? ` · ${RATE[l.rate_source] ?? l.rate_source}` : ''}</div></td>
                      <td className="text-right tabular-nums">{l.quantity}</td>
                      <td className={`whitespace-nowrap text-right font-semibold tabular-nums ${l.amount_cents < 0 ? 'text-sky-700' : ''}`}>{fmt(l.amount_cents, cur)}</td>
                      <td className="text-right">
                        {isMgr && l.id && (
                          <details className="relative inline-block text-left">
                            <summary className="cursor-pointer list-none rounded px-2 text-xs font-semibold text-slate-500 hover:text-red-700">Remove</summary>
                            <form action={folioVoid} className="absolute right-0 z-10 mt-1 w-64 rounded-xl border border-cocoa-200 bg-white p-3 shadow-lg">
                              <input type="hidden" name="id" value={id} /><input type="hidden" name="entryId" value={l.id} />
                              <Lbl>Why? (kept in the log)</Lbl>
                              <input name="reason" required minLength={3} className={Input} />
                              <button className={BtnDanger + ' mt-2 w-full'}>Remove line</button>
                            </form>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                  {f.lines.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-500">Nothing on the bill yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {canEdit && live && (
              <form action={folioCharge} className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_5rem_8rem_auto]">
                <input type="hidden" name="id" value={id} />
                <input name="description" placeholder="Extra, e.g. Late check-out" required className={Input} aria-label="What" />
                <input name="qty" type="number" min={1} defaultValue={1} className={Input} aria-label="Quantity" />
                <input name="amount" type="number" min={1} step="0.01" placeholder={`Price ${cur}`} required className={Input} aria-label="Price" />
                <button className={BtnGhost}><Icon name="plus" size={16} /> Add to bill</button>
              </form>
            )}
            <p className="mt-2 text-xs text-slate-500">Drinks, meals, tours and laundry: sell them on the POS with <b>Charge to room</b>, they appear here.</p>
          </Card>

          <Card title="Payments">
            {pays.length === 0 ? <p className="text-sm text-slate-500">No payments yet.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>How</th><th>Ref / note</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
                <tbody>{pays.map((p: any) => (
                  <tr key={p.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 text-xs">{dt(p.created_at)}</td><td>{METHOD[p.method] ?? p.method}</td>
                    <td className="text-xs">{p.reference}{p.note && <div className="text-slate-500">{p.note}</div>}</td>
                    <td>{p.status === 'verified' ? <Pill tone="green">Received</Pill> : p.status === 'rejected' ? <Pill tone="red">Rejected</Pill> : (
                      <div className="flex flex-wrap items-center gap-2"><Pill tone="amber">To check</Pill>
                        {can(u.role, 'payment.verify') && <form action={verifyPaymentAction} className="flex gap-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} />
                          <ConfirmButton name="decision" value="verify" className="text-xs font-semibold text-emerald-800 underline" message="Approve only after you see the money arrived in the InstaPay / Vodafone Cash app. Approve?">Approve</ConfirmButton>
                          <button name="decision" value="reject" className="text-xs font-semibold text-red-800 underline">Reject</button></form>}</div>)}</td>
                    <td className="text-right font-semibold tabular-nums">{fmt(Number(p.amount_cents), cur)}</td>
                  </tr>))}</tbody>
              </table>
            )}
            <p className="mt-3 rounded-lg bg-cocoa-50 px-3 py-2 text-sm text-cocoa-800">Cash or card? <a href={pos} target="_blank" rel="noopener" className="font-semibold underline">Take it on the POS</a>, so it is counted in the drawer.</p>
            {can(u.role, 'payment.record') && live && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-semibold text-cocoa-800">Guest paid by InstaPay? Add the receipt</summary>
                <form action={recordPaymentAction} className="mt-3 grid gap-3 sm:grid-cols-[8rem_10rem_1fr_auto]"><input type="hidden" name="id" value={id} />
                  <div><Lbl htmlFor="pa">Amount ({cur})</Lbl><input id="pa" name="amount" required inputMode="decimal" className={Input} /></div>
                  <div><Lbl htmlFor="pm">Wallet</Lbl><select id="pm" name="method" className={Input}><option value="instapay">InstaPay</option></select></div>
                  <div><Lbl htmlFor="pr">Transaction number on the receipt *</Lbl><input id="pr" name="reference" required minLength={4} className={Input} /></div>
                  <div className="flex items-end"><button className={Btn}>Add receipt</button></div>
                </form>
                <p className="mt-1 text-xs text-slate-500">It counts as paid only after a manager approves it in Payments to check.</p>
              </details>
            )}
          </Card>

          {live && canEdit && (
            <Card title="Dates & beds">
              <ul className="mb-4 space-y-2 text-sm">
                {units.filter((x) => x.active).map((x) => {
                  const [hl, ht] = HK_LABEL[x.hk_status] ?? [x.hk_status, 'slate'];
                  return (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 p-2">
                      <span><b>{x.kind === 'dorm' ? `${x.room} · ${x.label}` : x.room}</b> <span className="text-xs text-slate-500">{x.during.slice(1, 11)} → {x.during.slice(12, 22)} · {x.guests} guest(s)</span></span>
                      <Pill tone={ht}>{hl}</Pill>
                    </li>
                  );
                })}
              </ul>
              <div className="grid gap-5 lg:grid-cols-2">
                <form action={changeDatesAction} className="space-y-2"><input type="hidden" name="id" value={id} />
                  <p className="text-sm font-semibold">Change dates</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Lbl htmlFor="d1">Check-in</Lbl><input id="d1" type="date" name="checkIn" defaultValue={res.check_in} disabled={res.status === 'checked_in'} className={Input} />{res.status === 'checked_in' && <input type="hidden" name="checkIn" value={res.check_in} />}</div>
                    <div><Lbl htmlFor="d2">Check-out</Lbl><input id="d2" type="date" name="checkOut" defaultValue={res.check_out} className={Input} /></div>
                  </div>
                  <button className={BtnGhost + ' w-full'}>Save new dates</button>
                  <p className="text-xs text-slate-500">Checks the beds are free and re-prices the stay. If a bed is taken, nothing changes.</p>
                </form>
                {mv.options.length > 0 && activeUnits.length > 0 && (
                  <form action={fdMoveRoom} className="space-y-2">
                    <input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={back} />
                    <p className="text-sm font-semibold">Move to another bed / room</p>
                    {activeUnits.length > 1 && (
                      <div><Lbl htmlFor="m-ru">Which one</Lbl>
                        <select id="m-ru" name="ruId" className={Input}>{activeUnits.map((x) => <option key={x.id} value={x.id}>{x.kind === 'dorm' ? `${x.room} · ${x.label}` : x.room}</option>)}</select></div>
                    )}
                    {activeUnits.length === 1 && <input type="hidden" name="ruId" value={activeUnits[0].id} />}
                    <div><Lbl htmlFor="m-to">Move to (free until check-out)</Lbl>
                      <select id="m-to" name="unitId" required className={Input}>
                        <option value="">Choose…</option>
                        {Object.entries(mv.options.reduce((g: Record<string, any[]>, o: any) => ((g[o.typeName] ||= []).push(o), g), {})).map(([t, os]) => (
                          <optgroup key={t} label={t}>{(os as any[]).map((o) => <option key={o.unitId} value={o.unitId}>{o.label}{o.hk !== 'clean' && o.hk !== 'inspected' ? ` (${HK_LABEL[o.hk]?.[0] ?? o.hk})` : ''}</option>)}</optgroup>
                        ))}
                      </select></div>
                    <div><Lbl htmlFor="m-eff">From night</Lbl><input id="m-eff" name="effective" type="date" defaultValue={mv.from} min={mv.from} max={res.check_out} className={Input} /></div>
                    <button className={BtnGhost + ' w-full'}><Icon name="arrow-left-right" size={16} /> Move guest</button>
                    <p className="text-xs text-slate-500">The old room goes to cleaning. Nights left are priced at the new room&apos;s rate.</p>
                  </form>
                )}
              </div>
              {ext.length > 0 && <p className="mt-3 text-sm text-amber-900">The guest asked to extend: {ext.map((e) => `until ${e.new_check_out}`).join(', ')}. <Link className="underline" href="/dashboard/extensions">Decide</Link></p>}
            </Card>
          )}

          {isMgr && live && (
            <Card title="Change the price of nights (manager)">
              <form action={folioRateOverride} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_2fr_auto] sm:items-end">
                <input type="hidden" name="id" value={id} />
                <div><Lbl htmlFor="o-from">From night</Lbl><input id="o-from" name="from" type="date" defaultValue={res.check_in} min={res.check_in} max={res.check_out} required className={Input} /></div>
                <div><Lbl htmlFor="o-to">Until (check-out)</Lbl><input id="o-to" name="to" type="date" defaultValue={res.check_out} min={res.check_in} max={res.check_out} required className={Input} /></div>
                <div><Lbl htmlFor="o-rate">Price / night</Lbl><input id="o-rate" name="rate" type="number" min={0} step="0.01" required className={Input} /></div>
                <div><Lbl htmlFor="o-why">Why (kept in the log)</Lbl><input id="o-why" name="reason" required minLength={3} className={Input} /></div>
                <button className={BtnGhost}>Apply</button>
              </form>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card title="Guest">
            <p className="font-semibold"><Link className="underline" href={`/dashboard/guests/${res.gid}`}>{res.full_name}</Link></p>
            <p className="text-sm text-slate-600">{[res.phone, res.email, res.nationality].filter(Boolean).join(' · ') || 'No contact saved'}</p>
            {res.address && <p className="text-sm text-slate-600">{[res.address.line1, res.address.line2, res.address.city, res.address.state, res.address.postcode, res.address.country].filter(Boolean).join(', ')}</p>}
            {res.arrival_time && <p className="text-sm text-slate-600">Arrives around {res.arrival_time}</p>}
            <p className="mt-2 text-sm text-slate-600">{res.tname?.en} · booked {dt(res.created_at)}</p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm font-semibold">
              <Link className="text-cocoa-700 underline" href={`/dashboard/taxi?reservation=${id}`}>Book airport taxi</Link>
            </div>
          </Card>

          {!live && units.length > 0 && <Card title="Beds"><ul className="text-sm">{units.map((a) => <li key={a.id} className={a.active ? '' : 'text-slate-400 line-through'}>{a.kind === 'dorm' ? `${a.room} · ${a.label}` : a.room} · {a.guests} guest(s)</li>)}</ul></Card>}

          <Card title="Notes">
            <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-sm text-slate-700">{res.staff_notes || 'No notes yet.'}</pre>
            <form action={addNoteAction} className="space-y-2"><input type="hidden" name="id" value={id} /><textarea name="note" rows={2} required className={Input} placeholder="Add a note…" /><button className={BtnGhost}>Add note</button></form>
          </Card>

          {((['hold', 'pending'].includes(res.status) && can(u.role, 'reservation.confirm')) || (live && res.status !== 'checked_in' && can(u.role, 'reservation.cancel')) || (res.status === 'confirmed' && res.check_in <= today)) && (
            <Card title="Cancel">
              {['hold', 'pending'].includes(res.status) && can(u.role, 'reservation.confirm') && (
                <form action={rejectAction} className="space-y-2"><input type="hidden" name="id" value={id} />
                  <Lbl htmlFor="rj">Refuse this request (reason, optional)</Lbl><input id="rj" name="reason" className={Input} />
                  <ConfirmButton className={BtnDanger} message="Refuse this request and free the beds?">Refuse request</ConfirmButton></form>)}
              {live && res.status !== 'checked_in' && can(u.role, 'reservation.cancel') && (
                <form action={cancelAction} className="mt-3 space-y-2"><input type="hidden" name="id" value={id} />
                  <Lbl htmlFor="cr">Cancel booking (reason)</Lbl><input id="cr" name="reason" className={Input} />
                  <ConfirmButton className={BtnDanger} message="Cancel this booking? The beds are freed. This cannot be undone.">Cancel booking</ConfirmButton></form>)}
              {res.status === 'confirmed' && res.check_in <= today && (
                <form action={noShowAction} className="mt-3"><input type="hidden" name="id" value={id} /><ConfirmButton className={BtnGhost} message="The guest did not come? The bed is freed.">Guest did not come (no-show)</ConfirmButton></form>)}
            </Card>
          )}

          <Card title="History">
            <ul className="space-y-2 text-xs text-slate-600">{events.map((e) => <li key={e.id}><b>{historyText(e.action)}</b> · {who(e.actor)}<br /><span className="text-slate-400">{dt(e.created_at)}</span></li>)}</ul>
          </Card>
        </div>
      </div>
    </>
  );
}
