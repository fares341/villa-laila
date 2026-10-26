import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Empty, Flash, fmt, dt, Btn, BtnDanger, SubTabs } from '@/components/dash';
import { ConfirmButton } from '@/components/ConfirmButton';
import { Icon } from '@/components/icons';
import { decideExtensionAction, quickExtendAction } from '../actions';
import { freeNightsAfter } from '@/services/pms/extend';
import { todayLocal } from '@/lib/dates';
import { can } from '@/lib/permissions';

export default async function Extensions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('extension.decide');
  const sp = await searchParams;
  const canExtend = can(u.role, 'reservation.edit');
  const staying = canExtend ? await q<any>(`SELECT r.id, r.reference, r.status, r.check_in, r.check_out, g.full_name,
      (SELECT string_agg(DISTINCT rm.name, ', ') FROM reservation_units ru JOIN units un ON un.id=ru.unit_id JOIN rooms rm ON rm.id=un.room_id WHERE ru.reservation_id=r.id AND ru.active) rooms
    FROM reservations r JOIN guests g ON g.id=r.guest_id
    WHERE r.status IN ('confirmed','checked_in') AND r.check_out >= $1::date AND r.check_in <= $1::date + 1
    ORDER BY r.check_out, g.full_name`, [todayLocal()]) : [];
  const free = new Map(await Promise.all(staying.map(async (r: any) => [r.id, await freeNightsAfter(r.id, 14)] as const)));
  const posLink = sp.pay && /^[0-9a-f-]{36}$/i.test(sp.pay) ? sp.pay : null;
  const open = await q<any>(`SELECT e.*, r.reference, r.currency, r.check_in, g.full_name, g.phone FROM extension_requests e JOIN reservations r ON r.id=e.reservation_id JOIN guests g ON g.id=r.guest_id WHERE e.status IN ('pending','conflict') ORDER BY e.created_at`);
  const done = await q<any>(`SELECT e.*, r.reference, r.currency, g.full_name FROM extension_requests e JOIN reservations r ON r.id=e.reservation_id JOIN guests g ON g.id=r.guest_id WHERE e.status NOT IN ('pending','conflict') ORDER BY e.created_at DESC LIMIT 15`);
  return (
    <>
      <PageHeader title="Extend a stay" sub="Choose a guest and add nights, or decide on the requests guests sent. The payment is taken on the POS." />
      <SubTabs current="/dashboard/extensions" tabs={[{ href: '/dashboard/reservations', label: 'All reservations', icon: 'bed' }, { href: '/dashboard/extensions', label: 'Extend a stay', icon: 'arrow-left-right', count: open.length }]} />
      <Flash sp={sp} />
      {posLink && <p className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"><Icon name="banknote" size={18} />The extra nights are on the guest's bill. Take the payment on the POS: the guest is already chosen there.<a href={`/pos?guest=${posLink}`} className={Btn}>Open POS to pay</a></p>}
      {canExtend && (
        <Card title="Extend a guest's stay" className="mb-6">
          <p className="mb-3 text-sm text-slate-600">1. Find the guest &nbsp;·&nbsp; 2. Choose the extra nights and press Extend (same bed, priced per night, added to the bill) &nbsp;·&nbsp; 3. Take the payment on the POS. You can also do all three on the POS with the <b>Extend stay</b> button.</p>
          {staying.length === 0 ? <Empty>No guest is staying or arriving today.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-slate-600"><tr><th className="py-2">Guest</th><th>Room</th><th>Check-out</th><th>Same bed free</th><th className="text-right">Extend by</th></tr></thead>
              <tbody>{staying.map((r: any) => {
                const n = free.get(r.id) ?? 0;
                return (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2"><Link className="font-semibold underline" href={`/dashboard/reservations/${r.id}`}>{r.full_name}</Link><div className="text-xs text-slate-500">{r.reference}{r.status === 'confirmed' ? ' · arriving' : ''}</div></td>
                    <td>{r.rooms ?? '—'}</td>
                    <td className="tabular-nums">{String(r.check_out).slice(0, 10)}</td>
                    <td>{n === 0 ? <span className="text-red-700">Taken the next night</span> : <span className="text-emerald-700">{n >= 14 ? '14+' : n} night{n === 1 ? '' : 's'}</span>}</td>
                    <td className="py-2 text-right">{n === 0 ? <Link className="text-xs underline" href={`/dashboard/reservations/${r.id}`}>Move to a free bed first</Link> : (
                      <form action={quickExtendAction} className="inline-flex items-center gap-2"><input type="hidden" name="id" value={r.id} />
                        <select name="nights" aria-label="Extra nights" className="h-9 rounded-lg border border-slate-300 bg-white px-2">{Array.from({ length: Math.min(n, 14) }, (_, i) => <option key={i} value={i + 1}>{i + 1} night{i ? 's' : ''}</option>)}</select>
                        <button className={Btn}>Extend</button></form>
                    )}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </Card>
      )}
      <h2 className="mb-3 text-base font-semibold text-slate-800">Requests from guests</h2>
      {open.length === 0 ? <Empty>No extension requests are waiting.</Empty> : (
        <div className="space-y-4">{open.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold"><Link className="underline" href={`/dashboard/reservations/${e.reservation_id}`}>{e.reference}</Link> · {e.full_name}</p>
                <p className="mt-1 text-sm">Departure <b>{e.old_check_out}</b> → <b>{e.new_check_out}</b> (+{e.extra_nights} night(s)) · extra cost <b>{fmt(e.extra_cents, e.currency)}</b></p>
                <p className="mt-1 text-xs text-slate-500">Requested {dt(e.created_at)} by {e.requested_by}</p>
                {e.status === 'conflict' ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900"><Icon name="alert-triangle" size={16} className="me-1 inline-block align-text-bottom" />Cannot be granted automatically: {e.conflict_detail}. Approving will re-check and will refuse if the bed is still taken. You can move the other guest or the guest to another bed first, or reject.</p>
                  : <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><Icon name="check-circle" size={16} className="me-1 inline-block align-text-bottom" />The same bed(s) are free for the extra nights.</p>}
              </div>
              <form action={decideExtensionAction} className="flex gap-2"><input type="hidden" name="id" value={e.id} />
                <ConfirmButton name="decision" value="approve" className={Btn} message="Approve this extension? The reservation and price will change and the guest will be told.">Approve</ConfirmButton>
                <ConfirmButton name="decision" value="reject" className={BtnDanger} message="Reject this extension request?">Reject</ConfirmButton></form>
            </div>
          </Card>))}</div>)}
      {done.length > 0 && <Card title="Recently decided" className="mt-6"><ul className="text-sm">{done.map((e) => <li key={e.id} className="py-1">{e.reference} · {e.full_name} → {e.new_check_out} · <b>{e.status}</b> · {fmt(e.extra_cents, e.currency)}</li>)}</ul></Card>}
    </>
  );
}
