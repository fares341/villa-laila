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
  // Balance comes from the folio: room nights + POS / custom charges − credits − verified payments.
  const folio = await getFolio(id);
  const paid = folio.paid;
  const unverified = folio.pending;
  const charges = folio.charges + folio.credits;
  const balance = folio.balance;
  const extras = folio.lines.filter((l: any) => l.kind !== 'room');
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
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs uppercase tracking-wide text-cocoa-500">Guest</dt><dd className="font-semibold"><Link className="underline" href={`/dashboard/guests/${res.gid}`}>{res.full_name}</Link> <span className="font-normal text-cocoa-600">· {res.phone ?? res.email ?? 'no contact'}</span></dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-cocoa-500">Stay</dt><dd className="font-semibold">{res.check_in} → {res.check_out} <span className="font-normal text-cocoa-600">· {res.guests_count} guest(s) · {res.tname.en}</span></dd></div>
            </dl>
            <div className="mt-4 grid grid-cols-3 divide-x divide-cocoa-100 rounded-xl border border-cocoa-100 bg-cocoa-50/60 text-center">
              <div className="p-3"><p className="text-xs uppercase tracking-wide text-cocoa-500">Total</p><p className="text-lg font-bold tabular-nums">{fmt(charges, res.currency)}</p><p className="text-[11px] text-cocoa-500">room {fmt(res.total_cents, res.currency)} + extras</p></div>
              <div className="p-3"><p className="text-xs uppercase tracking-wide text-cocoa-500">Paid</p><p className="text-lg font-bold tabular-nums text-emerald-800">{fmt(paid, res.currency)}</p>{unverified > 0 && <p className="text-[11px] text-amber-700">{fmt(unverified, res.currency)} to verify</p>}</div>
              <div className="p-3"><p className="text-xs uppercase tracking-wide text-cocoa-500">{balance < 0 ? 'Credit' : 'Balance'}</p><p className={`text-lg font-bold tabular-nums ${balance > 0 ? 'text-red-800' : balance < 0 ? 'text-sky-700' : 'text-emerald-700'}`}>{fmt(Math.abs(balance), res.currency)}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {['hold', 'pending', 'expired'].includes(res.status) && can(u.role, 'reservation.confirm') && (
                <form action={confirmAction}><input type="hidden" name="id" value={id} /><ConfirmButton className={Btn} message="Confirm this reservation? The guest will be told it is confirmed.">Confirm reservation</ConfirmButton></form>)}
              {res.status === 'confirmed' && <form action={checkInAction}><input type="hidden" name="id" value={id} /><button className={Btn}>Check in</button></form>}
              {res.status === 'checked_in' && <form action={checkOutAction}><input type="hidden" name="id" value={id} /><ConfirmButton className={Btn} message="Check this guest out?">Check out</ConfirmButton></form>}
              {balance > 0 && live && <Link href={`/dashboard/folio/${id}#pay`} className={BtnGhost}>Take payment</Link>}
              {res.status === 'confirmed' && <form action={noShowAction}><input type="hidden" name="id" value={id} /><ConfirmButton className={BtnGhost} message="Mark as no-show? The bed will be released.">No-show</ConfirmButton></form>}
            </div>
          </Card>

          {(['hold', 'pending'].includes(res.status) && can(u.role, 'reservation.confirm')) || (live && res.status !== 'checked_in' && can(u.role, 'reservation.cancel')) ? (
          <Card title="Reject or cancel">
            {['hold', 'pending'].includes(res.status) && can(u.role, 'reservation.confirm') && (
              <form action={rejectAction} className="flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={id} />
                <div className="min-w-[14rem] flex-1"><Lbl htmlFor="rj">Reject request (reason, optional)</Lbl><input id="rj" name="reason" className={Input} /></div>
                <ConfirmButton className={BtnDanger} message="Reject this request and release the beds?">Reject</ConfirmButton></form>)}
            {live && res.status !== 'checked_in' && can(u.role, 'reservation.cancel') && (
              <form action={cancelAction} className="mt-3 flex flex-wrap items-end gap-2"><input type="hidden" name="id" value={id} />
                <div className="min-w-[14rem] flex-1"><Lbl htmlFor="cr">Cancel reservation (reason)</Lbl><input id="cr" name="reason" className={Input} /></div>
                <ConfirmButton className={BtnDanger} message="Cancel this reservation? Beds are released and the guest may be notified. This cannot be undone.">Cancel reservation</ConfirmButton></form>)}
          </Card>) : null}

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
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-cocoa-50 p-3 text-sm text-cocoa-800">Cash or card at the desk? <Link href={`/dashboard/folio/${id}#pay`} className="font-semibold underline">Take payment on the folio</Link> — it goes straight into the shift drawer and the balance.</p>
            <p className="mt-2 text-xs text-slate-500">Transfers below count toward the balance only after a manager/owner verifies them. A guest message or screenshot is never enough.</p>
            {can(u.role, 'payment.record') && (
              <form action={recordPaymentAction} className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-5"><input type="hidden" name="id" value={id} />
                <div><Lbl htmlFor="pa">Amount ({res.currency})</Lbl><input id="pa" name="amount" required inputMode="decimal" className={Input} /></div>
                <div><Lbl htmlFor="pm">Method</Lbl><select id="pm" name="method" className={Input}>{METHODS.filter((m) => !['cash', 'card_terminal'].includes(m)).map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</select></div>
                <div><Lbl htmlFor="pr">Reference</Lbl><input id="pr" name="reference" className={Input} /></div>
                <div><Lbl htmlFor="pn">Note</Lbl><input id="pn" name="note" className={Input} /></div>
                <div className="flex items-end"><button className={Btn}>Record payment</button></div></form>)}
          </Card>

          <Card title={`Extras on the folio (${extras.length})`}>
            {extras.length === 0 ? <p className="text-sm text-slate-500">No extras yet. Anything sold on the POS to this room, a taxi or a custom charge shows here.</p> : (
              <ul className="divide-y divide-cocoa-100 text-sm">{extras.map((l: any) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2"><span><span className="me-2 rounded-full bg-cocoa-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-cocoa-700">{l.kind}</span>{l.description}{l.quantity > 1 ? ` × ${l.quantity}` : ''}<span className="ms-2 text-xs text-slate-400">{l.date}</span></span>
                  <b className={`tabular-nums ${l.amount_cents < 0 ? 'text-emerald-700' : ''}`}>{fmt(l.amount_cents, res.currency)}</b></li>))}</ul>)}
            <div className="mt-3 flex flex-wrap gap-4 border-t border-cocoa-100 pt-3 text-sm font-semibold">
              <Link href={`/dashboard/folio/${id}`} className="text-cocoa-700 underline">Add a charge or taxi on the folio</Link>
              <a href="/pos" target="_blank" rel="noopener" className="text-cocoa-700 underline">Sell on the POS</a>
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
          {!live && <Card title="Beds assigned">{alloc.length === 0 ? <p className="text-sm text-slate-500">None (history only).</p> : <ul className="text-sm">{alloc.map((a) => <li key={a.id} className={a.active ? '' : 'text-slate-400 line-through'}>{a.room} / {a.label} · {a.guests} guest(s)</li>)}</ul>}</Card>}
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
