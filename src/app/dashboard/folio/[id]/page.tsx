import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { q } from '@/lib/db';
import { todayLocal } from '@/lib/dates';
import { PageHeader, Card, Flash, fmt, dt, Btn, BtnGhost, BtnDanger, Input, Lbl, Stat, Pill, Badge, HK_LABEL } from '@/components/dash';
import { Icon } from '@/components/icons';
import { getFolio } from '@/services/pms/folio';
import { moveOptions } from '@/services/pms/frontdesk';
import { openShiftRow } from '@/services/pms/pos';
import { BookingError } from '@/services/errors';
import { fdCheckIn, fdCheckOut, fdMoveRoom, folioPayment, folioCharge, folioVoid, folioRateOverride, taxiCreate } from '../../pms-actions';

export const dynamic = 'force-dynamic';

const SOURCE: Record<string, string> = { override: 'Manager override', booking: 'Booked rate', little_hotelier: 'Little Hotelier', local_rate: 'Rate table', csv_import: 'Little Hotelier (CSV)', manual: 'Manual rate' };
const KIND: Record<string, string> = { room: 'Room', pos: 'POS', custom: 'Charge', taxi: 'Taxi', event: 'Event', tour: 'Tour', adjustment: 'Adjustment', discount: 'Discount', comp: 'Owner comp' };
const METHOD: Record<string, string> = { cash: 'Cash', card_terminal: 'Card', instapay: 'InstaPay', bank_transfer: 'Bank transfer', paymob: 'Paymob', other: 'Other' };

