import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { can } from '@/lib/permissions';
import { freeUnits } from '@/services/availability';
import { pool } from '@/lib/db';
import { Badge, PayBadge, PageHeader, Card, Flash, fmt, dt, Input, Lbl, Btn, BtnGhost, BtnDanger } from '@/components/dash';
import { ConfirmButton } from '@/components/ConfirmButton';
import { confirmAction, rejectAction, cancelAction, checkInAction, checkOutAction, noShowAction, changeDatesAction, reassignAction, addNoteAction, recordPaymentAction, verifyPaymentAction, createExtensionAction } from '../../actions';
import { todayLocal } from '@/lib/dates';
import { METHODS } from '@/services/payments';
import { getFolio } from '@/services/pms/folio';

export default async function ReservationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('reservation.view');
  const { id } = await params; const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = (await q<any>('SELECT id FROM reservations WHERE id=$1', [id]))[0];
  if (!r) notFound();
  const res = (await q<any>(`SELECT r.*, g.full_name, g.email, g.phone, g.nationality, g.language, g.id gid, t.name tname, t.kind FROM reservations r JOIN guests g ON g.id=r.guest_id JOIN room_types t ON t.id=r.room_type_id WHERE r.id=$1`, [id]))[0];
  const alloc = await q<any>(`SELECT ru.id, ru.unit_id, ru.active, ru.guests, u.label, rm.name room FROM reservation_units ru JOIN units u ON u.id=ru.unit_id JOIN rooms rm ON rm.id=u.room_id WHERE ru.reservation_id=$1 ORDER BY rm.name, u.label`, [id]);
  const pays = await q<any>(`SELECT p.*, a.name rec, b.name ver FROM payments p LEFT JOIN users a ON a.id=p.recorded_by LEFT JOIN users b ON b.id=p.verified_by WHERE reservation_id=$1 ORDER BY created_at`, [id]);
  const events = await q<any>('SELECT * FROM reservation_events WHERE reservation_id=$1 ORDER BY created_at DESC LIMIT 40', [id]);
  const ext = await q<any>('SELECT * FROM extension_requests WHERE reservation_id=$1 ORDER BY created_at DESC', [id]);
  const serviceOrders = await q<any>('SELECT * FROM service_orders WHERE reservation_id=$1 ORDER BY created_at DESC', [id]).catch(() => []);
  // Balance comes from the folio: room nights + POS / custom charges − credits − verified payments.
  const folio = await getFolio(id);
  const paid = folio.paid;
  const unverified = folio.pending;
  const charges = folio.charges + folio.credits;
  const balance = folio.balance;
  const live = ['hold', 'pending', 'confirmed', 'checked_in'].includes(res.status);
  const free = live ? await freeUnits(pool() as any, res.room_type_id, res.check_in, res.check_out, id) : [];
  const state = paid <= 0 && charges > 0 ? 'unpaid' : balance > 0 ? 'partial' : balance === 0 ? 'paid' : 'overpaid';
  const back = `/dashboard/reservations/${id}`;
  const policy = res.policy_outcome;
  const canExtend = ['confirmed', 'checked_in'].includes(res.status);

  return (
    <>
      <PageHeader title={`Reservation ${res.reference}`} sub={`Created ${dt(res.created_at)} via ${res.source}`}>
        <Link href={`/dashboard/folio/${id}`} className={Btn}>Open folio</Link>
        <Link href="/dashboard/reservations" className={BtnGhost}>All reservations</Link>
      </PageHeader>
      <Flash sp={sp} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center gap-3"><Badge status={res.status} /><PayBadge state={state} awaiting={unverified > 0} />
              {res.needs_review && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Needs review</span>}</div>
            {res.needs_review && <p className="mt-2 text-sm text-amber-900">{res.review_reason}</p>}
            {['hold', 'pending'].includes(res.status) && res.hold_expires_at && <p className="mt-2 text-sm text-slate-600">Beds are held until <b>{dt(res.hold_expires_at)}</b>, then released automatically.</p>}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Guest</dt><dd className="font-medium"><Link className="underline" href={`/dashboard/guests/${res.gid}`}>{res.full_name}</Link></dd></div>
              <div><dt className="text-slate-500">Contact</dt><dd>{res.phone ?? '—'} · {res.email ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Stay</dt><dd className="font-medium">{res.check_in} → {res.check_out}</dd></div>
              <div><dt className="text-slate-500">Guests / type</dt><dd>{res.guests_count} · {res.tname.en}</dd></div>
              <div><dt className="text-slate-500">Room total / all charges</dt><dd className="font-medium">{fmt(res.total_cents, res.currency)} / {fmt(charges, res.currency)}</dd></div>
              <div><dt className="text-slate-500">Verified paid / balance</dt><dd>{fmt(paid, res.currency)} / <b className={balance > 0 ? 'text-red-800' : balance < 0 ? 'text-sky-700' : 'text-emerald-700'}>{balance < 0 ? `Credit ${fmt(-balance, res.currency)}` : fmt(balance, res.currency)}</b> · <Link className="underline" href={`/dashboard/folio/${id}`}>Folio</Link></dd></div>
            </dl>
            {res.guest_notes && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><b>Guest note:</b> {res.guest_notes}</p>}
            {policy?.appliedRules?.length > 0 && <p className="mt-3 text-xs text-slate-500">Policy version <code>{res.policy_version}</code> applied: {policy.appliedRules.map((x: any) => x.name).join(', ')}{policy.reviewedBy ? ` · reviewed by ${policy.reviewedBy}` : ''}</p>}
          </Card>

          <Card title="Actions">
            <div className="flex flex-wrap gap-3">
              {['hold', 'pending', 'expired'].includes(res.status) && can(u.role, 'reservation.confirm') && (
                <form action={confirmAction}><input type="hidden" name="id" value={id} /><ConfirmButton className={Btn} message="Confirm this reservation? The guest will be told it is confirmed.">Confirm reservation</ConfirmButton></form>)}
              {res.status === 'confirmed' && <form action={checkInAction}><input type="hidden" name="id" value={id} /><button className={Btn}>Check in</button></form>}
              {res.status === 'checked_in' && <form action={checkOutAction}><input type="hidden" name="id" value={id} /><ConfirmButton className={Btn} message="Check this guest out?">Check out</ConfirmButton></form>}
              {res.status === 'confirmed' && <form action={noShowAction}><input type="hidden" name="id" value={id} /><ConfirmButton className={BtnGhost} message="Mark as no-show? The bed will be released.">No-show</ConfirmButton></form>}
            </div>
            {['hold', 'pending'].includes(res.status) && can(u.role, 'reservation.confirm') && (
              <form action={rejectAction} className="mt-4 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={id} />
                <div className="min-w-[14rem] flex-1"><Lbl htmlFor="rj">Reject request (reason, optional)</Lbl><input id="rj" name="reason" className={Input} /></div>
                <ConfirmButton className={BtnDanger} message="Reject this request and release the beds?">Reject</ConfirmButton></form>)}
            {live && can(u.role, 'reservation.cancel') && (
              <form action={cancelAction} className="mt-4 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={id} />
                <div className="min-w-[14rem] flex-1"><Lbl htmlFor="cr">Cancel reservation (reason)</Lbl><input id="cr" name="reason" className={Input} /></div>
                <ConfirmButton className={BtnDanger} message="Cancel this reservation? Beds are released and the guest may be notified. This cannot be undone.">Cancel reservation</ConfirmButton></form>)}
            {!live && <p className="text-sm text-slate-500">This reservation is {res.status.replace('_', ' ')} — no further actions.</p>}
          </Card>

          {live && (
            <Card title="Change dates or bed">
              <form action={changeDatesAction} className="flex flex-wrap items-end gap-3"><input type="hidden" name="id" value={id} />
                <div><Lbl htmlFor="d1">Check-in</Lbl><input id="d1" type="date" name="checkIn" defaultValue={res.check_in} className={Input} /></div>
                <div><Lbl htmlFor="d2">Check-out</Lbl><input id="d2" type="date" name="checkOut" defaultValue={res.check_out} className={Input} /></div>
                <button className={Btn}>Check & save new dates</button></form>
              <p className="mt-2 text-xs text-slate-500">The system re-checks every bed and re-prices the stay. If a bed is taken, nothing is changed.</p>
              <div className="mt-5 space-y-3">{alloc.filter((a) => a.active).map((a) => (
                <form key={a.id} action={reassignAction} className="flex flex-wrap items-end gap-3"><input type="hidden" name="id" value={id} /><input type="hidden" name="ruId" value={a.id} />
                  <div><p className="text-sm text-slate-600">Currently: <b>{a.room} / {a.label}</b></p>
                    <Lbl htmlFor={`u${a.id}`}>Move to a free bed in the same room type</Lbl>
                    <select id={`u${a.id}`} name="unitId" className={Input}>{free.filter((f) => f.id !== a.unit_id).map((f) => <option key={f.id} value={f.id}>{f.room_name} / {f.label}</option>)}</select></div>
                  <ConfirmButton className={BtnGhost} message="Move this guest to the selected bed?">Move</ConfirmButton></form>))}</div>
            </Card>)}

          <Card title="Payments">
            {pays.length === 0 ? <p className="text-sm text-slate-500">No payments recorded.</p> : (
              <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">When</th><th>Amount</th><th>Method / ref</th><th>Status</th><th /></tr></thead><tbody className="divide-y">
                {pays.map((p) => <tr key={p.id}><td className="py-2">{dt(p.created_at)}</td><td>{fmt(p.amount_cents, res.currency)}</td><td>{p.method.replace('_', ' ')}{p.reference ? ` · ${p.reference}` : ''}{p.note ? <span className="block text-xs text-slate-500">{p.note}</span> : null}</td>
                  <td>{p.status === 'verified' ? <span className="text-emerald-800">Verified by {p.ver}</span> : p.status === 'rejected' ? <span className="text-red-800">rejected</span> : <span className="text-amber-800">awaiting verification</span>}</td>
                  <td>{p.status === 'recorded' && can(u.role, 'payment.verify') && (<form action={verifyPaymentAction} className="flex gap-2"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value={back} />
                    <ConfirmButton name="decision" value="verify" className="text-emerald-800 underline" message="Only verify after you have seen the money (cash in hand / bank statement). Verify?">Verify</ConfirmButton>
                    <button name="decision" value="reject" className="text-red-800 underline">Reject</button></form>)}</td></tr>)}
              </tbody></table>)}
            <p className="mt-2 text-xs text-slate-500">A payment counts toward the balance only after a manager/owner verifies it. A guest message or screenshot is never enough.</p>
            {can(u.role, 'payment.record') && (
              <form action={recordPaymentAction} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-5"><input type="hidden" name="id" value={id} />
                <div><Lbl htmlFor="pa">Amount ({res.currency})</Lbl><input id="pa" name="amount" required inputMode="decimal" className={Input} /></div>
                <div><Lbl htmlFor="pm">Method</Lbl><select id="pm" name="method" className={Input}>{METHODS.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></div>
                <div><Lbl htmlFor="pr">Reference</Lbl><input id="pr" name="reference" className={Input} /></div>
                <div><Lbl htmlFor="pn">Note</Lbl><input id="pn" name="note" className={Input} /></div>
                <div className="flex items-end"><button className={Btn}>Record payment</button></div></form>)}
          </Card>

          <Card title={`Extra services & purchases (${serviceOrders.length})`}>
            {serviceOrders.length === 0 ? (
              <p className="text-sm text-slate-500">No extra services have been recorded for this reservation yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="py-1">Date</th>
                      <th>Service / item</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Staff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {serviceOrders.map((so: any) => (
                      <tr key={so.id}>
                        <td className="py-2 text-xs text-slate-500">{so.order_date}</td>
                        <td className="font-medium text-slate-900 capitalize">
                          {so.service_type === 'breakfast' && 'Breakfast'}
                          {so.service_type === 'laundry' && 'Laundry'}
                          {so.service_type === 'towel' && 'Towel'}
                          {so.service_type === 'pool' && 'Pool'}
                          {so.service_type === 'water' && 'Water'}
                          {so.service_type === 'drinks' && 'Drinks'}
                          {so.service_type === 'tour' && 'Tour'}
                          {so.service_type === 'taxi' && 'Taxi'}
                          {so.service_type === 'meal' && 'Meal'}
                          {so.service_type === 'other' && 'Other'}
                          {so.quantity > 1 ? ` × ${so.quantity}` : ''}
                          {so.comment && <span className="block text-xs font-normal text-slate-500">{so.comment}</span>}
                        </td>
                        <td className="font-semibold text-slate-900">{fmt(so.amount_cents, so.currency)}</td>
                        <td className="text-xs">
                          {so.payment_status === 'paid' ? (
                            <span className="font-medium text-emerald-800">Paid ({so.payment_method})</span>
                          ) : so.payment_status === 'charged_to_room' ? (
                            <span className="font-medium text-amber-800">Charged to room</span>
                          ) : (
                            <span className="font-medium text-red-800">Unpaid</span>
                          )}
                        </td>
                        <td className="text-xs text-slate-500">{so.staff_name || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 border-t pt-2">
              <Link href="/dashboard/pos" className="text-xs font-semibold text-amber-800 underline hover:text-amber-950">
                + Add a service, drink or tour from the POS →
              </Link>
            </div>
          </Card>

          {canExtend && (
            <Card title="Stay extension">
              {ext.map((e) => <p key={e.id} className="mb-2 text-sm">→ <b>{e.new_check_out}</b> (+{e.extra_nights} night(s), {fmt(e.extra_cents, res.currency)}) — <b>{e.status}</b> {e.conflict_detail && <span className="text-red-800">· {e.conflict_detail}</span>} {['pending', 'conflict'].includes(e.status) && <Link className="underline" href="/dashboard/extensions">decide</Link>}</p>)}
              <form action={createExtensionAction} className="flex flex-wrap items-end gap-3"><input type="hidden" name="id" value={id} />
                <div><Lbl htmlFor="ne">New departure date</Lbl><input id="ne" type="date" name="newCheckOut" required min={res.check_out} className={Input} /></div>
                <button className={BtnGhost}>Check availability & create request</button></form>
              <p className="mt-2 text-xs text-slate-500">Creates a request only. The reservation changes after it is approved in Stay extensions.</p>
            </Card>)}
        </div>

        <div className="space-y-5">
          <Card title="Beds assigned">{alloc.length === 0 ? <p className="text-sm text-slate-500">None (history only).</p> : <ul className="text-sm">{alloc.map((a) => <li key={a.id} className={a.active ? '' : 'text-slate-400 line-through'}>{a.room} / {a.label} · {a.guests} guest(s)</li>)}</ul>}</Card>
          <Card title="Staff notes">
            <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap text-sm text-slate-700">{res.staff_notes || 'No notes yet.'}</pre>
            <form action={addNoteAction} className="space-y-2"><input type="hidden" name="id" value={id} /><textarea name="note" rows={2} required className={Input} placeholder="Add a note…" /><button className={BtnGhost}>Add note</button></form>
          </Card>
          <Card title="History"><ul className="space-y-2 text-xs text-slate-600">{events.map((e) => <li key={e.id}><b>{e.action}</b> · {e.actor}<br /><span className="text-slate-400">{dt(e.created_at)}</span></li>)}</ul></Card>
        </div>
      </div>
    </>
  );
}
