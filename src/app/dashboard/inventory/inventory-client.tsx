'use client';

import { useState } from 'react';
import type { ProductItem } from '@/services/frontdesk';
import { Card, Input, Lbl, Btn, BtnGhost, fmt, dt } from '@/components/dash-ui';

interface TowelLoanItem {
  id: string;
  guest_name: string;
  room_number?: string;
  quantity: number;
  towel_type: string;
  deposit_cents: number;
  deposit_currency: string;
  deposit_status: string;
  returned: boolean;
  returned_at?: string;
  loaned_at: string;
  loaner_name?: string;
  notes?: string;
}

interface InHouseGuest {
  id: string;
  reference: string;
  full_name: string;
  room_label: string;
}

function getProductIcon(category: string, name: string) {
  const n = name.toLowerCase();
  if (n.includes('ماء') || n.includes('مياه') || n.includes('water')) return '💧';
  if (n.includes('عصير') || n.includes('juice')) return '🧃';
  if (n.includes('كولا') || n.includes('صودا') || n.includes('cola') || n.includes('drink')) return '🥤';
  if (n.includes('شيبسي') || n.includes('سناكس') || n.includes('chips') || n.includes('snack')) return '🍿';
  if (n.includes('فوط') || n.includes('towel')) return '🛁';
  if (n.includes('ملاية') || n.includes('بطانية') || n.includes('sheet') || n.includes('blanket')) return '🛏️';
  if (n.includes('فطار') || n.includes('breakfast') || category === 'meal_breakfast') return '🍳';
  if (n.includes('غسيل') || n.includes('laundry')) return '🧺';
  if (n.includes('مسبح') || n.includes('pool')) return '🏊';
  if (n.includes('تاكسي') || n.includes('مطار') || n.includes('taxi')) return '🚕';
  if (n.includes('أهرامات') || n.includes('رحلة') || n.includes('tour') || category === 'activity_tour') return '🏛️';
  if (category === 'beverage') return '🥤';
  if (category === 'snack') return '🍪';
  if (category === 'linen_towel') return '🧺';
  return '📦';
}

