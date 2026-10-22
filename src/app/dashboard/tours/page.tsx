import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, fmt, dt, BtnGhost, Input, Stat, Pill, SubTabs } from '@/components/dash';
import { Icon } from '@/components/icons';

export const dynamic = 'force-dynamic';

export default async function ToursDesk({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('tours.manage');
  const sp = await searchParams;
  const today = todayLocal();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(today, -29);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const sales = await q<any>(`
    SELECT s.id, s.created_at, s.item_name, s.quantity, s.amount_cents, s.unit_cost_cents, s.payment_method, s.payment_status, s.guest_name,
           t.name tour, t.organizer, r.reference, st.full_name cashier
    FROM service_orders s JOIN tours_catalog t ON t.id=s.tour_id
    LEFT JOIN reservations r ON r.id=s.reservation_id LEFT JOIN staff st ON st.id=s.pos_staff_id
    WHERE s.created_at >= $1::date AND s.created_at < $2::date + 1 AND s.payment_status <> 'void'
    ORDER BY s.created_at DESC`, [from, to]);
  const byOrg = new Map<string, { pax: number; revenue: number; cost: number }>();
  for (const s of sales) {
    const o = byOrg.get(s.organizer) ?? { pax: 0, revenue: 0, cost: 0 };
    o.pax += s.quantity; o.revenue += Number(s.amount_cents); o.cost += Number(s.unit_cost_cents) * s.quantity; byOrg.set(s.organizer, o);
  }
  const rev = sales.reduce((a, s) => a + Number(s.amount_cents), 0);
  const cost = sales.reduce((a, s) => a + Number(s.unit_cost_cents) * s.quantity, 0);
  const METHOD: Record<string, string> = { cash: 'Cash', card_terminal: 'Card', room_charge: 'Room', comp: 'Owner comp' };

  return (
    <>
      <PageHeader title="Tours desk" sub="Tours are sold on the POS (Tours tab). Hotel profit = sell price − organizer cost.">
        <form className="flex items-center gap-2">
          <input type="date" name="from" defaultValue={from} className={Input + ' w-40'} aria-label="From" />
          <input type="date" name="to" defaultValue={to} className={Input + ' w-40'} aria-label="To" />
          <button className={BtnGhost}>Show</button>
        </form>
      </PageHeader>
      <SubTabs current="/dashboard/tours" tabs={[{ href: '/dashboard/catalog', label: 'Items & stock', icon: 'package' }, { href: '/dashboard/catalog?tab=tours', label: 'Tours & prices', icon: 'map' }, { href: '/dashboard/tours', label: 'Tour sales & profit', icon: 'bar-chart' }]} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Guests booked" value={sales.reduce((a, s) => a + s.quantity, 0)} />
        <Stat label="Sales" value={fmt(rev)} />
        <Stat label="Owed to organizers" value={fmt(cost)} />
        <Stat label="Hotel net profit" value={fmt(rev - cost)} tone="ok" />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="By organizer">
          <ul className="space-y-2 text-sm">
            {[...byOrg.entries()].map(([org, o]) => (
              <li key={org} className="rounded-lg border border-slate-100 p-3"><b>{org}</b>
                <div className="mt-1 grid grid-cols-3 gap-1 text-xs text-slate-600"><span>{o.pax} pax</span><span>Pay {fmt(o.cost)}</span><span className="text-emerald-700">Profit {fmt(o.revenue - o.cost)}</span></div></li>
            ))}
            {byOrg.size === 0 && <li className="text-slate-500">No tour sales in this period.</li>}
          </ul>
        </Card>
        <Card title="Tour sales" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>Tour</th><th>Guest</th><th className="text-right">Pax</th><th className="text-right">Sell</th><th className="text-right">Profit</th><th className="pl-4">Paid by</th></tr></thead>
              <tbody>{sales.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-2">{dt(s.created_at)}<div className="text-xs text-slate-500">{s.cashier}</div></td>
                  <td>{s.tour}<div className="text-xs text-slate-500">{s.organizer}</div></td>
                  <td>{s.guest_name || 'Walk-in'}{s.reference && <div className="font-mono text-xs text-slate-500">{s.reference}</div>}</td>
                  <td className="text-right tabular-nums">{s.quantity}</td>
                  <td className="text-right tabular-nums">{fmt(Number(s.amount_cents))}</td>
                  <td className="text-right tabular-nums text-emerald-700">{fmt(Number(s.amount_cents) - Number(s.unit_cost_cents) * s.quantity)}</td>
                  <td className="pl-4"><Pill tone={s.payment_method === 'room_charge' ? 'amber' : 'slate'}>{METHOD[s.payment_method] ?? s.payment_method}</Pill></td>
                </tr>))}
                {sales.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">No tour sales in this period.</td></tr>}</tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
