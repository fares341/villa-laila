import { requireUser } from '@/lib/auth';
import { reportData, houseView } from '@/services/queries';
import { moneyByCurrency } from '@/services/pms/pos';
import { PageHeader, Card, Input, Lbl, Btn, fmt, SubTabs, REPORT_TABS, sourceLabel, STATUS_LABEL } from '@/components/dash';
import { todayLocal, addDays } from '@/lib/dates';

export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('reports.view');
  const sp = await searchParams;
  const today = todayLocal();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : today.slice(0, 8) + '01';
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : addDays(today, 1);
  const [r, hv, m] = await Promise.all([reportData(from, to), houseView(), moneyByCurrency(from, to)]);
  const money = (minor: number, c: string) => `${minor < 0 ? '−' : ''}${c} ${(Math.abs(minor) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  const nm = (o: any) => o?.en ?? '';
  const day = (iso: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
  const Row = ({ k, v, hint }: { k: string; v: React.ReactNode; hint?: string }) => <div className="flex items-baseline justify-between gap-4 border-b border-cocoa-100 py-2 text-sm last:border-0"><span>{k}{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span><span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">{v}</span></div>;
  return (
    <>
      <PageHeader title="Reports" sub="Occupancy tonight and this week, then any period you choose. Cash per shift is under Money → Shifts & cash." />
      <SubTabs tabs={REPORT_TABS} current="/dashboard/reports" />
      <div className="mb-6 grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Card title="Tonight, room by room">
          <ul className="space-y-2.5">
            {hv.byType.map((t: any) => { const pct = t.total ? Math.round((t.booked / t.total) * 100) : 0; return (
              <li key={t.id} className="grid grid-cols-[9.5rem_1fr_4.5rem] items-center gap-3 text-sm">
                <span className="truncate text-cocoa-800">{nm(t.name)}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-cocoa-100"><span className="block h-full rounded-full bg-cocoa-600" style={{ width: `${pct}%` }} /></span>
                <span className="text-end tabular-nums text-cocoa-600">{t.booked}/{t.total}</span>
              </li>); })}
          </ul>
        </Card>
        <Card title="Next 7 nights">
          <div className="flex h-40 items-end gap-2">
            {hv.week.map((w: any) => { const pct = w.total ? Math.round((w.booked / w.total) * 100) : 0; return (
              <div key={w.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${day(w.day)}: ${w.booked}/${w.total}`}>
                <span className="text-xs tabular-nums text-cocoa-600">{pct}%</span>
                <span className="w-full rounded-t-[4px] bg-gold-500" style={{ height: `${Math.max(pct, 2)}%` }} />
              </div>); })}
          </div>
          <div className="mt-2 flex gap-2 border-t border-cocoa-100 pt-2">{hv.week.map((w: any) => <span key={w.day} className="flex-1 text-center text-xs text-cocoa-600">{day(w.day)}</span>)}</div>
        </Card>
      </div>
      <form className="mb-5 flex flex-wrap items-end gap-3"><div><Lbl>From</Lbl><input type="date" name="from" defaultValue={from} className={Input} /></div><div><Lbl>Until (day before)</Lbl><input type="date" name="to" defaultValue={to} className={Input} /></div><button className={Btn}>Show</button></form>
      <Card title="Money received, by currency" className="mb-5">
        <p className="-mt-1 mb-3 text-xs text-slate-500">Cash exactly as it came in, in its own currency: POS sales, room payments, event tickets, tips and money exchange; then what left the drawer. “EGP value” is the cash received at the rate used that day.</p>
        {m.cash.length === 0 ? <p className="text-sm text-slate-500">No cash in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-2">Currency</th><th className="text-right">Cash received</th><th className="text-right">EGP value</th><th className="text-right">Tips</th><th className="text-right">Money exchange</th><th className="text-right">Paid from drawer</th><th className="text-right">Taken by owner</th><th className="text-right">Net cash</th></tr></thead>
              <tbody>{m.cash.map((c) => (
                <tr key={c.currency} className="border-t border-cocoa-100">
                  <td className="py-2 font-semibold">{c.currency}</td>
                  <td className="text-right tabular-nums">{money(c.received, c.currency)}</td>
                  <td className="text-right tabular-nums text-slate-600">{c.currency === 'EGP' ? '—' : fmt(c.receivedEgp)}</td>
                  <td className="text-right tabular-nums">{c.tips ? money(c.tips, c.currency) : '—'}</td>
                  <td className="text-right tabular-nums">{c.exchangeIn || c.exchangeOut ? money(c.exchangeIn + c.exchangeOut, c.currency) : '—'}</td>
                  <td className="text-right tabular-nums">{c.paidOut ? money(c.paidOut, c.currency) : '—'}</td>
                  <td className="text-right tabular-nums">{c.taken ? money(c.taken, c.currency) : '—'}</td>
                  <td className="text-right font-semibold tabular-nums">{money(c.net, c.currency)}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
        {m.tipsEgp > 0 && <p className="mt-3 text-sm">All tips (cash + card): <b className="tabular-nums">{fmt(m.tipsEgp)}</b> <span className="text-xs text-slate-500">not hostel income</span></p>}
        <div className="mt-4 grid gap-3 border-t border-cocoa-100 pt-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
          <div><p className="text-xs uppercase text-slate-500">Card machine</p><p className="font-semibold tabular-nums">{fmt(m.card + m.cardTips)}</p>{m.cardTips > 0 && <p className="text-[11px] text-slate-500">incl. tips {fmt(m.cardTips)}</p>}</div>
          <div><p className="text-xs uppercase text-slate-500">InstaPay</p><p className="font-semibold tabular-nums">{fmt(m.instapay)}</p></div>
          <div><p className="text-xs uppercase text-slate-500">Vodafone Cash</p><p className="font-semibold tabular-nums">{fmt(m.vodafone)}</p></div>
          {m.online > 0 && <div><p className="text-xs uppercase text-slate-500">Online card</p><p className="font-semibold tabular-nums">{fmt(m.online)}</p></div>}
          <div><p className="text-xs uppercase text-slate-500">Paid to booking sites</p><p className="font-semibold tabular-nums">{fmt(m.sites)}</p><p className="text-[11px] text-slate-500">the site pays us later</p></div>
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Occupancy"><Row k="Nights sold" v={r.sold} hint="Bed/room-nights on confirmed, checked-in or checked-out reservations" /><Row k="Beds & rooms" v={r.unitCount} /><Row k="Days in period" v={r.days} /><Row k="Occupancy" v={`${r.occupancy}%`} hint="Nights sold ÷ (beds & rooms × days)" /></Card>
        <Card title="Money"><Row k="Room value booked" v={fmt(r.money.booked)} hint="Room price of stays arriving in the period (extras are in Sales by service; cash is in Shifts & cash)" /><Row k="Payments received (verified)" v={fmt(r.money.received)} hint="Verified in the period, regardless of arrival date" /><Row k="Payments awaiting verification" v={fmt(r.money.unverified)} /><Row k="Outstanding balances (all time, today)" v={fmt(r.outstanding)} /></Card>
        <Card title="Where requests come from">{r.bySource.length === 0 ? <p className="text-sm text-slate-500">No requests in this period.</p> : r.bySource.map((s: any) => <Row key={s.source} k={sourceLabel(s.source)} v={`${s.n} requests → ${s.confirmed} confirmed (${s.n ? Math.round((s.confirmed / s.n) * 100) : 0}%)`} />)}<p className="mt-2 text-xs text-slate-500">Conversion = requests created in the period that are now confirmed. Website visits are not tracked, so visit-to-request conversion is not available.</p></Card>
        <Card title="Cancellations & lost requests (by arrival date)">{r.cancels.length === 0 ? <p className="text-sm text-slate-500">None.</p> : r.cancels.map((c: any) => <Row key={c.status} k={STATUS_LABEL[c.status] ?? c.status} v={c.n} />)}</Card>
        <Card title="Stay extensions">{r.ext.length === 0 ? <p className="text-sm text-slate-500">None in this period.</p> : r.ext.map((e: any) => <Row key={e.status} k={e.status} v={`${e.n}${e.status === 'applied' ? ` · ${fmt(e.cents)}` : ''}`} />)}</Card>
      </div>
    </>
  );
}
