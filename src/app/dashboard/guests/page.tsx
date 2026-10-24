import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Empty, Input, Btn, BtnGhost, Lbl, fmt } from '@/components/dash';

export default async function Guests({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('guest.view');
  const sp = await searchParams;
  const like = '%' + (sp.q ?? '').toLowerCase() + '%';
  const rows = await q<any>(`SELECT g.*, (SELECT count(*) FROM reservations r WHERE r.guest_id=g.id)::int stays, (SELECT max(check_out) FROM reservations r WHERE r.guest_id=g.id AND r.status IN ('confirmed','checked_in','checked_out')) last_stay,
      (SELECT COALESCE(SUM(folio_charges(r.id) - COALESCE(p.paid,0)),0) FROM reservations r LEFT JOIN LATERAL (SELECT SUM(amount_cents) FILTER (WHERE status='verified') paid FROM payments WHERE reservation_id=r.id) p ON true WHERE r.guest_id=g.id AND r.status IN ('confirmed','checked_in','checked_out'))::bigint owing
    FROM guests g WHERE ($1='%%' AND EXISTS (SELECT 1 FROM reservations r WHERE r.guest_id=g.id)) OR ($1<>'%%' AND (lower(g.full_name) LIKE $1 OR lower(coalesce(g.email,'')) LIKE $1 OR coalesce(g.phone,'') LIKE $1)) ORDER BY g.created_at DESC LIMIT 100`, [like]);
  return (
    <>
      <PageHeader title="Guests" sub="Everyone who booked with us, newest first. Search to also find people who only asked." />
      <form className="mb-4 flex max-w-xl items-end gap-2"><div className="flex-1"><Lbl htmlFor="q">Search name, email or phone</Lbl><input id="q" name="q" defaultValue={sp.q} className={Input} /></div><button className={Btn}>Search</button><Link href="/dashboard/guests" className={BtnGhost}>Clear</Link></form>
      {rows.length === 0 ? <Empty>No guests found.</Empty> : (
        <div className="overflow-x-auto rounded-xl border bg-white"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-600"><tr><th className="px-3 py-2">Name</th><th>Contact</th><th>Stays</th><th>Last stay</th><th>Still to pay</th></tr></thead><tbody className="divide-y">
          {rows.map((g) => <tr key={g.id} className="hover:bg-slate-50"><td className="px-3 py-2 font-medium"><Link className="underline" href={`/dashboard/guests/${g.id}`}>{g.full_name}</Link>{g.opted_out && <span className="ms-2 text-xs text-red-700">opted out</span>}</td><td>{g.phone ?? ''} {g.email ?? ''}{g.telegram_chat_id ? ' · Telegram' : ''}</td><td>{g.stays}</td><td>{g.last_stay ?? '—'}</td><td className={g.owing > 0 ? 'font-semibold text-red-800' : ''}>{fmt(g.owing)}</td></tr>)}</tbody></table></div>)}
    </>
  );
}
