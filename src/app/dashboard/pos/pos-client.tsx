'use client';

import { useState } from 'react';
import type { ProductItem } from '@/services/frontdesk';
import { Card, Input, Lbl, Btn, BtnGhost, fmt } from '@/components/dash-ui';

interface InHouseGuest {
  id: string;
  reference: string;
  full_name: string;
  rt_name: any;
  room_label: string;
}

interface CartItem {
  productId?: string;
  name: string;
  category: string;
  serviceType: string;
  unitPrice: number;
  quantity: number;
  currency: string;
  icon: string;
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

function getServiceType(category: string, name: string): string {
  const n = name.toLowerCase();
  if (n.includes('ماء') || n.includes('مياه') || n.includes('water')) return 'water';
  if (n.includes('كولا') || n.includes('عصير') || category === 'beverage') return 'drinks';
  if (category === 'meal_breakfast' || n.includes('فطار')) return 'breakfast';
  if (category === 'laundry' || n.includes('غسيل')) return 'laundry';
  if (category === 'linen_towel' || n.includes('فوط')) return 'towel';
  if (category === 'transport' || n.includes('تاكسي')) return 'taxi';
  if (category === 'activity_tour' || n.includes('رحلة')) return 'tour';
  if (n.includes('مسبح')) return 'pool';
  if (n.includes('سرير')) return 'extra_bed';
  if (n.includes('وجبة') || n.includes('غداء') || n.includes('عشاء')) return 'meal';
  return 'other';
}

export function PosOrderForm({
  products,
  inHouseGuests,
  currentStaff,
  singleAction,
  batchAction,
  createProductAction,
}: {
  products: ProductItem[];
  inHouseGuests: InHouseGuest[];
  currentStaff: string;
  singleAction: (formData: FormData) => Promise<void>;
  batchAction: (formData: FormData) => Promise<void>;
  createProductAction: (formData: FormData) => Promise<void>;
}) {
  const [tabFilter, setTabFilter] = useState<'all' | 'market' | 'services' | 'towels' | 'tours'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [guestMode, setGuestMode] = useState<'in_house' | 'walk_in'>('in_house');
  const [selectedResId, setSelectedResId] = useState<string>(inHouseGuests[0]?.id || '');
  const [walkInName, setWalkInName] = useState<string>('');
  const [walkInRoom, setWalkInRoom] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [comment, setComment] = useState<string>('');
  const [showAddProductModal, setShowAddProductModal] = useState<boolean>(false);

  // Filter products by active tab & search
  const filteredProducts = products.filter((p) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.category.toLowerCase().includes(q)) return false;
    }
    if (tabFilter === 'market') return p.category === 'beverage' || p.category === 'snack';
    if (tabFilter === 'services') return p.category === 'meal_breakfast' || p.category === 'laundry' || (p.category === 'other' && !p.track_stock);
    if (tabFilter === 'towels') return p.category === 'linen_towel';
    if (tabFilter === 'tours') return p.category === 'activity_tour' || p.category === 'transport';
    return true;
  });

  // Cart operations
  const addToCart = (product: ProductItem) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          category: product.category,
          serviceType: getServiceType(product.category, product.name),
          unitPrice: product.price_cents / 100,
          quantity: 1,
          currency: product.currency || 'EGP',
          icon: getProductIcon(product.category, product.name),
        },
      ];
    });
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item, i) => {
          if (i === index) {
            const newQty = item.quantity + delta;
            return newQty > 0 ? { ...item, quantity: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const clearCart = () => setCart([]);

  const cartTotal = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const selectedGuest = inHouseGuests.find((g) => g.id === selectedResId);

  // Conversion rates (reference only)
  const usdEquiv = (cartTotal / 48.5).toFixed(1);
  const eurEquiv = (cartTotal / 52.8).toFixed(1);

  return (
    <div className="space-y-4">
      {/* ───────── TOP BAR: QUICK TABS + SEARCH + NEW ITEM BUTTON ───────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 p-3 text-white shadow-md">
        {/* Category Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
          <button
            type="button"
            onClick={() => setTabFilter('all')}
            className={`rounded-xl px-3 py-2 transition-all ${
              tabFilter === 'all'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            🌟 الكل ({products.length})
          </button>
          <button
            type="button"
            onClick={() => setTabFilter('market')}
            className={`rounded-xl px-3 py-2 transition-all ${
              tabFilter === 'market'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            🛍️ الماركت والكانتين ({products.filter(p => p.category === 'beverage' || p.category === 'snack').length})
          </button>
          <button
            type="button"
            onClick={() => setTabFilter('services')}
            className={`rounded-xl px-3 py-2 transition-all ${
              tabFilter === 'services'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            🛎️ خدمات الفندق ({products.filter(p => p.category === 'meal_breakfast' || p.category === 'laundry').length})
          </button>
          <button
            type="button"
            onClick={() => setTabFilter('towels')}
            className={`rounded-xl px-3 py-2 transition-all ${
              tabFilter === 'towels'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            🧺 الفوط والبياضات ({products.filter(p => p.category === 'linen_towel').length})
          </button>
          <button
            type="button"
            onClick={() => setTabFilter('tours')}
            className={`rounded-xl px-3 py-2 transition-all ${
              tabFilter === 'tours'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            🚕 الرحلات والتوصيل ({products.filter(p => p.category === 'activity_tour' || p.category === 'transport').length})
          </button>
        </div>

        {/* Search & New Item Shortcut */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <input
            type="text"
            placeholder="🔍 بحث سريع عن صنف..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full sm:w-48 rounded-xl bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs text-white placeholder-slate-400 focus:border-amber-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => setShowAddProductModal(true)}
            className="whitespace-nowrap rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white transition-colors shadow-sm"
          >
            + صنف جديد
          </button>
        </div>
      </div>

      {/* ───────── MAIN WORKSTATION: PRODUCT TILES + CART ───────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Section: Product & Service Tiles (8 Cols) */}
        <div className="lg:col-span-8">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
            {filteredProducts.map((p) => {
              const icon = getProductIcon(p.category, p.name);
              const isLow = p.track_stock && p.stock_quantity <= p.low_stock_threshold;
              const isOutOfStock = p.track_stock && p.stock_quantity <= 0;

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addToCart(p)}
                  disabled={isOutOfStock}
                  className={`group relative flex flex-col justify-between rounded-2xl border p-3 text-right transition-all active:scale-95 ${
                    isOutOfStock
                      ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                      : 'border-slate-200 bg-white hover:border-amber-600 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-2xl border border-amber-200/50 group-hover:scale-110 transition-transform">
                      {icon}
                    </span>
                    {p.track_stock ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isOutOfStock
                            ? 'bg-rose-100 text-rose-800'
                            : isLow
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {isOutOfStock ? 'نفد' : `${p.stock_quantity} ق`}
                      </span>
                    ) : (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        خدمة
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5">
                    <p className="line-clamp-2 text-xs font-bold text-slate-900 leading-tight">
                      {p.name}
                    </p>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="font-mono text-sm font-extrabold text-amber-950">
                        {fmt(p.price_cents, p.currency)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">
                        اضغط +
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {filteredProducts.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 p-12 text-center text-sm text-slate-500">
              لا توجد منتجات أو خدمات مطابقة لهذا التصنيف.
            </div>
          )}
        </div>

        {/* Right Section: Interactive Cart & Order Checkout Drawer (4 Cols) */}
        <div className="lg:col-span-4">
          <Card>
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <span>🛒 السلة والفاتورة</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                  {cart.reduce((s, i) => s + i.quantity, 0)} قطعة
                </span>
              </h3>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={clearCart}
                  className="text-xs text-rose-600 hover:text-rose-800 font-semibold"
                >
                  إفراغ السلة
                </button>
              )}
            </div>

            {/* Cart Items List */}
            <div className="divide-y divide-slate-100 py-2 max-h-60 overflow-y-auto">
              {cart.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  اضغط على أي صنف من اليسار لإضافته إلى السلة فوراً.
                </div>
              ) : (
                cart.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{item.icon}</span>
                      <div>
                        <p className="font-bold text-slate-900 line-clamp-1">{item.name}</p>
                        <p className="font-mono text-slate-500">{item.unitPrice} EGP</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Stepper */}
                      <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50">
                        <button
                          type="button"
                          onClick={() => updateQuantity(idx, -1)}
                          className="px-2 py-0.5 font-bold text-slate-600 hover:bg-slate-200 rounded-r-lg"
                        >
                          -
                        </button>
                        <span className="px-2 font-mono font-bold text-slate-900">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(idx, 1)}
                          className="px-2 py-0.5 font-bold text-slate-600 hover:bg-slate-200 rounded-l-lg"
                        >
                          +
                        </button>
                      </div>

                      <span className="w-16 text-left font-mono font-bold text-slate-900">
                        {(item.unitPrice * item.quantity).toFixed(0)} EGP
                      </span>

                      <button
                        type="button"
                        onClick={() => removeFromCart(idx)}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Order Configuration Form */}
            <form action={batchAction} className="mt-3 space-y-3 border-t pt-3 text-xs">
              <input type="hidden" name="cart" value={JSON.stringify(cart)} />

              {/* Guest / In-House Selector */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Lbl>النزيل / الحساب</Lbl>
                  <div className="flex gap-2 text-[11px]">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        checked={guestMode === 'in_house'}
                        onChange={() => setGuestMode('in_house')}
                      />
                      <span>نزيل مقيم</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        checked={guestMode === 'walk_in'}
                        onChange={() => setGuestMode('walk_in')}
                      />
                      <span>زائر خارجي</span>
                    </label>
                  </div>
                </div>

                {guestMode === 'in_house' ? (
                  <>
                    <select
                      value={selectedResId}
                      onChange={(e) => setSelectedResId(e.target.value)}
                      className={Input}
                    >
                      {inHouseGuests.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.full_name} ({g.room_label || 'غرفة مقيمة'})
                        </option>
                      ))}
                    </select>
                    <input type="hidden" name="reservationId" value={selectedResId} />
                    <input type="hidden" name="guestName" value={selectedGuest?.full_name || 'نزيل'} />
                    <input type="hidden" name="roomNumber" value={selectedGuest?.room_label || ''} />
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      name="guestName"
                      placeholder="اسم الزائر"
                      value={walkInName}
                      onChange={(e) => setWalkInName(e.target.value)}
                      className={Input}
                      required={guestMode === 'walk_in'}
                    />
                    <input
                      type="text"
                      name="roomNumber"
                      placeholder="رقم الغرفة (اختياري)"
                      value={walkInRoom}
                      onChange={(e) => setWalkInRoom(e.target.value)}
                      className={Input}
                    />
                  </div>
                )}
              </div>

              {/* Payment Method */}
              <div>
                <Lbl>طريقة السداد</Lbl>
                <div className="grid grid-cols-2 gap-1.5 font-bold">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cash')}
                    className={`rounded-xl border p-2 text-center transition-all ${
                      paymentMethod === 'cash'
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-500/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    💵 كاش (نقد)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('card_terminal')}
                    className={`rounded-xl border p-2 text-center transition-all ${
                      paymentMethod === 'card_terminal'
                        ? 'border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-500/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    💳 فيزا / شبكة
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('instapay')}
                    className={`rounded-xl border p-2 text-center transition-all ${
                      paymentMethod === 'instapay'
                        ? 'border-purple-600 bg-purple-50 text-purple-900 ring-2 ring-purple-500/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    📱 إنستاباي
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('room_charge')}
                    disabled={guestMode === 'walk_in'}
                    className={`rounded-xl border p-2 text-center transition-all ${
                      paymentMethod === 'room_charge'
                        ? 'border-amber-600 bg-amber-50 text-amber-900 ring-2 ring-amber-500/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50'
                    }`}
                  >
                    🏨 على الغرفة
                  </button>
                </div>
                <input type="hidden" name="paymentMethod" value={paymentMethod} />
                <input
                  type="hidden"
                  name="paymentStatus"
                  value={paymentMethod === 'room_charge' ? 'charged_to_room' : 'paid'}
                />
              </div>

              {/* Note / Comment */}
              <div>
                <input
                  type="text"
                  name="comment"
                  placeholder="ملاحظة إضافية (اختياري)..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className={Input}
                />
              </div>

              {/* Total & Checkout Button */}
              <div className="rounded-2xl bg-amber-950 p-4 text-white shadow-inner">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-amber-200">الإجمالي المستحق:</span>
                  <div className="text-right">
                    <span className="font-mono text-2xl font-black text-white">
                      {cartTotal.toFixed(0)} EGP
                    </span>
                    <span className="block text-[10px] text-amber-300 font-mono">
                      ≈ ${usdEquiv} USD / €{eurEquiv} EUR
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={cart.length === 0}
                  className="mt-3 w-full rounded-xl bg-amber-500 py-3 text-center text-sm font-bold text-slate-950 shadow-md hover:bg-amber-400 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all"
                >
                  {paymentMethod === 'room_charge'
                    ? '✔ شحن المبلغ على فاتورة الغرفة'
                    : '✔ إتمام الدفع وتسجيل الطلب'}
                </button>
              </div>
            </form>
          </Card>
        </div>
      </div>

      {/* ───────── MODAL: QUICK ADD NEW PRODUCT ───────── */}
      {showAddProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3 mb-4">
              <h3 className="text-lg font-bold text-slate-900">إضافة صنف جديد فوراً لنقاط البيع والمخزن</h3>
              <button
                type="button"
                onClick={() => setShowAddProductModal(false)}
                className="text-slate-400 hover:text-slate-600 text-lg"
              >
                ✕
              </button>
            </div>

            <form
              action={createProductAction}
              onSubmit={() => setShowAddProductModal(false)}
              className="space-y-4 text-sm"
            >
              <input type="hidden" name="returnTo" value="/dashboard/pos" />

              <div>
                <Lbl htmlFor="pos_new_name">اسم الصنف</Lbl>
                <input
                  id="pos_new_name"
                  type="text"
                  name="name"
                  placeholder="مثال: كانز بيبسي أو آيس كريم"
                  className={Input}
                  required
                />
              </div>

              <div>
                <Lbl htmlFor="pos_new_cat">القسم / التصنيف</Lbl>
                <select id="pos_new_cat" name="category" className={Input} defaultValue="beverage">
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
                  <Lbl htmlFor="pos_new_cost">سعر التوريد / التكلفة (جنيه)</Lbl>
                  <input
                    id="pos_new_cost"
                    type="number"
                    step="0.5"
                    name="cost"
                    defaultValue="15"
                    className={Input}
                    required
                  />
                  <span className="text-[11px] text-emerald-800">سعر الشراء من المورد</span>
                </div>

                <div className="rounded-xl bg-amber-50/70 p-3 border border-amber-200/60">
                  <Lbl htmlFor="pos_new_price">سعر البيع للنزيل (جنيه)</Lbl>
                  <input
                    id="pos_new_price"
                    type="number"
                    step="0.5"
                    name="price"
                    defaultValue="30"
                    className={Input}
                    required
                  />
                  <span className="text-[11px] text-amber-800">السعر المعروض للبيع</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Lbl htmlFor="pos_new_stock">الكمية الابتدائية بالمخزن</Lbl>
                  <input
                    id="pos_new_stock"
                    type="number"
                    name="initialStock"
                    defaultValue="24"
                    className={Input}
                  />
                </div>

                <div>
                  <Lbl htmlFor="pos_new_low">حد التنبيه عند النقص</Lbl>
                  <input
                    id="pos_new_low"
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
                  id="pos_new_track"
                  name="trackStock"
                  defaultChecked={true}
                  className="h-4 w-4 rounded border-slate-300 text-amber-700"
                />
                <Lbl htmlFor="pos_new_track">تفعيل الجرد والخصم التلقائي عند البيع</Lbl>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddProductModal(false)}
                  className={BtnGhost}
                >
                  إلغاء
                </button>
                <button type="submit" className={Btn}>
                  + حفظ وإضافة الصنف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
