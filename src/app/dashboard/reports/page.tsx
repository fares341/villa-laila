import { requireUser } from '@/lib/auth';
import { reportData } from '@/services/queries';
import { PageHeader, Card, Input, Lbl, Btn, fmt } from '@/components/dash';
import { todayLocal, addDays } from '@/lib/dates';

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('reports.view');
  const sp = await searchParams;
  const today = todayLocal();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : today.slice(0, 8) + '01';
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : addDays(today, 1);
  const r = await reportData(from, to);
  const Row = ({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) => <div className="flex items-baseline justify-between gap-4 border-b py-2 text-sm last:border-0"><span>{k}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span><span className="font-semibold">{v}</span></div>;
  return (
    <>
      <PageHeader title="Reports" sub="Period: from (included) to (not included). Money is split into booked value, verified payments and amounts still due." />
      <form className="mb-5 flex flex-wrap items-end gap-3"><div><Lbl>From</Lbl><input type="date" name="from" defaultValue={from} className={Input} /></div><div><Lbl>To (not included)</Lbl><input type="date" name="to" defaultValue={to} className={Input} /></div><button className={Btn}>Show</button></form>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Occupancy"><Row k="Nights sold" v={r.sold} hint="Bed/room-nights on confirmed, checked-in or checked-out reservations" /><Row k="Bookable units" v={r.unitCount} /><Row k="Days in period" v={r.days} /><Row k="Occupancy" v={`${r.occupancy}%`} hint="Nights sold ÷ (units × days)" /></Card>
        <Card title="Money"><Row k="Booked value" v={fmt(r.money.booked)} hint="Total of confirmed/checked-in/checked-out stays arriving in the period" /><Row k="Payments received (verified)" v={fmt(r.money.received)} hint="Verified in the period, regardless of arrival date" /><Row k="Payments awaiting verification" v={fmt(r.money.unverified)} /><Row k="Outstanding balances (all time, today)" v={fmt(r.outstanding)} /></Card>
        <Card title="Where requests come from">{r.bySource.length === 0 ? <p className="text-sm text-slate-500">No requests in this period.</p> : r.bySource.map((s: any) => <Row key={s.source} k={s.source} v={`${s.n} requests → ${s.confirmed} confirmed (${s.n ? Math.round((s.confirmed / s.n) * 100) : 0}%)`} />)}<p className="mt-2 text-xs text-slate-500">Conversion = requests created in the period that are now confirmed. Website visits are not tracked, so visit-to-request conversion is not available.</p></Card>
        <Card title="Cancellations & lost requests (by arrival date)">{r.cancels.length === 0 ? <p className="text-sm text-slate-500">None.</p> : r.cancels.map((c: any) => <Row key={c.status} k={c.status.replace('_', ' ')} v={c.n} />)}</Card>
        <Card title="Stay extensions">{r.ext.length === 0 ? <p className="text-sm text-slate-500">None in this period.</p> : r.ext.map((e: any) => <Row key={e.status} k={e.status} v={`${e.n}${e.status === 'applied' ? ` · ${fmt(e.cents)}` : ''}`} />)}</Card>
      </div>
    </>
  );
}
