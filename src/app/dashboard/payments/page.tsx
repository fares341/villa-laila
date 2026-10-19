import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { can } from '@/lib/permissions';
import { PageHeader, Card, Empty, Flash, fmt, dt, Btn } from '@/components/dash';
import { ConfirmButton } from '@/components/ConfirmButton';
import { verifyPaymentAction } from '../actions';

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('payment.record');
  const sp = await searchParams;
  const waiting = await q<any>(`SELECT p.*, r.reference, r.currency, g.full_name FROM payments p JOIN reservations r ON r.id=p.reservation_id JOIN guests g ON g.id=r.guest_id WHERE p.status='recorded' ORDER BY p.created_at`);
  const owing = await q<any>(`SELECT r.id, r.reference, r.status, r.check_in, r.total_cents, r.currency, g.full_name, g.phone, p.paid FROM reservations r JOIN guests g ON g.id=r.guest_id
     LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0)::bigint paid FROM payments WHERE reservation_id=r.id) p ON true
     WHERE r.status IN ('confirmed','checked_in','checked_out') AND r.total_cents - p.paid > 0 ORDER BY r.check_in LIMIT 100`);
  const total = owing.reduce((s, r) => s + (r.total_cents - r.paid), 0);
  return (
    <>
      <PageHeader title="Payments" sub="Recorded vs verified. Only verified payments reduce a balance." />
      <Flash sp={sp} />
      <Card title={`Waiting for verification (${waiting.length})`}>
        {waiting.length === 0 ? <Empty>Nothing waiting.</Empty> : <table className="w-full text-sm"><tbody className="divide-y">{waiting.map((p) => (
          <tr key={p.id}><td className="py-2"><Link className="underline" href={`/dashboard/reservations/${p.reservation_id}`}>{p.reference}</Link> · {p.full_name}</td><td>{fmt(p.amount_cents, p.currency)}</td><td>{p.method.replace('_', ' ')}{p.reference ? ` · ${p.reference}` : ''}</td><td className="text-xs text-slate-500">{dt(p.created_at)}</td>
            <td>{can(u.role, 'payment.verify') ? <form action={verifyPaymentAction} className="flex gap-3"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/dashboard/payments" />
              <ConfirmButton name="decision" value="verify" className={Btn} message="Verify only after you have really received the money. Verify this payment?">Verify</ConfirmButton>
              <button name="decision" value="reject" className="text-red-800 underline">Reject</button></form> : <span className="text-xs text-slate-500">Manager must verify</span>}</td></tr>))}</tbody></table>}
      </Card>
      <Card title={`Outstanding balances — ${fmt(total)} across ${owing.length} reservation(s)`} className="mt-6">
        {owing.length === 0 ? <p className="text-sm text-slate-500">No outstanding balances.</p> : <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th>Reservation</th><th>Guest</th><th>Check-in</th><th>Total</th><th>Verified paid</th><th>Balance</th></tr></thead><tbody className="divide-y">{owing.map((r) => (
          <tr key={r.id}><td className="py-2"><Link className="underline" href={`/dashboard/reservations/${r.id}`}>{r.reference}</Link></td><td>{r.full_name}<span className="block text-xs text-slate-500">{r.phone}</span></td><td>{r.check_in}</td><td>{fmt(r.total_cents, r.currency)}</td><td>{fmt(r.paid, r.currency)}</td><td className="font-semibold text-red-800">{fmt(r.total_cents - r.paid, r.currency)}</td></tr>))}</tbody></table>}
      </Card>
    </>
  );
}
