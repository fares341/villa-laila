'use client';

import { useState } from 'react';
import { Card, Input, Lbl, Btn, BtnGhost, fmt, dt } from '@/components/dash-ui';
import { ConfirmButton } from '@/components/ConfirmButton';

export function ShiftsClient({
  activeShift,
  shifts,
  expenses,
  canTake,
  openShiftAction,
  closeShiftAction,
  takeShiftAction,
  recordExpenseAction,
}: {
  activeShift: any;
  shifts: any[];
  expenses: any[];
  canTake: boolean;
  openShiftAction: (formData: FormData) => Promise<void>;
  closeShiftAction: (formData: FormData) => Promise<void>;
  takeShiftAction: (formData: FormData) => Promise<void>;
  recordExpenseAction: (formData: FormData) => Promise<void>;
}) {
  const [showExpenseModal, setShowExpenseModal] = useState<boolean>(false);
  const [showCloseModal, setShowCloseModal] = useState<boolean>(false);

  const totalExpensesCents = expenses.reduce((s, e) => s + e.amount_cents, 0);

  return (
    <div className="space-y-6">
      {/* Active Shift Banner / Controls */}
      {activeShift ? (
        <div className="rounded-2xl border border-emerald-300 bg-gradient-to-r from-emerald-50 via-teal-50 to-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-600"></span>
                </span>
                <span className="font-bold text-emerald-950 text-base">
                  الوردية الحالية المفتوحة: {activeShift.shift_name} ({activeShift.shift_date})
                </span>
                <span className="rounded-full bg-emerald-200/80 px-2.5 py-0.5 text-xs font-bold text-emerald-900">
                  قيد العمل الآن
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                فتحها الموظف: <b className="text-slate-900">{activeShift.opener_name}</b> في {dt(activeShift.created_at)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowExpenseModal(true)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-slate-800"
              >
                💸 تسجيل مصروف / نثريات من الدرج
              </button>
              <button
                type="button"
                onClick={() => setShowCloseModal(true)}
                className="rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-800"
              >
                🔒 تقفيل الوردية وتسليم النقدية
              </button>
            </div>
          </div>

          {/* Quick Drawer Opening Floats */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-emerald-200/60 pt-3 text-xs">
            <div>
              <span className="text-slate-500">رصيد البداية EGP:</span>
              <p className="font-bold text-slate-900">{fmt(activeShift.drawer_egp_start, 'EGP')}</p>
            </div>
            <div>
              <span className="text-slate-500">رصيد البداية $:</span>
              <p className="font-bold text-slate-900">${activeShift.drawer_usd_start || 0}</p>
            </div>
            <div>
              <span className="text-slate-500">رصيد البداية €:</span>
              <p className="font-bold text-slate-900">€{activeShift.drawer_eur_start || 0}</p>
            </div>
            <div>
              <span className="text-slate-500">مصروفات خرجت من الدرج:</span>
              <p className="font-bold text-rose-700">{fmt(totalExpensesCents, 'EGP')}</p>
            </div>
          </div>
        </div>
      ) : (
        <Card title="لا توجد وردية مفتوحة حالياً">
          <p className="mb-4 text-xs text-slate-600">
            يرجى فتح وردية جديدة قبل البدء في استقبال النقدية لتسجيل رصيد بداية الدرج بدقة.
          </p>
          <form action={openShiftAction} className="grid gap-3 sm:grid-cols-5 items-end text-xs">
            <div>
              <Lbl>اسم الوردية</Lbl>
              <select name="shiftName" className={Input}>
                <option value="Morning">صباحية (Morning)</option>
                <option value="Evening">مسائية (Evening)</option>
                <option value="Night">ليلية (Night)</option>
                <option value="Full Day">يوم كامل (Full Day)</option>
              </select>
            </div>
            <div>
              <Lbl>نقدية البداية (EGP)</Lbl>
              <input type="number" step="1" name="startEgp" defaultValue="0" className={Input} />
            </div>
            <div>
              <Lbl>دولار بالدرج ($)</Lbl>
              <input type="number" step="1" name="startUsd" defaultValue="0" className={Input} />
            </div>
            <div>
              <Lbl>يورو بالدرج (€)</Lbl>
              <input type="number" step="1" name="startEur" defaultValue="0" className={Input} />
            </div>
            <div>
              <button type="submit" className={Btn + ' w-full'}>
                🔓 فتح الوردية الآن
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Main Grid: Shifts History & Drawer Outflows */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Shifts Table */}
        <div className="lg:col-span-8 space-y-4">
          <Card title={`سجل تقفيل الورديات والدرج (${shifts.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-2">التاريخ</th>
                    <th className="py-2.5 px-2">الوردية</th>
                    <th className="py-2.5 px-2">كاش EGP</th>
                    <th className="py-2.5 px-2">دولار $</th>
                    <th className="py-2.5 px-2">يورو €</th>
                    <th className="py-2.5 px-2">ماكينة POS</th>
                    <th className="py-2.5 px-2">نثريات</th>
                    <th className="py-2.5 px-2">الحالة / التوريد</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shifts.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="py-2.5 px-2 font-mono font-bold text-slate-800">{s.shift_date}</td>
                      <td className="py-2.5 px-2">
                        <span className="font-medium text-slate-900">{s.shift_name}</span>
                        <span className="block text-[10px] text-slate-400">
                          {s.opener_name} {s.closer_name ? `→ ${s.closer_name}` : ''}
                        </span>
                      </td>
                      <td className="py-2.5 px-2 font-mono font-bold text-slate-950">
                        {fmt(s.drawer_egp_actual || s.drawer_egp_start, 'EGP')}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-emerald-800 font-bold">
                        ${s.drawer_usd_actual || s.drawer_usd_start || 0}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-blue-800 font-bold">
                        €{s.drawer_eur_actual || s.drawer_eur_start || 0}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-slate-700">
                        {fmt(s.pos_terminal_actual || 0, 'EGP')}
                      </td>
                      <td className="py-2.5 px-2 font-mono text-rose-700">
                        {s.expenses_cents > 0 ? `-${fmt(s.expenses_cents, 'EGP')}` : '0'}
                      </td>
                      <td className="py-2.5 px-2">
                        {s.status === 'taken' && (
                          <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-900">
                            ✔ تم التوريد للمالك
                          </span>
                        )}
                        {s.status === 'closed' && (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-block rounded-full bg-slate-200 px-2 py-0.5 text-slate-800">
                              مغلقة
                            </span>
                            {canTake && (
                              <form action={takeShiftAction}>
                                <input type="hidden" name="shiftId" value={s.id} />
                                <ConfirmButton
                                  className="rounded bg-amber-700 px-2 py-0.5 text-[11px] font-bold text-white hover:bg-amber-800"
                                  message="تأكيد استلام وتوريد نقدية هذه الوردية للمالك/الإدارة؟"
                                >
                                  استلام الخزينة
                                </ConfirmButton>
                              </form>
                            )}
                          </div>
                        )}
                        {s.status === 'open' && (
                          <span className="inline-block rounded-full bg-emerald-500 px-2 py-0.5 font-bold text-white">
                            مفتوحة الآن
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Petty Cash Expenses Column */}
        <div className="lg:col-span-4 space-y-4">
          <Card title={`مصروفات ونثريات الدرج (${expenses.length})`}>
            <p className="text-xs text-slate-500 mb-3">
              كل مبالغ المشتريات والنظافة والعمالة التي صُرفت مباشرة من الدرج اليوم.
            </p>

            {expenses.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400">لا توجد مصروفات مسجلة اليوم.</p>
            ) : (
              <div className="space-y-2">
                {expenses.map((e) => (
                  <div key={e.id} className="flex items-start justify-between rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 text-xs">
                    <div>
                      <p className="font-bold text-slate-900">{e.description}</p>
                      <p className="text-[10px] text-slate-500">
                        {dt(e.created_at)} · {e.recorder_name}
                      </p>
                    </div>
                    <span className="font-mono font-bold text-rose-700">
                      -{fmt(e.amount_cents, e.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ───────── MODAL: RECORD PETTY CASH EXPENSE ───────── */}
      {showExpenseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl text-sm">
            <h3 className="text-lg font-bold text-slate-900">تسجيل نثريات / مصروف من الدرج</h3>
            <p className="text-xs text-slate-500 mt-1">
              سيتم خصم هذا المبلغ فورياً من كاش الدرج وتسجيله في سجل الوردية.
            </p>

            <form
              action={recordExpenseAction}
              onSubmit={() => setShowExpenseModal(false)}
              className="mt-4 space-y-3"
            >
              {activeShift && <input type="hidden" name="shiftId" value={activeShift.id} />}

              <div>
                <Lbl>بند المصروف</Lbl>
                <select name="category" className={Input}>
                  <option value="supplies">🧼 منظفات ومستلزمات نزل</option>
                  <option value="food_kitchen">🥖 أغذية وخبز ومطبخ</option>
                  <option value="pet_care">🐱 أكل ورعاية قطط النزل (Cat food)</option>
                  <option value="maintenance">🔧 صيانة وأدوات</option>
                  <option value="transport_taxi">🚕 مواصلات وتاكسي</option>
                  <option value="tips_wages">💼 إكراميات وعمالة يومية</option>
                  <option value="refund">↩️ استرجاع فرق عملة أو نزيل</option>
                  <option value="other">📌 أخرى</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Lbl>المبلغ</Lbl>
                  <input type="number" step="0.5" name="amount" defaultValue="50" className={Input} required />
                </div>
                <div>
                  <Lbl>العملة</Lbl>
                  <select name="currency" className={Input}>
                    <option value="EGP">EGP (جنيه)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                  </select>
                </div>
              </div>

              <div>
                <Lbl>وصف المصروف</Lbl>
                <input
                  type="text"
                  name="description"
                  placeholder="مثال: شراء أكل قطط وصابون غسيل..."
                  className={Input}
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button type="button" onClick={() => setShowExpenseModal(false)} className={BtnGhost}>
                  إلغاء
                </button>
                <button type="submit" className={Btn}>
                  ✔ خصم وحفظ المصروف
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────── MODAL: CLOSE SHIFT & COUNT CASH ───────── */}
      {showCloseModal && activeShift && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl text-sm">
            <h3 className="text-lg font-bold text-slate-900">تقفيل الوردية وجرد الدرج الفعلي</h3>
            <p className="text-xs text-slate-500 mt-1">
              قم بعدّ الكاش الفعلي الموجود في الدرج بالجنيه والدولار واليورو وإيصالات ماكينة الفيزا.
            </p>

            <form
              action={closeShiftAction}
              onSubmit={() => setShowCloseModal(false)}
              className="mt-4 space-y-3"
            >
              <input type="hidden" name="shiftId" value={activeShift.id} />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Lbl>كاش الجنيه الفعلي (EGP)</Lbl>
                  <input type="number" step="1" name="actualEgp" defaultValue="5000" className={Input} required />
                </div>
                <div>
                  <Lbl>إجمالي ماكينة الفيزا POS (EGP)</Lbl>
                  <input type="number" step="1" name="actualPos" defaultValue="0" className={Input} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Lbl>كاش الدولار الفعلي ($)</Lbl>
                  <input type="number" step="1" name="actualUsd" defaultValue="0" className={Input} />
                </div>
                <div>
                  <Lbl>كاش اليورو الفعلي (€)</Lbl>
                  <input type="number" step="1" name="actualEur" defaultValue="0" className={Input} />
                </div>
              </div>

              <div>
                <Lbl>ملاحظات التسليم والاستلام للوردية التالية</Lbl>
                <input
                  type="text"
                  name="notes"
                  placeholder="مثال: تم تسليم المفاتيح للزميل، وفرق 50 جنيه متبقي من نزيل..."
                  className={Input}
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button type="button" onClick={() => setShowCloseModal(false)} className={BtnGhost}>
                  إلغاء
                </button>
                <button type="submit" className="rounded-xl bg-emerald-700 px-5 py-2.5 font-bold text-white hover:bg-emerald-800">
                  ✔ اعتماد الإغلاق وتسليم الوردية
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