export default async function Folio({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('frontdesk.use');
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let f;
  try { f = await getFolio(id); } catch (e) { if (e instanceof BookingError) notFound(); throw e; }
  const r = f.reservation;
  const [units, shift, mv] = await Promise.all([
    q<any>(`SELECT ru.id, ru.during::text during, ru.guests, u.label, rm.name room, rm.hk_status, t.kind, t.name type_name, t.code
            FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id
            WHERE ru.reservation_id=$1 AND ru.active ORDER BY lower(ru.during), rm.name`, [id]),
    openShiftRow(),
    ['confirmed', 'checked_in', 'pending', 'hold'].includes(r.status) ? moveOptions(id) : Promise.resolve({ from: '', options: [] as any[] }),
  ]);
  const cur = f.currency;
  const isMgr = can(u.role, 'rate.override');
  const canPay = can(u.role, 'payment.record');
  const canCharge = can(u.role, 'reservation.edit');
  const today = todayLocal();
  const active = units.filter((x) => x.during.slice(12, 22) > today || r.status !== 'checked_in');
  const tone = f.state === 'due' ? 'due' : f.state === 'credit' ? 'credit' : 'ok';
  const nameOf = (n: any, c: string) => (n && typeof n === 'object' ? n.en || n.ar : n) || c;

  return (
    <>
      <PageHeader title={r.full_name} sub={`Folio · ${r.reference} · ${r.check_in} → ${r.check_out}`}>
        <Badge status={r.status} />
        {['pending', 'confirmed'].includes(r.status) && r.check_in <= today && (
          <form action={fdCheckIn}><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={`/dashboard/folio/${id}`} /><button className={Btn}><Icon name="log-in" size={16} /> Check in</button></form>
        )}
        {r.status === 'checked_in' && (f.balance <= 0 ? (
          <form action={fdCheckOut}><input type="hidden" name="id" value={id} /><input type="hidden" name="back" value={`/dashboard/folio/${id}`} /><button className={Btn}><Icon name="log-out" size={16} /> Check out</button></form>
        ) : can(u.role, 'reservation.cancel') && (
          <form action={fdCheckOut}><input type="hidden" name="id" value={id} /><input type="hidden" name="force" value="1" /><input type="hidden" name="back" value={`/dashboard/folio/${id}`} /><button className={BtnDanger}>Check out unpaid</button></form>
        ))}
        <Link href={`/dashboard/reservations/${id}`} className={BtnGhost}><Icon name="file-text" size={16} /> Reservation</Link>
        <a href="/pos" target="_blank" rel="noopener" className={BtnGhost}><Icon name="shopping-cart" size={16} /> POS</a>
      </PageHeader>
      <Flash sp={sp} />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Total charges" value={fmt(f.charges + f.credits, cur)} hint={f.credits ? `after ${fmt(-f.credits, cur)} credits` : undefined} />
        <Stat label="Total paid" value={fmt(f.paid, cur)} hint={f.pending ? `${fmt(f.pending, cur)} waiting to be verified` : undefined} />
        <Stat label={f.state === 'due' ? 'Balance due' : f.state === 'credit' ? 'Credit balance' : 'Fully settled'} value={fmt(Math.abs(f.balance), cur)} tone={tone} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card title="Charges">
            {!f.roomPosted && <p className="mb-3 rounded-lg bg-cocoa-50 px-3 py-2 text-sm text-slate-700">Room nights are posted at check-in, each at the rate recorded for that date. Shown below at the booked prices.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="py-2">Date</th><th>Description</th><th>Rate source</th><th className="text-right">Qty</th><th className="text-right">Amount</th><th /></tr></thead>
                <tbody>
                  {f.lines.map((l, i) => (
                    <tr key={l.id ?? i} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap py-2 tabular-nums">{l.date}</td>
                      <td>{l.description}{!l.posted && <span className="ml-1 text-xs text-slate-400">(not posted)</span>}<div className="text-xs text-slate-500">{KIND[l.kind] ?? l.kind}</div></td>
                      <td className="text-xs">{l.kind === 'room' ? <Pill tone={l.rate_source === 'little_hotelier' ? 'blue' : l.rate_source === 'override' ? 'amber' : 'slate'}>{SOURCE[l.rate_source ?? ''] ?? '—'}</Pill> : null}</td>
                      <td className="text-right tabular-nums">{l.quantity}</td>
                      <td className={`whitespace-nowrap text-right font-semibold tabular-nums ${l.amount_cents < 0 ? 'text-sky-700' : ''}`}>{fmt(l.amount_cents, cur)}</td>
                      <td className="text-right">
                        {isMgr && l.id && (
                          <details className="relative inline-block text-left">
                            <summary className="cursor-pointer list-none rounded px-2 text-xs font-semibold text-slate-500 hover:text-red-700">Void</summary>
                            <form action={folioVoid} className="absolute right-0 z-10 mt-1 w-64 rounded-xl border border-cocoa-200 bg-white p-3 shadow-lg">
                              <input type="hidden" name="id" value={id} /><input type="hidden" name="entryId" value={l.id} />
                              <Lbl>Reason (kept in the audit log)</Lbl>
                              <input name="reason" required minLength={3} className={Input} />
                              <button className={BtnDanger + ' mt-2 w-full'}>Void line</button>
                            </form>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                  {f.lines.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No charges yet.</td></tr>}
                </tbody>
              </table>
            </div>
            {canCharge && (
              <form action={folioCharge} className="mt-4 grid gap-2 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_6rem_8rem_auto]">
                <input type="hidden" name="id" value={id} />
                <input name="description" placeholder="Custom charge, e.g. Late checkout" required className={Input} aria-label="Description" />
                <input name="qty" type="number" min={1} defaultValue={1} className={Input} aria-label="Quantity" />
                <input name="amount" type="number" min={1} step="0.01" placeholder={`Price ${cur}`} required className={Input} aria-label="Unit price" />
                <button className={BtnGhost}><Icon name="plus" size={16} /> Add charge</button>
              </form>
            )}
          </Card>

          <Card title="Payments">
            {f.payments.length === 0 ? <p className="text-sm text-slate-500">No payments yet.</p> : (
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>Method</th><th>Reference</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
                <tbody>{f.payments.map((p: any) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2">{dt(p.created_at)}</td><td>{METHOD[p.method] ?? p.method}</td><td className="text-xs">{p.reference}{p.note && <div className="text-slate-500">{p.note}</div>}</td>
                    <td><Pill tone={p.status === 'verified' ? 'green' : p.status === 'recorded' ? 'amber' : 'slate'}>{p.status === 'verified' ? 'Received' : p.status === 'recorded' ? 'To verify' : p.status}</Pill></td>
                    <td className="text-right font-semibold tabular-nums">{fmt(Number(p.amount_cents), cur)}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {canPay && (
            <Card title="Receive payment">
              <div id="pay" className="scroll-mt-24" />
              <form action={folioPayment} className="space-y-3">
                <input type="hidden" name="id" value={id} />
                <div><Lbl htmlFor="p-amt">Amount ({cur})</Lbl><input id="p-amt" name="amount" type="number" min={1} step="0.01" required defaultValue={f.balance > 0 ? f.balance / 100 : ''} className={Input + ' text-lg font-semibold'} /></div>
                <p className="text-xs text-slate-500">Enter less than the balance for a partial payment.</p>
                <fieldset className="flex gap-2">
                  <legend className="sr-only">Method</legend>
                  <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-cocoa-200 px-3 py-2 text-sm font-semibold has-[:checked]:border-cocoa-800 has-[:checked]:bg-cocoa-800 has-[:checked]:text-white">
                    <input type="radio" name="method" value="cash" defaultChecked={!!shift} disabled={!shift} className="sr-only" /><Icon name="banknote" size={16} /> Cash</label>
                  <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-cocoa-200 px-3 py-2 text-sm font-semibold has-[:checked]:border-cocoa-800 has-[:checked]:bg-cocoa-800 has-[:checked]:text-white">
                    <input type="radio" name="method" value="card" defaultChecked={!shift} className="sr-only" /><Icon name="credit-card" size={16} /> Card</label>
                </fieldset>
                <div><Lbl htmlFor="p-cur">Cash currency</Lbl>
                  <select id="p-cur" name="currency" className={Input}><option value="EGP">EGP</option><option value="USD">USD (converted at today’s rate)</option><option value="EUR">EUR (converted at today’s rate)</option></select></div>
                {shift ? <p className="text-xs text-slate-500">Cash goes into the drawer of shift #{shift.shift_no}. The amount above is in the currency you choose.</p>
                  : <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Cash needs an open POS shift so it is counted in the drawer. <a href="/pos" target="_blank" rel="noopener" className="underline">Open the POS</a>.</p>}
                <input name="note" placeholder="Note (optional)" className={Input} aria-label="Note" />
                <button className={Btn + ' w-full'}><Icon name="wallet" size={16} /> Record payment</button>
              </form>
            </Card>
          )}

          <Card title="Rooms & beds">
            <div id="move" className="scroll-mt-24" />
            <ul className="space-y-2 text-sm">
              {units.map((x) => {
                const [hl, ht] = HK_LABEL[x.hk_status] ?? [x.hk_status, 'slate'];
                return (
                  <li key={x.id} className="rounded-lg border border-slate-100 p-2">
                    <div className="flex items-center justify-between gap-2"><b>{x.kind === 'dorm' ? `${x.room} · ${x.label}` : x.room}</b><Pill tone={ht}>{hl}</Pill></div>
                    <p className="text-xs text-slate-500">{nameOf(x.type_name, x.code)} · {x.during.slice(1, 11)} → {x.during.slice(12, 22)} · {x.guests} pax</p>
                  </li>
                );
              })}
            </ul>
            {mv.options.length > 0 && active.length > 0 && (
              <form action={fdMoveRoom} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <input type="hidden" name="id" value={id} />
                {active.length > 1 && (
                  <div><Lbl htmlFor="m-ru">Move which</Lbl>
                    <select id="m-ru" name="ruId" className={Input}>{active.map((x) => <option key={x.id} value={x.id}>{x.kind === 'dorm' ? `${x.room} · ${x.label}` : x.room}</option>)}</select></div>
                )}
                <div><Lbl htmlFor="m-to">Move to (free until check-out)</Lbl>
                  <select id="m-to" name="unitId" required className={Input}>
                    <option value="">Choose…</option>
                    {Object.entries(mv.options.reduce((g: Record<string, any[]>, o: any) => ((g[o.typeName] ||= []).push(o), g), {})).map(([t, os]) => (
                      <optgroup key={t} label={t}>{(os as any[]).map((o) => <option key={o.unitId} value={o.unitId}>{o.label}{o.hk !== 'clean' && o.hk !== 'inspected' ? ` (${HK_LABEL[o.hk]?.[0] ?? o.hk})` : ''}</option>)}</optgroup>
                    ))}
                  </select></div>
                <div><Lbl htmlFor="m-eff">From night</Lbl><input id="m-eff" name="effective" type="date" defaultValue={mv.from} min={mv.from} max={r.check_out} className={Input} /></div>
                <p className="text-xs text-slate-500">The old room is marked dirty. Remaining nights are re-priced at the new room type’s rate for each date, and Little Hotelier is updated.</p>
                <button className={BtnGhost + ' w-full'}><Icon name="arrow-left-right" size={16} /> Move guest</button>
              </form>
            )}
          </Card>

          <Card title="Airport taxi">
            <form action={taxiCreate} className="space-y-2">
              <input type="hidden" name="reservationId" value={id} /><input type="hidden" name="back" value={`/dashboard/folio/${id}`} />
              <div className="grid grid-cols-2 gap-2">
                <select name="direction" className={Input} aria-label="Direction"><option value="pickup">Pick-up (arrival)</option><option value="dropoff">Drop-off (departure)</option></select>
                <select name="airport" className={Input} aria-label="Airport"><option value="cairo">Cairo airport</option><option value="sphinx">Sphinx airport</option></select>
                <input name="date" type="date" required defaultValue={r.status === 'checked_in' ? r.check_out : r.check_in} className={Input} aria-label="Date" />
                <input name="time" type="time" required className={Input} aria-label="Time" />
              </div>
              <button className={BtnGhost + ' w-full'}>Book taxi and add to folio</button>
              <p className="text-xs text-slate-500">Charged at today’s USD rate. The shift that must message the guest gets a task.</p>
            </form>
          </Card>

          {isMgr && (
            <Card title="Manager rate override">
              <form action={folioRateOverride} className="space-y-2">
                <input type="hidden" name="id" value={id} />
                <div className="grid grid-cols-2 gap-2">
                  <div><Lbl htmlFor="o-from">From night</Lbl><input id="o-from" name="from" type="date" defaultValue={r.check_in} min={r.check_in} max={r.check_out} required className={Input} /></div>
                  <div><Lbl htmlFor="o-to">Until (check-out)</Lbl><input id="o-to" name="to" type="date" defaultValue={r.check_out} min={r.check_in} max={r.check_out} required className={Input} /></div>
                </div>
                <div><Lbl htmlFor="o-rate">New rate per night ({cur})</Lbl><input id="o-rate" name="rate" type="number" min={0} step="0.01" required className={Input} /></div>
                <div><Lbl htmlFor="o-why">Reason (required, audited)</Lbl><input id="o-why" name="reason" required minLength={3} className={Input} /></div>
                <button className={BtnGhost + ' w-full'}>Apply override</button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
