import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { can } from '@/lib/permissions';
import { PageHeader, Card, Empty, Flash, fmt, dt, Btn, BtnDanger, Pill } from '@/components/dash';
import { Icon } from '@/components/icons';
import { ConfirmButton } from '@/components/ConfirmButton';
import { listInstapaySubmissions } from '@/services/online-payments';
import { walletLabel } from '@/services/wallets';
import { tr } from '@/services/events';
import { verifyPaymentAction } from '../actions';
import { decideInstapayAction } from '../events/actions';

export const dynamic = 'force-dynamic';
const WALLET: Record<string, string> = { instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash', bank_transfer: 'Bank transfer', online_provider: 'Online', other: 'Other' };

/**
 * The one place for money that did NOT come through the POS: InstaPay / Vodafone Cash receipts
 * (sent by guests from the website, or added by staff on a stay). Approve only after the money is seen in the app.
 */
export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('payment.record');
  const sp = await searchParams;
  const canVerify = can(u.role, 'payment.verify');
  const [online, staffAdded, owing] = await Promise.all([
    listInstapaySubmissions(),
    q<any>(`SELECT p.*, r.reference res_ref, r.currency, g.full_name FROM payments p JOIN reservations r ON r.id=p.reservation_id JOIN guests g ON g.id=r.guest_id WHERE p.status='recorded' ORDER BY p.created_at`),
    q<any>(`SELECT r.id, r.reference, r.status, r.check_in, folio_charges(r.id)::bigint charges_cents, r.currency, g.full_name, g.phone, p.paid FROM reservations r JOIN guests g ON g.id=r.guest_id
       LEFT JOIN LATERAL (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE status='verified'),0)::bigint paid FROM payments WHERE reservation_id=r.id) p ON true
       WHERE r.status IN ('checked_in','checked_out') AND folio_charges(r.id) - p.paid > 0 ORDER BY r.check_in LIMIT 100`),
  ]);
  const total = owing.reduce((s, r) => s + (Number(r.charges_cents) - Number(r.paid)), 0);
  const n = online.length + staffAdded.length;
  return (
    <>
      <PageHeader title="Payments to check" sub="InstaPay and Vodafone Cash receipts. Approve only after you see the money arrive in the app. Cash and card are taken on the POS." />
      <Flash sp={sp} />
      <Card title={`Receipts waiting (${n})`}>
        {n === 0 ? <Empty>Nothing waiting. Receipts sent by guests from the website, and receipts added on a guest&apos;s stay, appear here (and on Telegram).</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-600"><tr><th className="py-2">Receipt</th><th>For</th><th>Guest</th><th>Wallet · transaction no.</th><th className="text-right">Amount</th><th>Sent</th><th /></tr></thead>
              <tbody>
                {online.map((p: any) => (
                  <tr key={p.id} className="border-t border-slate-100 align-top">
                    <td className="py-2">{p.has_proof ? (
                      <a href={`/api/media/instapay/${p.id}`} target="_blank" rel="noopener" className="block w-20" title="Open full size">
                        {String(p.proof_mime).startsWith('image/') ? <img src={`/api/media/instapay/${p.id}`} alt="Receipt" className="h-20 w-20 rounded-lg border border-slate-200 object-cover" />
                          : <span className="inline-flex items-center gap-1 text-sm underline"><Icon name="file-text" size={16} /> PDF</span>}
                      </a>) : <Pill tone="red">No picture</Pill>}</td>
                    <td>{p.kind === 'event'
                      ? <Link className="underline" href={`/en/tickets/${p.ticket_code}`}>Event: {tr(p.event_title, 'en')} · {p.event_date}</Link>
                      : <span>Room booking {p.res_ref}</span>}</td>
                    <td>{p.event_guest || p.res_guest}</td>
                    <td><b>{walletLabel(p.provider)}</b><div className="text-xs text-slate-600">{p.payer_name}{p.payer_reference ? ` · ${p.payer_reference}` : ''}</div></td>
                    <td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmt(Number(p.amount_cents), p.currency)}</td>
                    <td className="whitespace-nowrap text-xs">{dt(p.created_at)}</td>
                    <td className="whitespace-nowrap">
                      {canVerify ? (
                        <form action={decideInstapayAction} className="flex gap-1">
                          <input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/dashboard/payments" />
                          <ConfirmButton name="decision" value="verify" className={Btn} message="Did you see this money arrive in the InstaPay / Vodafone Cash app? Approve: the booking becomes confirmed and paid."><Icon name="check" size={16} /> Approve</ConfirmButton>
                          <button name="decision" value="reject" className={BtnDanger}><Icon name="x" size={16} /> Reject</button>
                        </form>
                      ) : <span className="text-xs text-slate-500">A manager checks</span>}
                    </td>
                  </tr>
                ))}
                {staffAdded.map((p: any) => (
                  <tr key={p.id} className="border-t border-slate-100 align-top">
                    <td className="py-2 text-xs text-slate-500">Added by staff</td>
                    <td><Link className="underline" href={`/dashboard/reservations/${p.reservation_id}`}>Room booking {p.res_ref}</Link></td>
                    <td>{p.full_name}</td>
                    <td><b>{WALLET[p.method] ?? p.method}</b><div className="text-xs text-slate-600">{p.reference}</div></td>
                    <td className="whitespace-nowrap text-right font-semibold tabular-nums">{fmt(Number(p.amount_cents), p.currency)}</td>
                    <td className="whitespace-nowrap text-xs">{dt(p.created_at)}</td>
                    <td className="whitespace-nowrap">{canVerify ? (
                      <form action={verifyPaymentAction} className="flex gap-1"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="back" value="/dashboard/payments" />
                        <ConfirmButton name="decision" value="verify" className={Btn} message="Did you see this money arrive in the app? Approve?"><Icon name="check" size={16} /> Approve</ConfirmButton>
                        <button name="decision" value="reject" className={BtnDanger}><Icon name="x" size={16} /> Reject</button></form>
                    ) : <span className="text-xs text-slate-500">A manager checks</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title={`Guests who still owe money: ${fmt(total)}`} className="mt-6">
        <p className="-mt-1 mb-3 text-xs text-slate-500">Guests in house or already gone with something left to pay. Open the stay and take it on the POS.</p>
        {owing.length === 0 ? <p className="text-sm text-slate-500">Nobody owes money.</p> : <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Booking</th><th>Guest</th><th>Check-in</th><th className="text-right">Bill</th><th className="text-right">Paid</th><th className="text-right">Still to pay</th></tr></thead><tbody className="divide-y">{owing.map((r) => (
          <tr key={r.id}><td className="py-2"><Link className="underline" href={`/dashboard/reservations/${r.id}`}>{r.reference}</Link></td><td>{r.full_name}<span className="block text-xs text-slate-500">{r.phone}</span></td><td>{r.check_in}</td><td className="text-right tabular-nums">{fmt(Number(r.charges_cents), r.currency)}</td><td className="text-right tabular-nums">{fmt(Number(r.paid), r.currency)}</td><td className="text-right font-semibold tabular-nums text-red-800">{fmt(Number(r.charges_cents) - Number(r.paid), r.currency)}</td></tr>))}</tbody></table>}
      </Card>
    </>
  );
}
