import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, fmt, dt, Input, Lbl, Btn, BtnGhost } from '@/components/dash';
import { getProducts, getServiceOrders } from '@/services/frontdesk';
import {
  createServiceOrderAction,
  createBatchServiceOrdersAction,
  createProductAction,
} from '../frontdesk-actions';
import { PosOrderForm } from './pos-client';

export default async function PosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser('pos.use');
  const sp = await searchParams;

  const today = new Date().toISOString().slice(0, 10);
  const filterDate = sp.date || today;

  // 1. Fetch available products
  const products = await getProducts();

  // 2. Fetch in-house checked-in guests for 1-click room charging
  const inHouseGuests = await q<any>(`
    SELECT r.id, r.reference, g.full_name, t.name as rt_name,
      (SELECT string_agg(rm.name || ' ' || u.label, ', ')
       FROM reservation_units ru
       JOIN units u ON u.id = ru.unit_id
       JOIN rooms rm ON rm.id = u.room_id
       WHERE ru.reservation_id = r.id AND ru.active) as room_label
    FROM reservations r
    JOIN guests g ON g.id = r.guest_id
    JOIN room_types t ON t.id = r.room_type_id
    WHERE r.status = 'checked_in'
    ORDER BY r.check_out ASC
  `);

  // 3. Fetch orders
  const orders = await getServiceOrders({
    date: sp.all === '1' ? undefined : filterDate,
    service: sp.service || undefined,
    status: sp.status || undefined,
    search: sp.q || undefined,
    limit: 120,
  });

  // Calculate daily totals
  const totalEgp = orders.filter(o => o.currency === 'EGP').reduce((sum, o) => sum + o.amount_cents, 0);
  const totalUsd = orders.filter(o => o.currency === 'USD').reduce((sum, o) => sum + o.amount_cents, 0);
  const totalEur = orders.filter(o => o.currency === 'EUR').reduce((sum, o) => sum + o.amount_cents, 0);
  const paidCount = orders.filter(o => o.payment_status === 'paid').length;
  const roomChargeCount = orders.filter(o => o.payment_status === 'charged_to_room').length;

  return (
    <>
      <PageHeader
        title="نقطة البيع وتسجيل الخدمات (POS & Daily Log)"
        sub="تسجيل ومتابعة مبيعات الكافتيريا، الغسيل، الفوط، الفطور، المشاوير، والرحلات اليومية للنزلاء والغرف."
      >
        <Link href="/dashboard/inventory" className={BtnGhost}>
          📦 جرد المخزن والفوط
        </Link>
        <Link href="/dashboard/shifts" className={BtnGhost}>
          💵 تقفيل الدرج والورديات
        </Link>
        <Link href="/dashboard/reports/services" className={BtnGhost}>
          📊 تقرير مبيعات الخدمات
        </Link>
      </PageHeader>

      <Flash sp={sp} />

      {/* Top Stat Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-amber-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">إجمالي المبيعات (EGP)</p>
          <p className="mt-1 text-2xl font-bold text-amber-950">{fmt(totalEgp, 'EGP')}</p>
          <p className="mt-1 text-xs text-amber-700">{orders.length} طلبات مسجلة</p>
        </div>
        <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-emerald-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">مبيعات الدولار واليورو</p>
          <p className="mt-1 text-xl font-bold text-emerald-950">
            ${(totalUsd / 100).toFixed(2)} <span className="text-sm font-normal text-slate-500">/</span> €{(totalEur / 100).toFixed(2)}
          </p>
          <p className="mt-1 text-xs text-emerald-700">عملات أجنبية بالدرج</p>
        </div>
        <div className="rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50 to-sky-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-sky-800">حالة الدفع</p>
          <p className="mt-1 text-xl font-bold text-sky-950">
            {paidCount} مدفوع <span className="text-sm font-normal text-slate-500">|</span> {roomChargeCount} على الغرفة
          </p>
          <p className="mt-1 text-xs text-sky-700">تحصيل فوري أو عند المغادرة</p>
        </div>
        <div className="rounded-2xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50 to-indigo-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-800">النزلاء المقيمون الآن</p>
          <p className="mt-1 text-2xl font-bold text-indigo-950">{inHouseGuests.length}</p>
          <p className="mt-1 text-xs text-indigo-700">متاحين لإضافة الخدمات لحسابهم</p>
        </div>
      </div>

      {/* Interactive Wahj-style POS Workstation */}
      <div className="mb-8">
        <PosOrderForm
          products={products}
          inHouseGuests={inHouseGuests}
          currentStaff={user.name}
          singleAction={createServiceOrderAction}
          batchAction={createBatchServiceOrdersAction}
          createProductAction={createProductAction}
        />
      </div>

      {/* Orders Log & History */}
      <div className="space-y-4">
        <Card title={`سجل طلبات وخدمات اليوم (${orders.length})`}>
            {/* Quick Filters */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link
                  href="/dashboard/pos"
                  className={`rounded-lg px-2.5 py-1 font-medium ${!sp.service && !sp.all ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  اليوم ({today})
                </Link>
                <Link
                  href="/dashboard/pos?all=1"
                  className={`rounded-lg px-2.5 py-1 font-medium ${sp.all === '1' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  كل الأيام
                </Link>
                <Link
                  href={`/dashboard/pos?service=breakfast${sp.all ? '&all=1' : ''}`}
                  className={`rounded-lg px-2 py-1 ${sp.service === 'breakfast' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  🍳 فطور
                </Link>
                <Link
                  href={`/dashboard/pos?service=laundry${sp.all ? '&all=1' : ''}`}
                  className={`rounded-lg px-2 py-1 ${sp.service === 'laundry' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  🧺 غسيل
                </Link>
                <Link
                  href={`/dashboard/pos?service=towel${sp.all ? '&all=1' : ''}`}
                  className={`rounded-lg px-2 py-1 ${sp.service === 'towel' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  🛁 فوط
                </Link>
                <Link
                  href={`/dashboard/pos?service=pool${sp.all ? '&all=1' : ''}`}
                  className={`rounded-lg px-2 py-1 ${sp.service === 'pool' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  🏊 مسبح
                </Link>
                <Link
                  href={`/dashboard/pos?service=tour${sp.all ? '&all=1' : ''}`}
                  className={`rounded-lg px-2 py-1 ${sp.service === 'tour' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  🏛️ رحلات
                </Link>
                <Link
                  href={`/dashboard/pos?service=taxi${sp.all ? '&all=1' : ''}`}
                  className={`rounded-lg px-2 py-1 ${sp.service === 'taxi' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  🚕 تاكسي
                </Link>
              </div>

              {/* Search Form */}
              <form method="GET" className="flex items-center gap-1">
                {sp.all && <input type="hidden" name="all" value="1" />}
                {sp.service && <input type="hidden" name="service" value={sp.service} />}
                <input
                  type="text"
                  name="q"
                  defaultValue={sp.q || ''}
                  placeholder="بحث باسم النزيل أو الغرفة..."
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                />
                <button type="submit" className="rounded-lg bg-slate-800 px-2.5 py-1 text-white hover:bg-slate-900">
                  بحث
                </button>
              </form>
            </div>

            {/* Orders Table */}
            {orders.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">لا توجد طلبات مسجلة تطابق البحث.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="py-2.5 px-2">رقم الطلب</th>
                      <th className="py-2.5 px-2">النزيل / الغرفة</th>
                      <th className="py-2.5 px-2">الخدمة / الصنف</th>
                      <th className="py-2.5 px-2">المبلغ</th>
                      <th className="py-2.5 px-2">الدفع</th>
                      <th className="py-2.5 px-2">الموظف</th>
                      <th className="py-2.5 px-2">ملاحظة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50/60">
                        <td className="py-2.5 px-2 font-mono text-xs font-medium text-slate-500">
                          {o.order_number}
                          <span className="block text-[10px] text-slate-400">{o.order_date}</span>
                        </td>
                        <td className="py-2.5 px-2 font-medium text-slate-900">
                          {o.reservation_id ? (
                            <Link href={`/dashboard/reservations/${o.reservation_id}`} className="text-amber-700 underline hover:text-amber-900">
                              {o.guest_name}
                            </Link>
                          ) : (
                            o.guest_name
                          )}
                          {o.room_number && (
                            <span className="block text-xs font-normal text-slate-500">غرفة: {o.room_number}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          <span className="inline-flex items-center gap-1 font-medium capitalize text-slate-800">
                            {o.service_type === 'breakfast' && '🍳 فطور'}
                            {o.service_type === 'laundry' && '🧺 غسيل'}
                            {o.service_type === 'towel' && '🛁 فوطة'}
                            {o.service_type === 'pool' && '🏊 مسبح'}
                            {o.service_type === 'water' && '💧 مياه'}
                            {o.service_type === 'drinks' && '🥤 مشروبات'}
                            {o.service_type === 'taxi' && '🚕 تاكسي'}
                            {o.service_type === 'tour' && '🏛️ رحلة'}
                            {o.service_type === 'extra_bed' && '🛏️ سرير إضافي'}
                            {o.service_type === 'meal' && '🍱 وجبة'}
                            {o.service_type === 'other' && '📌 أخرى'}
                          </span>
                          {o.product_name && (
                            <span className="block text-xs text-slate-500">{o.product_name} × {o.quantity}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 font-semibold text-slate-900">
                          {fmt(o.amount_cents, o.currency)}
                        </td>
                        <td className="py-2.5 px-2 text-xs">
                          {o.payment_status === 'paid' && (
                            <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                              ✔ مدفوع ({o.payment_method})
                            </span>
                          )}
                          {o.payment_status === 'charged_to_room' && (
                            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                              📋 على الغرفة
                            </span>
                          )}
                          {o.payment_status === 'unpaid' && (
                            <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                              ✕ غير مدفوع
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-xs text-slate-600">
                          {o.staff_name || '—'}
                        </td>
                        <td className="py-2.5 px-2 text-xs text-slate-500 max-w-[12rem] truncate" title={o.comment || ''}>
                          {o.comment || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
    </>
  );
}
