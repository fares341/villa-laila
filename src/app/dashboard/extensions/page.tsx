import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Empty, Flash, fmt, dt, Btn, BtnDanger } from '@/components/dash';
import { ConfirmButton } from '@/components/ConfirmButton';
import { decideExtensionAction } from '../actions';

export default async function Extensions({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('extension.decide');
  const sp = await searchParams;
  const open = await q<any>(`SELECT e.*, r.reference, r.currency, r.check_in, g.full_name, g.phone FROM extension_requests e JOIN reservations r ON r.id=e.reservation_id JOIN guests g ON g.id=r.guest_id WHERE e.status IN ('pending','conflict') ORDER BY e.created_at`);
  const done = await q<any>(`SELECT e.*, r.reference, r.currency, g.full_name FROM extension_requests e JOIN reservations r ON r.id=e.reservation_id JOIN guests g ON g.id=r.guest_id WHERE e.status NOT IN ('pending','conflict') ORDER BY e.created_at DESC LIMIT 15`);
  return (
    <>
      <PageHeader title="Stay extensions" sub="A guest asked to stay longer. The system has already checked the beds and the price — you decide." />
      <Flash sp={sp} />
      {open.length === 0 ? <Empty>No extension requests are waiting. 🎉</Empty> : (
        <div className="space-y-4">{open.map((e) => (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold"><Link className="underline" href={`/dashboard/reservations/${e.reservation_id}`}>{e.reference}</Link> · {e.full_name}</p>
                <p className="mt-1 text-sm">Departure <b>{e.old_check_out}</b> → <b>{e.new_check_out}</b> (+{e.extra_nights} night(s)) · extra cost <b>{fmt(e.extra_cents, e.currency)}</b></p>
                <p className="mt-1 text-xs text-slate-500">Requested {dt(e.created_at)} by {e.requested_by}</p>
                {e.status === 'conflict' ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">⚠ Cannot be granted automatically: {e.conflict_detail}. Approving will re-check and will refuse if the bed is still taken. You can move the other guest or the guest to another bed first, or reject.</p>
                  : <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">✔ The same bed(s) are free for the extra nights.</p>}
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
