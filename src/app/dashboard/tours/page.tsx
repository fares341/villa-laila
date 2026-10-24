import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PageHeader, Card, fmt, dt, BtnGhost, Input, Stat, Pill, SubTabs } from '@/components/dash';
import { Icon } from '@/components/icons';
import { tourTripSave } from '../pms-actions';

export const dynamic = 'force-dynamic';

export default async function ToursDesk({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('tours.manage');
  const sp = await searchParams;
  // Trips still to happen (or without a day yet): the old "Tours" sheet: day, pick-up, guide, driver.
  const trips = await q<any>(`
    SELECT s.id, s.created_at, s.quantity, s.guest_name, s.room_number, s.tour_date, s.tour_time, s.guide_name, s.driver_name, s.driver_phone, t.name tour, r.reference
    FROM service_orders s JOIN tours_catalog t ON t.id=s.tour_id LEFT JOIN reservations r ON r.id=s.reservation_id
    WHERE s.payment_status <> 'void' AND ((s.tour_date IS NULL AND s.created_at > now() - interval '14 days') OR s.tour_date >= (now() AT TIME ZONE 'Africa/Cairo')::date - 1)
    ORDER BY s.tour_date NULLS FIRST, s.tour_time, s.created_at LIMIT 60`);
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
  const METHOD: Record<string, string> = { cash: 'Cash', card_terminal: 'Card', room_charge: 'Room', comp: 'Free (owner)' };

  return (
    <>
      <PageHeader title="Tour sales & trips" sub="Tours are sold on the POS (Tours tab). Fill in the day, pick-up time, guide and driver of each trip here. Profit = sell price − what we pay the organizer.">
        <form className="flex items-center gap-2">
          <input type="date" name="from" defaultValue={from} className={Input + ' w-40'} aria-label="From" />
          <input type="date" name="to" defaultValue={to} className={Input + ' w-40'} aria-label="To" />
          <button className={BtnGhost}>Show</button>
        </form>
      </PageHeader>
      <SubTabs current="/dashboard/tours" tabs={[{ href: '/dashboard/catalog', label: 'Products & stock', icon: 'package' }, { href: '/dashboard/catalog?tab=tours', label: 'Tours & prices', icon: 'map' }, { href: '/dashboard/tours', label: 'Tour sales & trips', icon: 'bar-chart' }]} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Guests booked" value={sales.reduce((a, s) => a + s.quantity, 0)} />
        <Stat label="Sales" value={fmt(rev)} />
        <Stat label="To pay organizers" value={fmt(cost)} />
        <Stat label="Our profit" value={fmt(rev - cost)} tone="ok" />
      </div>
      <Card title={`Trips (${trips.length})`} className="mb-5">
        {trips.length === 0 ? <p className="text-sm text-slate-500">No trips coming up. A tour sold on the POS appears here.</p> : (
          <div className="space-y-2">
            {trips.map((t) => (
              <form key={t.id} action={tourTripSave} className={`grid items-end gap-2 rounded-lg border p-2 text-sm md:grid-cols-[minmax(0,1.6fr)_9rem_6rem_minmax(0,1fr)_minmax(0,1fr)_8rem_auto] ${t.tour_date ? 'border-slate-100' : 'border-amber-300 bg-amber-50/50'}`}>
                <input type="hidden" name="id" value={t.id} />
                <div><b>{t.tour}</b><div className="text-xs text-slate-600">{t.guest_name || 'Walk-in'}{t.room_number ? ` · ${t.room_number}` : ''} · {t.quantity} guest{t.quantity === 1 ? '' : 's'}{!t.tour_date && <span className="ms-1 font-semibold text-amber-800">· day not set</span>}</div></div>
                <label className="text-xs text-slate-500">Day<input name="date" type="date" defaultValue={t.tour_date ?? ''} className={Input} /></label>
                <label className="text-xs text-slate-500">Pick-up<input name="time" type="time" defaultValue={t.tour_time ?? ''} className={Input} /></label>
                <label className="text-xs text-slate-500">Guide<input name="guide" defaultValue={t.guide_name ?? ''} className={Input} /></label>
                <label className="text-xs text-slate-500">Driver<input name="driver" defaultValue={t.driver_name ?? ''} className={Input} /></label>
                <label className="text-xs text-slate-500">Driver phone<input name="phone" dir="ltr" defaultValue={t.driver_phone ?? ''} className={Input} /></label>
                <button className={BtnGhost}>Save</button>
              </form>
            ))}
          </div>
        )}
      </Card>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="By organizer">
          <ul className="space-y-2 text-sm">
            {[...byOrg.entries()].map(([org, o]) => (
              <li key={org} className="rounded-lg border border-slate-100 p-3"><b>{org}</b>
                <div className="mt-1 grid grid-cols-3 gap-1 text-xs text-slate-600"><span>{o.pax} guests</span><span>Pay {fmt(o.cost)}</span><span className="text-emerald-700">Profit {fmt(o.revenue - o.cost)}</span></div></li>
            ))}
            {byOrg.size === 0 && <li className="text-slate-500">No tour sales in this period.</li>}
          </ul>
        </Card>
        <Card title="Tour sales" className="xl:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th className="py-2">When</th><th>Tour</th><th>Guest</th><th className="text-right">Guests</th><th className="text-right">Sell</th><th className="text-right">Profit</th><th className="pl-4">Paid by</th></tr></thead>
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
