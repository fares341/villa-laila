'use client';

import { useState } from 'react';
import { Card, Input, Lbl, Btn, BtnGhost, fmt } from '@/components/dash-ui';

interface TourItem {
  id: string;
  booking_number: string;
  guest_name: string;
  room_number?: string;
  destination: string;
  tour_date: string;
  pickup_time: string;
  guests_count: number;
  guide_name?: string;
  driver_name?: string;
  driver_phone?: string;
  price_cents: number;
  currency: string;
  payment_status: string;
  status: string;
  booker_name?: string;
  notes?: string;
}

interface InHouseGuest {
  id: string;
  reference: string;
  full_name: string;
  phone?: string;
  room_label: string;
}

export function ToursClient({
  tours,
  inHouseGuests,
  createTourAction,
  updateTourStatusAction,
}: {
  tours: TourItem[];
  inHouseGuests: InHouseGuest[];
  createTourAction: (formData: FormData) => Promise<void>;
  updateTourStatusAction: (formData: FormData) => Promise<void>;
}) {
  const [showModal, setShowModal] = useState<boolean>(false);
  const [guestMode, setGuestMode] = useState<'in_house' | 'walk_in'>('in_house');
  const [selectedResId, setSelectedResId] = useState<string>(inHouseGuests[0]?.id || '');
  const [destination, setDestination] = useState<string>('Giza & Pyramids Tour');
  const [price, setPrice] = useState<number>(2500);
  const [currency, setCurrency] = useState<string>('EGP');

  const tourPresets = [
    { name: 'جولة الأهرامات وأبو الهول (Pyramids & Sphinx)', defaultPrice: 2500 },
    { name: 'سقارة ودهشور وممفيس (Saqqara & Dahshour)', defaultPrice: 3800 },
    { name: 'عشاء نيلي بالمركب (Nile Dinner Cruise)', defaultPrice: 1800 },
    { name: 'رحلة الإسكندرية اليومية (Alexandria Day Tour)', defaultPrice: 5500 },
    { name: 'تاكسي واستقبال المطار (Airport Taxi Transfer)', defaultPrice: 1100 },
    { name: 'القاهرة الإسلامية والمتاحف (Islamic Cairo & Museum)', defaultPrice: 2800 },
    { name: 'جولة الأقصر اليومية (Luxor Day Tour)', defaultPrice: 9500 },
  ];

  const handleSelectPreset = (name: string, p: number) => {
    setDestination(name);
    setPrice(p);
  };

  const selectedGuest = inHouseGuests.find((g) => g.id === selectedResId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-800">جدول الرحلات السياحية وتوصيلات النزل</h2>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-800"
        >
          + حجز رحلة / توصيلة جديدة
        </button>
      </div>

      <Card>
        {tours.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">لا توجد رحلات مسجلة في هذه الفترة.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">رقم الحجز</th>
                  <th className="py-2.5 px-3">التاريخ والوقت</th>
                  <th className="py-2.5 px-3">النزيل والغرفة</th>
                  <th className="py-2.5 px-3">الوجهة / الرحلة</th>
                  <th className="py-2.5 px-3">الأفراد</th>
                  <th className="py-2.5 px-3">السائق والمرشد</th>
                  <th className="py-2.5 px-3">السعر والدفع</th>
                  <th className="py-2.5 px-3">الحالة والتنسيق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tours.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/60">
                    <td className="py-3 px-3 font-mono text-xs font-bold text-slate-600">
                      {t.booking_number}
                      <span className="block text-[10px] text-slate-400">بواسطة: {t.booker_name || '—'}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-bold text-slate-900">{t.tour_date}</span>
                      <span className="block text-xs text-amber-800 font-semibold">⏰ {t.pickup_time}</span>
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-900">
                      {t.guest_name}
                      {t.room_number && (
                        <span className="block text-xs font-normal text-slate-500">غرفة: {t.room_number}</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-800 max-w-[14rem]">
                      {t.destination}
                      {t.notes && <span className="block text-xs font-normal text-slate-500">{t.notes}</span>}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-center">{t.guests_count}</td>
                    <td className="py-3 px-3 text-xs">
                      {t.driver_name ? (
                        <span className="block font-medium text-slate-800">
                          🚗 {t.driver_name}
                          {t.driver_phone && (
                            <a
                              href={`tel:${t.driver_phone}`}
                              className="mr-1 text-blue-700 underline"
                              dir="ltr"
                            >
                              ({t.driver_phone})
                            </a>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-400 block">سائق: لم يُحدد</span>
                      )}
                      {t.guide_name && (
                        <span className="block text-slate-600">👤 مرشد: {t.guide_name}</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-bold text-slate-900">{fmt(t.price_cents, t.currency)}</span>
                      <span className="block text-xs">
                        {t.payment_status === 'paid' && (
                          <span className="text-emerald-700 font-medium">✔ مدفوع</span>
                        )}
                        {t.payment_status === 'charged_to_room' && (
                          <span className="text-amber-700 font-medium">📋 على الغرفة</span>
                        )}
                        {t.payment_status === 'unpaid' && (
                          <span className="text-rose-700 font-medium">✕ غير مدفوع</span>
                        )}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-xs">
                      <form action={updateTourStatusAction} className="flex items-center gap-1.5">
                        <input type="hidden" name="tourId" value={t.id} />
                        <select
                          name="status"
                          defaultValue={t.status}
                          onChange={(e) => e.target.form?.requestSubmit()}
                          className={`rounded-lg border px-2 py-1 text-xs font-bold ${
                            t.status === 'scheduled'
                              ? 'bg-amber-50 text-amber-900 border-amber-300'
                              : t.status === 'dispatched'
                              ? 'bg-blue-50 text-blue-900 border-blue-300'
                              : t.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                              : 'bg-slate-100 text-slate-700 border-slate-300'
                          }`}
                        >
                          <option value="scheduled">مجدولة (Scheduled)</option>
                          <option value="dispatched">تم التحرك (Dispatched)</option>
                          <option value="completed">مكتملة (Completed)</option>
                          <option value="cancelled">ملغاة (Cancelled)</option>
                        </select>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ───────── MODAL: NEW TOUR BOOKING ───────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl text-sm max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-slate-900">حجز رحلة سياحية / توصيلة مطار جديدة</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              تنسيق موعد التحرك، السائق، المرشد السياحي، وحساب التكلفة للنزيل.
            </p>

            <form action={createTourAction} onSubmit={() => setShowModal(false)} className="mt-4 space-y-3.5">
              {/* Presets */}
              <div>
                <Lbl>الوجهة والرحلة الشائعة</Lbl>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 mb-2">
                  {tourPresets.map((tp) => (
                    <button
                      key={tp.name}
                      type="button"
                      onClick={() => handleSelectPreset(tp.name, tp.defaultPrice)}
                      className={`rounded-lg border p-1.5 text-right text-xs font-medium transition-colors ${
                        destination === tp.name
                          ? 'border-amber-600 bg-amber-50 text-amber-900 font-bold'
                          : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      {tp.name}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  name="destination"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  className={Input}
                  placeholder="أو اكتب وجهة مخصصة..."
                  required
                />
              </div>

              {/* Guest selector */}
              <div>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <Lbl>النزيل / الغرفة</Lbl>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setGuestMode('in_house')}
                      className={`underline ${guestMode === 'in_house' ? 'font-bold text-amber-800' : 'text-slate-500'}`}
                    >
                      نزيل مقيم حالياً
                    </button>
                    <span>|</span>
                    <button
                      type="button"
                      onClick={() => setGuestMode('walk_in')}
                      className={`underline ${guestMode === 'walk_in' ? 'font-bold text-amber-800' : 'text-slate-500'}`}
                    >
                      عميل خارجي
                    </button>
                  </div>
                </div>

                {guestMode === 'in_house' && inHouseGuests.length > 0 ? (
                  <div>
                    <select
                      value={selectedResId}
                      onChange={(e) => setSelectedResId(e.target.value)}
                      className={Input}
                    >
                      {inHouseGuests.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.full_name} — {g.room_label}
                        </option>
                      ))}
                    </select>
                    <input type="hidden" name="reservationId" value={selectedResId} />
                    <input type="hidden" name="guestName" value={selectedGuest?.full_name || 'Guest'} />
                    <input type="hidden" name="roomNumber" value={selectedGuest?.room_label || ''} />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" name="guestName" placeholder="اسم العميل" className={Input} required />
                    <input type="text" name="roomNumber" placeholder="رقم الغرفة (إن وجد)" className={Input} />
                  </div>
                )}
              </div>

              {/* Date & Pickup Time */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Lbl>تاريخ الرحلة</Lbl>
                  <input
                    type="date"
                    name="tourDate"
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className={Input}
                    required
                  />
                </div>
                <div>
                  <Lbl>وقت التحرك (Pickup)</Lbl>
                  <input type="time" name="pickupTime" defaultValue="07:00" className={Input} required />
                </div>
                <div>
                  <Lbl>عدد الأفراد (Pax)</Lbl>
                  <input type="number" min="1" name="guestsCount" defaultValue="2" className={Input} required />
                </div>
              </div>

              {/* Driver & Guide */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Lbl>اسم السائق</Lbl>
                  <input type="text" name="driverName" placeholder="مثال: كابتن أحمد" className={Input} />
                </div>
                <div>
                  <Lbl>هاتف السائق</Lbl>
                  <input type="text" name="driverPhone" placeholder="010..." className={Input} />
                </div>
                <div>
                  <Lbl>اسم المرشد (Guide)</Lbl>
                  <input type="text" name="guideName" placeholder="مثال: معاذ المرشد" className={Input} />
                </div>
              </div>

              {/* Price, Currency & Payment */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Lbl>السعر الإجمالي</Lbl>
                  <input
                    type="number"
                    name="price"
                    value={price}
                    onChange={(e) => setPrice(parseFloat(e.target.value || '0'))}
                    className={Input}
                    required
                  />
                </div>
                <div>
                  <Lbl>العملة</Lbl>
                  <select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={Input}>
                    <option value="EGP">EGP (جنيه)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
                <div>
                  <Lbl>حالة الدفع</Lbl>
                  <select name="paymentStatus" className={Input}>
                    <option value="unpaid">✕ غير مدفوع بعد</option>
                    <option value="paid">✔ تم الدفع الآن</option>
                    <option value="charged_to_room">📋 يضاف لحساب الغرفة</option>
                  </select>
                </div>
              </div>

              <div>
                <Lbl>ملاحظات إضافية</Lbl>
                <input
                  type="text"
                  name="notes"
                  placeholder="مثال: فطور سفري الساعة 6 صباحاً، أو استلام من موقع خارجي..."
                  className={Input}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button type="button" onClick={() => setShowModal(false)} className={BtnGhost}>
                  إلغاء
                </button>
                <button type="submit" className={Btn}>
                  ✔ تأكيد حجز الرحلة ({price} {currency})
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
