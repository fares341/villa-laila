import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Card, Flash, fmt, dt, Btn, BtnGhost } from '@/components/dash';
import { getProducts, getTowelLoans } from '@/services/frontdesk';
import {
  createProductAction,
  updateProductAction,
  deleteProductAction,
  adjustStockAction,
  auditStockAction,
  createTowelLoanAction,
  returnTowelAction,
} from '../frontdesk-actions';
import { InventoryView } from './inventory-client';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser('inventory.manage');
  const sp = await searchParams;

  // 1. Fetch products & inventory
  const products = await getProducts();

  // 2. Fetch towel loans
  const towelLoans = await getTowelLoans();

  // 3. Fetch in-house checked-in guests for towel lending
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

  // 4. Fetch recent inventory movements
  const movements = await q<any>(`
    SELECT im.*, p.name as product_name, p.category, u.name as user_name
    FROM inventory_movements im
    JOIN products p ON p.id = im.product_id
    LEFT JOIN users u ON u.id = im.created_by
    ORDER BY im.created_at DESC
    LIMIT 60
  `);

  // Compute stats
  const totalItemsCount = products.reduce((acc, p) => acc + (p.track_stock ? p.stock_quantity : 0), 0);
  const lowStockProducts = products.filter(p => p.track_stock && p.stock_quantity <= p.low_stock_threshold);
  const activeTowelLoans = towelLoans.filter(t => !t.returned);
  const totalInventoryValueEgp = products.reduce((acc, p) => acc + (p.track_stock ? (p.stock_quantity * p.price_cents) : 0), 0);

  return (
    <>
      <PageHeader
        title="إدارة المخزن والجرد والفوط (Hostel Inventory & Stock)"
        sub="متابعة كميات بضاعة الماركت، جرد الفوط والمفروشات، تسليم وتأمين الفوط، وتسوية عجز وزيادة المخزن."
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
        <div className="rounded-2xl border border-blue-200/70 bg-gradient-to-br from-blue-50 to-blue-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-800">إجمالي قطع البضاعة</p>
          <p className="mt-1 text-2xl font-bold text-blue-950">{totalItemsCount} قطعة</p>
          <p className="mt-1 text-xs text-blue-700">{products.length} أصناف مسجلة</p>
        </div>
        <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-emerald-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">قيمة بضاعة المخزن (سعر البيع)</p>
          <p className="mt-1 text-2xl font-bold text-emerald-950">{fmt(totalInventoryValueEgp, 'EGP')}</p>
          <p className="mt-1 text-xs text-emerald-700">مياه، مشروبات، فوط، سناكس</p>
        </div>
        <div className="rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-amber-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-800">فوط مع النزلاء حالياً</p>
          <p className="mt-1 text-2xl font-bold text-amber-950">{activeTowelLoans.reduce((s, t) => s + t.quantity, 0)} فوطة</p>
          <p className="mt-1 text-xs text-amber-700">لدى {activeTowelLoans.length} نزيل بانتظار الاسترجاع</p>
        </div>
        <div className="rounded-2xl border border-rose-200/70 bg-gradient-to-br from-rose-50 to-rose-100/40 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-800">تنبيهات نقص الكمية</p>
          <p className="mt-1 text-2xl font-bold text-rose-950">{lowStockProducts.length} أصناف</p>
          <p className="mt-1 text-xs text-rose-700">تحت الحد الأدنى وتتطلب شراء</p>
        </div>
      </div>

      {/* Main Tabbed Interactive Inventory Interface */}
      <InventoryView
        products={products}
        towelLoans={towelLoans}
        inHouseGuests={inHouseGuests}
        movements={movements}
        createProductAction={createProductAction}
        updateProductAction={updateProductAction}
        deleteProductAction={deleteProductAction}
        adjustStockAction={adjustStockAction}
        auditStockAction={auditStockAction}
        createTowelLoanAction={createTowelLoanAction}
        returnTowelAction={returnTowelAction}
      />
    </>
  );
}
