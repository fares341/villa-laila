import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, fmt, dt, Btn, BtnGhost } from '@/components/dash';
import { getTourBookings } from '@/services/frontdesk';
import { createTourAction, updateTourStatusAction } from '../frontdesk-actions';
import { ToursClient } from './tours-client';

export default async function ToursPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser('tours.manage');
  const sp = await searchParams;

  const tours = await getTourBookings({
    from: sp.from || undefined,
    to: sp.to || undefined,
    status: sp.status || undefined,
  });

  // Fetch in-house checked-in guests for 1-click booking
  const inHouseGuests = await q<any>(`
    SELECT r.id, r.reference, g.full_name, g.phone,
      (SELECT string_agg(rm.name || ' ' || u.label, ', ')
       FROM reservation_units ru
       JOIN units u ON u.id = ru.unit_id
       JOIN rooms rm ON rm.id = u.room_id
       WHERE ru.reservation_id = r.id AND ru.active) as room_label
    FROM reservations r
    JOIN guests g ON g.id = r.guest_id
    WHERE r.status = 'checked_in'
    ORDER BY r.check_out ASC
  `);

  const scheduledCount = tours.filter((t) => t.status === 'scheduled').length;
  const totalRevenueEgp = tours.filter((t) => t.currency === 'EGP').reduce((s, t) => s + t.price_cents, 0);
  const totalRevenueUsd = tours.filter((t) => t.currency === 'USD').reduce((s, t) => s + t.price_cents, 0);
  const totalPax = tours.reduce((s, t) => s + (t.guests_count || 1), 0);

  return (
    <>
      <PageHeader
        title="مكتب الرحلات وتنقلات المطار (Tours & Transfers Desk)"
        sub="حجز وإدارة الجولات السياحية للأهرامات، سقارة، الإسكندرية، العشاء النيلي، وتنسيق السائقين والمرشدين وتوصيل المطار."
      >
        <Link href="/dashboard/pos" className={BtnGhost}>
          🛒 نقطة البيع السريعة
        </Link>
        <Link href="/dashboard/reports/services" className={BtnGhost}>
          📊 تقرير مبيعات الخدمات
        </Link>
      </PageHeader>

      <Flash sp={sp} />

      {/* Top Stat Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-amber-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">إجمالي حجوزات الرحلات</p>
          <p className="mt-1 text-2xl font-bold text-amber-950">{tours.length} حجز</p>
          <p className="mt-1 text-xs text-amber-700">{scheduledCount} رحلة مجدولة قادمة</p>
        </div>
        <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-emerald-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">إجمالي إيراد الرحلات (EGP)</p>
          <p className="mt-1 text-2xl font-bold text-emerald-950">{fmt(totalRevenueEgp, 'EGP')}</p>
          <p className="mt-1 text-xs text-emerald-700">جولات الأهرامات والإسكندرية</p>
        </div>
        <div className="rounded-2xl border border-blue-200/70 bg-gradient-to-br from-blue-50 to-blue-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-800">إيراد الرحلات بالدولار</p>
          <p className="mt-1 text-2xl font-bold text-blue-950">${(totalRevenueUsd / 100).toFixed(2)}</p>
          <p className="mt-1 text-xs text-blue-700">دفعات مباشرة بالعملة الأجنبية</p>
        </div>
        <div className="rounded-2xl border border-purple-200/70 bg-gradient-to-br from-purple-50 to-purple-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-purple-800">إجمالي عدد الأفراد (Pax)</p>
          <p className="mt-1 text-2xl font-bold text-purple-950">{totalPax} فرد</p>
          <p className="mt-1 text-xs text-purple-700">نزلاء وضيوف في الجولات</p>
        </div>
      </div>

      <ToursClient
        tours={tours}
        inHouseGuests={inHouseGuests}
        createTourAction={createTourAction}
        updateTourStatusAction={updateTourStatusAction}
      />
    </>
  );
}