export function InventoryView({
  products,
  towelLoans,
  inHouseGuests,
  movements,
  createProductAction,
  updateProductAction,
  deleteProductAction,
  adjustStockAction,
  auditStockAction,
  createTowelLoanAction,
  returnTowelAction,
}: {
  products: ProductItem[];
  towelLoans: TowelLoanItem[];
  inHouseGuests: InHouseGuest[];
  movements: any[];
  createProductAction: (formData: FormData) => Promise<void>;
  updateProductAction: (formData: FormData) => Promise<void>;
  deleteProductAction: (formData: FormData) => Promise<void>;
  adjustStockAction: (formData: FormData) => Promise<void>;
  auditStockAction: (formData: FormData) => Promise<void>;
  createTowelLoanAction: (formData: FormData) => Promise<void>;
  returnTowelAction: (formData: FormData) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'catalog' | 'audit' | 'towels' | 'movements'>('catalog');
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'market' | 'towels' | 'services' | 'tours'>('market');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  const [selectedProductForAdjust, setSelectedProductForAdjust] = useState<ProductItem | null>(null);
  const [selectedProductForEdit, setSelectedProductForEdit] = useState<ProductItem | null>(null);
  const [showNewProductModal, setShowNewProductModal] = useState<boolean>(false);
  const [showNewTowelModal, setShowNewTowelModal] = useState<boolean>(false);

  // Audit state: Map of productId -> physicalCount
  const [auditCounts, setAuditCounts] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    products.forEach((p) => {
      if (p.track_stock) init[p.id] = p.stock_quantity;
    });
    return init;
  });
  const [auditNote, setAuditNote] = useState<string>('جرد دوري للمخزن');

  const handleAuditCountChange = (productId: string, val: number) => {
    setAuditCounts((prev) => ({ ...prev, [productId]: Math.max(0, val) }));
  };

  const auditDataPayload = products
    .filter((p) => p.track_stock)
    .map((p) => ({
      productId: p.id,
      physicalCount: auditCounts[p.id] !== undefined ? auditCounts[p.id] : p.stock_quantity,
    }));

  const activeLoans = towelLoans.filter((t) => !t.returned);
  const returnedLoans = towelLoans.filter((t) => t.returned);

  // Catalog filtering
  const filteredProducts = products.filter((p) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.category.toLowerCase().includes(q)) return false;
    }
    if (catalogFilter === 'market') {
      return p.category === 'beverage' || p.category === 'snack';
    }
    if (catalogFilter === 'towels') {
      return p.category === 'linen_towel';
    }
    if (catalogFilter === 'services') {
      return p.category === 'meal_breakfast' || p.category === 'laundry' || (p.category === 'other' && !p.track_stock);
    }
    if (catalogFilter === 'tours') {
      return p.category === 'activity_tour' || p.category === 'transport';
    }
    return true;
  });

  // Calculate market stats
  const marketItems = products.filter(p => p.category === 'beverage' || p.category === 'snack');
  const marketTotalCost = marketItems.reduce((acc, p) => acc + (p.stock_quantity * p.cost_cents), 0);
  const marketTotalSell = marketItems.reduce((acc, p) => acc + (p.stock_quantity * p.price_cents), 0);
  const marketExpectedProfit = marketTotalSell - marketTotalCost;

  return (
    <div className="space-y-6">
      {/* Top Main Tab Navigation */}
      <div className="flex border-b border-slate-200 text-sm font-medium">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`flex items-center gap-2 border-b-2 py-3 px-4 font-bold transition-colors ${
            activeTab === 'catalog'
              ? 'border-amber-700 text-amber-900 bg-white rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>🏷️ كتالوج الأسعار والتوريد والمخزون</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 font-mono">
            {products.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 border-b-2 py-3 px-4 font-bold transition-colors ${
            activeTab === 'audit'
              ? 'border-amber-700 text-amber-900 bg-white rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>📋 كشف الجرد الفعلي الفوري</span>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">تسوية عجز/زيادة</span>
        </button>

        <button
          onClick={() => setActiveTab('towels')}
          className={`flex items-center gap-2 border-b-2 py-3 px-4 font-bold transition-colors ${
            activeTab === 'towels'
              ? 'border-amber-700 text-amber-900 bg-white rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>🛁 تتبع الفوط والتأمين</span>
          {activeLoans.length > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs text-white">
              {activeLoans.length} مع النزلاء
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('movements')}
          className={`flex items-center gap-2 border-b-2 py-3 px-4 font-bold transition-colors ${
            activeTab === 'movements'
              ? 'border-amber-700 text-amber-900 bg-white rounded-t-xl'
              : 'border-transparent text-slate-600 hover:text-slate-900'
          }`}
        >
          <span>📜 سجل الحركات وتاريخ الجرد</span>
        </button>
      </div>

      {/* ───────── TAB 1: CATALOG & PRICE / COST MANAGEMENT ───────── */}
      {activeTab === 'catalog' && (
        <div className="space-y-4">
          {/* Market Summary Strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 p-3">
              <span className="text-xs text-amber-800 font-medium">أصناف الماركت المعروضة</span>
              <p className="mt-1 text-xl font-bold text-amber-950">{marketItems.length} صنف</p>
            </div>
            <div className="rounded-xl border border-blue-200/80 bg-blue-50/50 p-3">
              <span className="text-xs text-blue-800 font-medium">إجمالي التكلفة (سعر التوريد)</span>
              <p className="mt-1 text-xl font-bold text-blue-950 font-mono">{fmt(marketTotalCost, 'EGP')}</p>
            </div>
            <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3">
              <span className="text-xs text-emerald-800 font-medium">إجمالي القيمة بسعر البيع</span>
              <p className="mt-1 text-xl font-bold text-emerald-950 font-mono">{fmt(marketTotalSell, 'EGP')}</p>
            </div>
            <div className="rounded-xl border border-purple-200/80 bg-purple-50/50 p-3">
              <span className="text-xs text-purple-800 font-medium">الربح المتوقع بالكامل</span>
              <p className="mt-1 text-xl font-bold text-purple-950 font-mono">{fmt(marketExpectedProfit, 'EGP')}</p>
            </div>
          </div>

          {/* Sub-Filters and Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 border border-slate-200 shadow-sm">
            {/* Category Pills */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
              <button
                type="button"
                onClick={() => setCatalogFilter('market')}
                className={`rounded-xl px-3 py-2 transition-all ${
                  catalogFilter === 'market'
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                🛍️ منتجات الماركت والكانتين ({products.filter(p => p.category === 'beverage' || p.category === 'snack').length})
              </button>
              <button
                type="button"
                onClick={() => setCatalogFilter('towels')}
                className={`rounded-xl px-3 py-2 transition-all ${
                  catalogFilter === 'towels'
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                🏨 الفوط والبياضات ({products.filter(p => p.category === 'linen_towel').length})
              </button>
              <button
                type="button"
                onClick={() => setCatalogFilter('services')}
                className={`rounded-xl px-3 py-2 transition-all ${
                  catalogFilter === 'services'
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                🛎️ خدمات الفندق ({products.filter(p => p.category === 'meal_breakfast' || p.category === 'laundry').length})
              </button>
              <button
                type="button"
                onClick={() => setCatalogFilter('tours')}
                className={`rounded-xl px-3 py-2 transition-all ${
                  catalogFilter === 'tours'
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                🚕 الرحلات والتوصيل ({products.filter(p => p.category === 'activity_tour' || p.category === 'transport').length})
              </button>
              <button
                type="button"
                onClick={() => setCatalogFilter('all')}
                className={`rounded-xl px-3 py-2 transition-all ${
                  catalogFilter === 'all'
                    ? 'bg-amber-800 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                🌟 عرض الكل ({products.length})
              </button>
            </div>

            {/* Search and Add Button */}
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="text"
                placeholder="🔍 بحث باسم الصنف أو الفئة..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full sm:w-56 rounded-xl border border-slate-200 px-3 py-1.5 text-xs text-slate-800 focus:border-amber-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowNewProductModal(true)}
                className="whitespace-nowrap rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-800 transition-colors"
              >
                + إضافة صنف جديد
              </button>
            </div>
          </div>

          {/* Unified Product Catalog Table */}
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-600">
                  <tr>
                    <th className="py-3 px-3">الصنف والفئة</th>
                    <th className="py-3 px-3 text-emerald-800">سعر التوريد (التكلفة)</th>
                    <th className="py-3 px-3 text-amber-900">سعر البيع للنزيل</th>
                    <th className="py-3 px-3 text-purple-900">هامش الربح</th>
                    <th className="py-3 px-3">الكمية بالمخزن</th>
                    <th className="py-3 px-3">حد التنبيه</th>
                    <th className="py-3 px-3">خضوع للجرد</th>
                    <th className="py-3 px-3 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.map((p) => {
                    const isLow = p.track_stock && p.stock_quantity <= p.low_stock_threshold;
                    const marginCents = p.price_cents - p.cost_cents;
                    const marginPct = p.price_cents > 0 ? ((marginCents / p.price_cents) * 100).toFixed(0) : '0';
                    const icon = getProductIcon(p.category, p.name);

                    return (
                      <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                        {/* Name & Category */}
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-xl border border-amber-200/50">
                              {icon}
                            </span>
                            <div>
                              <p className="font-bold text-slate-900">{p.name}</p>
                              <span className="inline-block text-[11px] font-medium text-slate-500">
                                {p.category === 'beverage' && '🥤 مشروبات ومياه (ماركت)'}
                                {p.category === 'snack' && '🍿 مقرمشات وسناكس (ماركت)'}
                                {p.category === 'linen_towel' && '🛁 فوط ومفروشات (فندق)'}
                                {p.category === 'laundry' && '🧺 غسيل ملابس (خدمة)'}
                                {p.category === 'meal_breakfast' && '🍳 إفطار ووجبات (خدمة)'}
                                {p.category === 'activity_tour' && '🏛️ رحلات وجولات'}
                                {p.category === 'transport' && '🚕 تاكسي وانتقالات'}
                                {p.category === 'other' && '📌 صنف عام'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Cost Price */}
                        <td className="py-3 px-3 font-mono font-bold text-emerald-800">
                          {p.cost_cents > 0 ? (
                            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 border border-emerald-200/60">
                              {fmt(p.cost_cents, p.currency)}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal text-xs">غير محدد (0.00)</span>
                          )}
                        </td>

                        {/* Selling Price */}
                        <td className="py-3 px-3 font-mono font-bold text-amber-950">
                          <span className="rounded-lg bg-amber-50 px-2.5 py-1 border border-amber-200/70">
                            {fmt(p.price_cents, p.currency)}
                          </span>
                        </td>

                        {/* Margin */}
                        <td className="py-3 px-3 text-xs">
                          {p.cost_cents > 0 ? (
                            <div className="space-y-0.5">
                              <span className="font-mono font-bold text-purple-900">
                                +{fmt(marginCents, p.currency)}
                              </span>
                              <span className="mr-1.5 inline-block rounded-md bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-800">
                                {marginPct}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Stock */}
                        <td className="py-3 px-3 font-mono font-bold">
                          {p.track_stock ? (
                            <div className="flex items-center gap-1.5">
                              <span className={`text-base ${isLow ? 'text-rose-700' : 'text-slate-900'}`}>
                                {p.stock_quantity}
                              </span>
                              {isLow && (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 animate-pulse">
                                  ⚠️ ناقص
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs font-normal text-slate-400">خدمة (غير محدود)</span>
                          )}
                        </td>

                        {/* Threshold */}
                        <td className="py-3 px-3 text-xs text-slate-600 font-mono">
                          {p.track_stock ? `${p.low_stock_threshold} قطع` : '—'}
                        </td>

                        {/* Track Stock status */}
                        <td className="py-3 px-3 text-xs">
                          {p.track_stock ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <span>✔</span> يخصم عند البيع
                            </span>
                          ) : (
                            <span className="text-slate-400">خدمة مجردة</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            {/* Edit button */}
                            <button
                              type="button"
                              onClick={() => setSelectedProductForEdit(p)}
                              className="rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-800 transition-colors"
                              title="تعديل الأسعار والكمية"
                            >
                              ✏️ تعديل
                            </button>

                            {/* Adjust stock quick button */}
                            {p.track_stock && (
                              <button
                                type="button"
                                onClick={() => setSelectedProductForAdjust(p)}
                                className="rounded-lg bg-amber-50 hover:bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900 border border-amber-200 transition-colors"
                                title="توريد أو شراء كمية جديدة"
                              >
                                + توريد
                              </button>
                            )}

                            {/* Delete button */}
                            <form action={deleteProductAction} onSubmit={(e) => {
                              if (!confirm(`هل أنت متأكد من حذف الصنف "${p.name}"؟`)) e.preventDefault();
                            }}>
                              <input type="hidden" name="id" value={p.id} />
                              <button
                                type="submit"
                                className="rounded-lg bg-rose-50 hover:bg-rose-100 px-2 py-1 text-xs text-rose-700 border border-rose-200 transition-colors"
                                title="حذف الصنف"
                              >
                                ✕
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredProducts.length === 0 && (
                <div className="py-12 text-center text-sm text-slate-500">
                  لا توجد أصناف مطابقة للتصفية الحالية.
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* ───────── TAB 2: PHYSICAL INVENTORY AUDIT WORKSHEET ───────── */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-sm text-blue-900">
            <h3 className="font-bold flex items-center gap-2">
              <span>📋 كشف الجرد الفعلي للمخزن (Physical Count Worksheet)</span>
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-blue-800">
              قم بعدّ الكميات الموجودة فعلياً على الرفوف وأدخل الأرقام في خانة &quot;الكمية الفعلية&quot;. سيحسب النظام الفارق فورياً ويظهر العجز باللون الأحمر والزيادة بالأخضر. عند الضغط على زر &quot;اعتماد وحفظ الجرد&quot;، سيتم تحديث رصيد المخزن وتسجيل حركة التسوية آلياً.
            </p>
          </div>

          <form action={auditStockAction} className="space-y-4">
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3">اسم الصنف</th>
                      <th className="py-2.5 px-3">القسم</th>
                      <th className="py-2.5 px-3 font-mono">الكمية المسجلة بالسيستم</th>
                      <th className="py-2.5 px-3 font-mono text-blue-900">الكمية الفعلية على الرف</th>
                      <th className="py-2.5 px-3">الفارق (عجز / زيادة)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {products.filter((p) => p.track_stock).map((p) => {
                      const actualCount = auditCounts[p.id] !== undefined ? auditCounts[p.id] : p.stock_quantity;
                      const diff = actualCount - p.stock_quantity;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/60">
                          <td className="py-3 px-3 font-semibold text-slate-900">{p.name}</td>
                          <td className="py-3 px-3 text-xs text-slate-500">{p.category}</td>
                          <td className="py-3 px-3 font-mono font-bold text-slate-700">{p.stock_quantity}</td>
                          <td className="py-3 px-3">
                            <input
                              type="number"
                              min="0"
                              value={actualCount}
                              onChange={(e) => handleAuditCountChange(p.id, parseInt(e.target.value || '0', 10))}
                              className="w-28 rounded-lg border border-slate-300 px-3 py-1 font-mono font-bold text-blue-900 focus:border-blue-600 focus:outline-none"
                            />
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-sm">
                            {diff === 0 && <span className="text-slate-400">مطابق (0)</span>}
                            {diff > 0 && <span className="text-emerald-600 font-bold">+{diff} (زيادة)</span>}
                            {diff < 0 && <span className="text-rose-600 font-bold">{diff} (عجز)</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Audit Note & Submit */}
              <div className="mt-6 border-t border-slate-200 pt-4 flex flex-wrap items-end justify-between gap-4">
                <div className="max-w-md flex-1">
                  <Lbl htmlFor="audit_note">ملاحظة الجرد والتسوية</Lbl>
                  <input
                    id="audit_note"
                    type="text"
                    name="note"
                    value={auditNote}
                    onChange={(e) => setAuditNote(e.target.value)}
                    className={Input}
                    required
                  />
                </div>
                <input type="hidden" name="auditData" value={JSON.stringify(auditDataPayload)} />
                <button
                  type="submit"
                  className="rounded-xl bg-blue-700 px-6 py-2.5 text-base font-bold text-white shadow-md hover:bg-blue-800 active:scale-95"
                >
                  ✔ اعتماد نتائج الجرد وتحديث المخزن
                </button>
              </div>
            </Card>
          </form>
        </div>
      )}

      {/* ───────── TAB 3: TOWEL & LINEN LOANS ───────── */}
      {activeTab === 'towels' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-800">تتبع استلام واسترجاع الفوط والتأمين</h2>
              <p className="text-xs text-slate-500">معرفة من استلم فوطة، هل رجعها، وهل دفع التأمين أم لا لضبط الجرد.</p>
            </div>
            <button
              onClick={() => setShowNewTowelModal(true)}
              className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-800"
            >
              + تسليم فوطة لنزيل جديد
            </button>
          </div>

          {/* Active Loans Table */}
          <Card title={`فوط مع النزلاء حالياً لم تُرجع (${activeLoans.length})`}>
            {activeLoans.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">لا توجد فوط معارة خارج المخزن حالياً. كل الفوط مستلمة.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <tr>
                      <th className="py-2 px-3">النزيل / الغرفة</th>
                      <th className="py-2 px-3">العدد والنوع</th>
                      <th className="py-2 px-3">تاريخ التسليم</th>
                      <th className="py-2 px-3">حالة التأمين</th>
                      <th className="py-2 px-3">سلمها الموظف</th>
                      <th className="py-2 px-3">ملاحظات</th>
                      <th className="py-2 px-3">إجراء استرجاع الفوطة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeLoans.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/60">
                        <td className="py-3 px-3 font-semibold text-slate-900">
                          {t.guest_name}
                          {t.room_number && (
                            <span className="block text-xs font-normal text-slate-500">غرفة: {t.room_number}</span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-bold text-amber-900">
                            {t.quantity} {t.towel_type === 'bath_towel' ? 'فوطة استحمام' : 'فوطة مسبح'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-500">{dt(t.loaned_at)}</td>
                        <td className="py-3 px-3 text-xs">
                          {t.deposit_status === 'paid' && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                              تم دفع تأمين ({fmt(t.deposit_cents, t.deposit_currency)})
                            </span>
                          )}
                          {t.deposit_status === 'none' && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">بدون تأمين</span>
                          )}
                          {t.deposit_status === 'forfeited' && (
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-800">تأمين مصادر</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-600">{t.loaner_name || '—'}</td>
                        <td className="py-3 px-3 text-xs text-slate-500">{t.notes || '—'}</td>
                        <td className="py-3 px-3 text-xs">
                          <form action={returnTowelAction} className="flex items-center gap-2">
                            <input type="hidden" name="loanId" value={t.id} />
                            {t.deposit_status === 'paid' && (
                              <input type="hidden" name="depositAction" value="refund" />
                            )}
                            <button
                              type="submit"
                              className="rounded-lg bg-emerald-700 px-3 py-1 font-semibold text-white shadow-sm hover:bg-emerald-800"
                            >
                              ✔ تم الاستلام للمغسلة/المخزن
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Returned Towels History */}
          <details className="rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">
              عرض سجل الفوط المسترجعة سابقاً ({returnedLoans.length})
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-right text-xs text-slate-600">
                <thead className="border-b border-slate-100 bg-slate-50">
                  <tr>
                    <th className="py-1.5 px-2">النزيل</th>
                    <th className="py-1.5 px-2">النوع والعدد</th>
                    <th className="py-1.5 px-2">تاريخ التسليم</th>
                    <th className="py-1.5 px-2">تاريخ الاسترجاع</th>
                    <th className="py-1.5 px-2">حالة التأمين</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returnedLoans.slice(0, 30).map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 px-2 font-medium text-slate-800">{t.guest_name} ({t.room_number || '—'})</td>
                      <td className="py-2 px-2">{t.quantity} {t.towel_type}</td>
                      <td className="py-2 px-2">{dt(t.loaned_at)}</td>
                      <td className="py-2 px-2 text-emerald-700">{dt(t.returned_at || null)}</td>
                      <td className="py-2 px-2">{t.deposit_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      {/* ───────── TAB 4: MOVEMENTS HISTORY ───────── */}
      {activeTab === 'movements' && (
        <Card title={`سجل حركات المخزن والجرد (${movements.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="py-2 px-3">التاريخ والوقت</th>
                  <th className="py-2 px-3">الصنف</th>
                  <th className="py-2 px-3">نوع الحركة</th>
                  <th className="py-2 px-3">الكمية</th>
                  <th className="py-2 px-3">الرصيد السابق</th>
                  <th className="py-2 px-3">الرصيد الجديد</th>
                  <th className="py-2 px-3">الموظف</th>
                  <th className="py-2 px-3">الملاحظة / المرجع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movements.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/50">
                    <td className="py-2.5 px-3 text-xs text-slate-500">{dt(m.created_at)}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">{m.product_name}</td>
                    <td className="py-2.5 px-3 text-xs font-bold">
                      {m.movement_type === 'purchase' && <span className="text-emerald-700">شراء بضاعة</span>}
                      {m.movement_type === 'sale' && <span className="text-blue-700">بيع لنزيل</span>}
                      {m.movement_type === 'adjustment_audit' && <span className="text-purple-700">تسوية جرد</span>}
                      {m.movement_type === 'damage' && <span className="text-rose-700">تالف / هالك</span>}
                      {m.movement_type === 'loss' && <span className="text-red-700">مفقود</span>}
                      {m.movement_type === 'return' && <span className="text-teal-700">مرتجع</span>}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-bold">
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 font-mono">{m.previous_stock}</td>
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-900">{m.new_stock}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-600">{m.user_name || '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-slate-500">{m.note || m.reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ───────── MODAL: EDIT PRODUCT & PRICES ───────── */}
      {selectedProductForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span>✏️ تعديل بيانات وسعر الصنف:</span>
                <span className="text-amber-800">{selectedProductForEdit.name}</span>
              </h3>
              <button
                type="button"
                onClick={() => setSelectedProductForEdit(null)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <form
              action={updateProductAction}
              onSubmit={() => setSelectedProductForEdit(null)}
              className="space-y-4 text-sm"
            >
              <input type="hidden" name="id" value={selectedProductForEdit.id} />

              <div>
                <Lbl htmlFor="edit_p_name">اسم الصنف</Lbl>
                <input
                  id="edit_p_name"
                  type="text"
                  name="name"
                  defaultValue={selectedProductForEdit.name}
                  className={Input}
                  required
                />
              </div>

              <div>
                <Lbl htmlFor="edit_p_cat">القسم / التصنيف</Lbl>
                <select
                  id="edit_p_cat"
                  name="category"
                  defaultValue={selectedProductForEdit.category}
                  className={Input}
                >
                  <option value="beverage">🥤 مياه ومشروبات (ماركت)</option>
                  <option value="snack">🍿 سناكس وأغذية (ماركت)</option>
                  <option value="linen_towel">🛁 فوط ومفروشات (فندق)</option>
                  <option value="laundry">🧺 غسيل ملابس (خدمة)</option>
                  <option value="meal_breakfast">🍳 إفطار ووجبات (خدمة)</option>
                  <option value="activity_tour">🏛️ رحلات وجولات</option>
                  <option value="transport">🚕 تاكسي وانتقالات</option>
                  <option value="other">📌 أخرى</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-emerald-50/70 p-3 border border-emerald-200/60">
                  <Lbl htmlFor="edit_p_cost">سعر التوريد / التكلفة عليك (جنيه)</Lbl>
                  <input
                    id="edit_p_cost"
                    type="number"
                    step="0.5"
                    name="cost"
                    defaultValue={selectedProductForEdit.cost_cents / 100}
                    className={Input}
                    required
                  />
                  <span className="text-[11px] text-emerald-800">التكلفة من تاجر الجملة أو المورد</span>
                </div>

                <div className="rounded-xl bg-amber-50/70 p-3 border border-amber-200/60">
                  <Lbl htmlFor="edit_p_price">سعر البيع للنزيل (جنيه)</Lbl>
                  <input
                    id="edit_p_price"
                    type="number"
                    step="0.5"
                    name="price"
                    defaultValue={selectedProductForEdit.price_cents / 100}
                    className={Input}
                    required
                  />
                  <span className="text-[11px] text-amber-800">السعر المعروض للنزيل في الفاتورة</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Lbl htmlFor="edit_p_stock">الكمية الحالية في المخزن</Lbl>
                  <input
                    id="edit_p_stock"
                    type="number"
                    name="stock"
                    defaultValue={selectedProductForEdit.stock_quantity}
                    className={Input}
                    disabled={!selectedProductForEdit.track_stock}
                  />
                  {!selectedProductForEdit.track_stock && (
                    <span className="text-[11px] text-slate-400">غير قابل للتعديل (خدمة غير محدودة)</span>
                  )}
                </div>

                <div>
                  <Lbl htmlFor="edit_p_low">حد التنبيه عند النقص</Lbl>
                  <input
                    id="edit_p_low"
                    type="number"
                    name="lowStock"
                    defaultValue={selectedProductForEdit.low_stock_threshold}
                    className={Input}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="edit_p_track"
                  name="trackStock"
                  defaultChecked={selectedProductForEdit.track_stock}
                  className="h-4 w-4 rounded border-slate-300 text-amber-700"
                />
                <Lbl htmlFor="edit_p_track">تفعيل خضوع الصنف للجرد والخصم التلقائي عند البيع</Lbl>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setSelectedProductForEdit(null)}
                  className={BtnGhost}
                >
                  إلغاء
                </button>
                <button type="submit" className={Btn}>
                  ✔ حفظ التعديلات في النظام
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────── MODAL: ADJUST STOCK / PURCHASE ───────── */}
      {selectedProductForAdjust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">
              تعديل كمية / شراء بضاعة: {selectedProductForAdjust.name}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              الرصيد الحالي بالمخزن: <b className="text-slate-900">{selectedProductForAdjust.stock_quantity}</b> قطعة
            </p>

            <form action={adjustStockAction} onSubmit={() => setSelectedProductForAdjust(null)} className="mt-4 space-y-4">
              <input type="hidden" name="productId" value={selectedProductForAdjust.id} />

              <div>
                <Lbl>نوع الحركة</Lbl>
                <select name="type" className={Input} defaultValue="purchase">
                  <option value="purchase">توريد / شراء بضاعة جديدة (+)</option>
                  <option value="return">استرجاع للمخزن (+)</option>
                  <option value="damage">تالف / هالك (-)</option>
                  <option value="loss">مفقود / ضائع (-)</option>
                </select>
              </div>

              <div>
                <Lbl>الكمية المضافة أو المخصومة</Lbl>
                <input
                  type="number"
                  name="quantity"
                  defaultValue="10"
                  className={Input}
                  required
                />
                <p className="mt-1 text-[11px] text-slate-500">أدخل رقم موجب للشراء/التوريد، ورقم سالب للتالف أو النقص.</p>
              </div>

              <div>
                <Lbl>ملاحظة / اسم المورد أو السبب</Lbl>
                <input
                  type="text"
                  name="note"
                  placeholder="مثال: شراء كرتونة مياه 20 قطعة من المترو"
                  className={Input}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setSelectedProductForAdjust(null)}
                  className={BtnGhost}
                >
                  إلغاء
                </button>
                <button type="submit" className={Btn}>
                  حفظ الحركة في المخزن
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────── MODAL: NEW PRODUCT ───────── */}
      {showNewProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="text-lg font-bold text-slate-900">إضافة صنف جديد للمخزن / الماركت</h3>
              <button
                type="button"
                onClick={() => setShowNewProductModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <form action={createProductAction} onSubmit={() => setShowNewProductModal(false)} className="space-y-4 text-sm">
              <div>
                <Lbl htmlFor="new_p_name">اسم الصنف</Lbl>
                <input
                  id="new_p_name"
                  type="text"
                  name="name"
                  placeholder="مثال: مياه غازية كوكاكولا أو شوكولاتة كيت كات"
                  className={Input}
                  required
                />
              </div>

              <div>
                <Lbl htmlFor="new_p_cat">القسم / التصنيف</Lbl>
                <select id="new_p_cat" name="category" className={Input} defaultValue="beverage">
                  <option value="beverage">🥤 مياه ومشروبات (ماركت)</option>
                  <option value="snack">🍿 سناكس ومقرمشات (ماركت)</option>
                  <option value="linen_towel">🛁 فوط ومفروشات (فندق)</option>
                  <option value="laundry">🧺 غسيل ملابس (خدمة)</option>
                  <option value="meal_breakfast">🍳 إفطار ووجبات (خدمة)</option>
                  <option value="activity_tour">🏛️ رحلات وجولات</option>
                  <option value="transport">🚕 تاكسي وانتقالات</option>
                  <option value="other">📌 أخرى</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-emerald-50/70 p-3 border border-emerald-200/60">
                  <Lbl htmlFor="new_p_cost">سعر التوريد / التكلفة عليك (جنيه)</Lbl>
                  <input
                    id="new_p_cost"
                    type="number"
                    step="0.5"
                    name="cost"
                    defaultValue="20"
                    className={Input}
                    required
                  />
                  <span className="text-[11px] text-emerald-800">التكلفة من المورد</span>
                </div>

                <div className="rounded-xl bg-amber-50/70 p-3 border border-amber-200/60">
                  <Lbl htmlFor="new_p_price">سعر البيع للنزيل (جنيه)</Lbl>
                  <input
                    id="new_p_price"
                    type="number"
                    step="0.5"
                    name="price"
                    defaultValue="40"
                    className={Input}
                    required
                  />
                  <span className="text-[11px] text-amber-800">السعر المباع به</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Lbl htmlFor="new_p_stock">الكمية الابتدائية بالمخزن</Lbl>
                  <input
                    id="new_p_stock"
                    type="number"
                    name="initialStock"
                    defaultValue="24"
                    className={Input}
                  />
                </div>

                <div>
                  <Lbl htmlFor="new_p_low">حد التنبيه عند النقص</Lbl>
                  <input
                    id="new_p_low"
                    type="number"
                    name="lowStockThreshold"
                    defaultValue="5"
                    className={Input}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="new_p_track"
                  name="trackStock"
                  defaultChecked={true}
                  className="h-4 w-4 rounded border-slate-300 text-amber-700"
                />
                <Lbl htmlFor="new_p_track">تفعيل الجرد والخصم التلقائي عند البيع (نعم للبضاعة، لا للخدمات)</Lbl>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowNewProductModal(false)}
                  className={BtnGhost}
                >
                  إلغاء
                </button>
                <button type="submit" className={Btn}>
                  + إضافة الصنف للمخزن
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────── MODAL: LEND TOWEL ───────── */}
      {showNewTowelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">تسليم فوطة لنزيل مع تسجيل التأمين</h3>
            <form action={createTowelLoanAction} onSubmit={() => setShowNewTowelModal(false)} className="mt-4 space-y-3 text-sm">
              <div>
                <Lbl>النزيل المستلم (نزيل مقيم حالياً)</Lbl>
                <select name="reservationId" className={Input} required>
                  {inHouseGuests.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.full_name} ({g.room_label || 'غرفة مقيمة'})
                    </option>
                  ))}
                  <option value="">— زائر خارجي / بدون حجز —</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Lbl>نوع الفوطة</Lbl>
                  <select name="towelType" className={Input}>
                    <option value="bath_towel">🛁 فوطة استحمام كبيرة</option>
                    <option value="pool_towel">🏊 فوطة مسبح ملونة</option>
                  </select>
                </div>
                <div>
                  <Lbl>العدد</Lbl>
                  <input type="number" name="quantity" defaultValue="1" min="1" max="5" className={Input} required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Lbl>مبلغ التأمين (Deposit)</Lbl>
                  <input type="number" name="deposit" defaultValue="100" className={Input} />
                </div>
                <div>
                  <Lbl>حالة التأمين</Lbl>
                  <select name="depositStatus" className={Input}>
                    <option value="paid">تم استلام التأمين كاش</option>
                    <option value="none">بدون تأمين (معرفة شخصية)</option>
                  </select>
                </div>
              </div>

              <div>
                <Lbl>ملاحظة</Lbl>
                <input type="text" name="notes" placeholder="مثال: تسليم لمسبح النادي" className={Input} />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowNewTowelModal(false)}
                  className={BtnGhost}
                >
                  إلغاء
                </button>
                <button type="submit" className={Btn}>
                  تسجيل تسليم الفوطة
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
