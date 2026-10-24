import { todayLocal, addDays } from '@/lib/dates';
import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { PageHeader, Card, Flash, fmt, Btn, BtnGhost, SubTabs, REPORT_TABS } from '@/components/dash';
import { getDailyServicesMatrix } from '@/services/frontdesk';
import { ExportCsvButton } from './export-client';
import { Icon } from '@/components/icons';

export default async function ServicesReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser('reports.view');
  const sp = await searchParams;

  // Cairo day, not UTC (after midnight in Cairo the UTC date is still yesterday).
  const defaultTo = todayLocal();
  const defaultFrom = addDays(defaultTo, -30);

  const from = sp.from || defaultFrom;
  const to = sp.to || defaultTo;

  const rows = await getDailyServicesMatrix(from, to);

  // Totals across all rows
  const totals = rows.reduce(
    (acc, r) => ({
      breakfast: acc.breakfast + Number(r.breakfast_cents),
      towel: acc.towel + Number(r.towel_cents),
      taxi: acc.taxi + Number(r.taxi_cents),
      pool: acc.pool + Number(r.pool_cents),
      laundry: acc.laundry + Number(r.laundry_cents),
      water: acc.water + Number(r.water_cents),
      drinks: acc.drinks + Number(r.drinks_snack_cents),
      tour: acc.tour + Number(r.tour_cents),
      meal: acc.meal + Number(r.meal_cents),
      other: acc.other + Number(r.other_cents),
      totalDaily: acc.totalDaily + Number(r.total_daily_cents),
    }),
    {
      breakfast: 0,
      towel: 0,
      taxi: 0,
      pool: 0,
      laundry: 0,
      water: 0,
      drinks: 0,
      tour: 0,
      meal: 0,
      other: 0,
      totalDaily: 0,
    }
  );

  return (
    <>
      <PageHeader
        title="Sales by service"
        sub="POS sales per day and per service, plus airport taxis. Free (owner) and cancelled sales are not counted."
      >
        <ExportCsvButton rows={rows} from={from} to={to} />
      </PageHeader>

      <SubTabs tabs={REPORT_TABS} current="/dashboard/reports/services" />
      <Flash sp={sp} />

      {/* Date Filter Bar */}
      <Card className="mb-6">
        <form method="GET" className="flex flex-wrap items-end gap-3 text-sm">
          <div>
            <label htmlFor="rep_from" className="block text-xs font-semibold text-slate-700 mb-1">From</label>
            <input
              id="rep_from"
              type="date"
              name="from"
              defaultValue={from}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
            />
          </div>
          <div>
            <label htmlFor="rep_to" className="block text-xs font-semibold text-slate-700 mb-1">To</label>
            <input
              id="rep_to"
              type="date"
              name="to"
              defaultValue={to}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-amber-700 px-4 py-1.5 text-xs font-bold text-white hover:bg-amber-800"
          >
            Update report
          </button>
        </form>
      </Card>

      {/* Summary KPI Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-left">
          <span className="text-[11px] text-slate-500 font-medium">Breakfast</span>
          <p className="font-bold text-slate-900 mt-0.5">{fmt(totals.breakfast)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-left">
          <span className="text-[11px] text-slate-500 font-medium">Wash</span>
          <p className="font-bold text-slate-900 mt-0.5">{fmt(totals.laundry)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-left">
          <span className="text-[11px] text-slate-500 font-medium">Tours</span>
          <p className="font-bold text-slate-900 mt-0.5">{fmt(totals.tour)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-left">
          <span className="text-[11px] text-slate-500 font-medium">Taxi & transfers</span>
          <p className="font-bold text-slate-900 mt-0.5">{fmt(totals.taxi)}</p>
        </div>
        <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3 text-left">
          <span className="text-[11px] text-amber-900 font-bold">Total services sales</span>
          <p className="text-lg font-bold text-amber-950 mt-0.5">{fmt(totals.totalDaily)}</p>
        </div>
      </div>

      {/* Services Matrix Table */}
      <Card title={`Daily sales breakdown (${from} to ${to})`}>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No services sales recorded in this period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-700">
                <tr>
                  <th className="py-2.5 px-2">Date</th>
                  <th className="py-2.5 px-2">Breakfast</th>
                  <th className="py-2.5 px-2">Towel</th>
                  <th className="py-2.5 px-2">Taxi</th>
                  <th className="py-2.5 px-2">Pool</th>
                  <th className="py-2.5 px-2">Wash</th>
                  <th className="py-2.5 px-2">Water</th>
                  <th className="py-2.5 px-2">Drinks &amp; snacks</th>
                  <th className="py-2.5 px-2">Tours</th>
                  <th className="py-2.5 px-2">Meals</th>
                  <th className="py-2.5 px-2" title="Extras typed by hand and services not in another column">Other</th>
                  <th className="py-2.5 px-2 font-bold text-slate-900">Daily total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {rows.map((r) => (
                  <tr key={r.order_date} className="hover:bg-slate-50/70">
                    <td className="py-2 px-2 font-bold text-slate-800">{r.order_date}</td>
                    <td className="py-2 px-2">{fmt(r.breakfast_cents)}</td>
                    <td className="py-2 px-2">{fmt(r.towel_cents)}</td>
                    <td className="py-2 px-2">{fmt(r.taxi_cents)}</td>
                    <td className="py-2 px-2">{fmt(r.pool_cents)}</td>
                    <td className="py-2 px-2">{fmt(r.laundry_cents)}</td>
                    <td className="py-2 px-2">{fmt(r.water_cents)}</td>
                    <td className="py-2 px-2">{fmt(r.drinks_snack_cents)}</td>
                    <td className="py-2 px-2">{fmt(r.tour_cents)}</td>
                    <td className="py-2 px-2">{fmt(r.meal_cents)}</td>
                    <td className="py-2 px-2">{fmt(r.other_cents)}</td>
                    <td className="py-2 px-2 font-bold text-amber-950 bg-amber-50/40">
                      {fmt(r.total_daily_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-300 bg-slate-100/80 font-mono font-bold text-slate-900">
                <tr>
                  <td className="py-2.5 px-2">Grand total</td>
                  <td className="py-2.5 px-2">{fmt(totals.breakfast)}</td>
                  <td className="py-2.5 px-2">{fmt(totals.towel)}</td>
                  <td className="py-2.5 px-2">{fmt(totals.taxi)}</td>
                  <td className="py-2.5 px-2">{fmt(totals.pool)}</td>
                  <td className="py-2.5 px-2">{fmt(totals.laundry)}</td>
                  <td className="py-2.5 px-2">{fmt(totals.water)}</td>
                  <td className="py-2.5 px-2">{fmt(totals.drinks)}</td>
                  <td className="py-2.5 px-2">{fmt(totals.tour)}</td>
                  <td className="py-2.5 px-2">{fmt(totals.meal)}</td>
                  <td className="py-2.5 px-2">{fmt(totals.other)}</td>
                  <td className="py-2.5 px-2 text-amber-900 font-black">{fmt(totals.totalDaily)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
