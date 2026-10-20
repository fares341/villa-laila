'use client';

import { Icon } from '@/components/icons';

export function ExportCsvButton({
  rows,
  from,
  to,
}: {
  rows: any[];
  from: string;
  to: string;
}) {
  const handleExport = () => {
    const headers = [
      'Date',
      'Breakfast (EGP)',
      'Towel (EGP)',
      'Taxi (EGP)',
      'Pool (EGP)',
      'Laundry (EGP)',
      'Water (EGP)',
      'Drinks & Snacks (EGP)',
      'Tours (EGP)',
      'Meals (EGP)',
      'Total Daily (EGP)',
    ];

    const csvRows = [
      headers.join(','),
      ...rows.map((r) =>
        [
          r.order_date,
          (Number(r.breakfast_cents) / 100).toFixed(2),
          (Number(r.towel_cents) / 100).toFixed(2),
          (Number(r.taxi_cents) / 100).toFixed(2),
          (Number(r.pool_cents) / 100).toFixed(2),
          (Number(r.laundry_cents) / 100).toFixed(2),
          (Number(r.water_cents) / 100).toFixed(2),
          (Number(r.drinks_snack_cents) / 100).toFixed(2),
          (Number(r.tour_cents) / 100).toFixed(2),
          (Number(r.meal_cents) / 100).toFixed(2),
          (Number(r.total_daily_cents) / 100).toFixed(2),
        ].join(',')
      ),
    ];

    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `villa-layla-services-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleExport}
      type="button"
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
    >
      <Icon name="file-text" size={16} />
      <span>Export to Excel (CSV)</span>
    </button>
  );
}
