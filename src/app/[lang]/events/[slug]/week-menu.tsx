'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DATE_EVENT, STANDARD, t, type DayMeal } from './meal-modal';

/** Fired when the guest picks a day from the week's menu: the booking box selects that date. */
export const PICK_EVENT = 'evb:pick';

type Chip = { date: string; label: string; sub: string; left: number | null | undefined };
const weekday = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay();

/**
 * One photo beside the booking box: the meal of the chosen day ("Today's meal"), with a button to see the whole
 * week's menu. In the week view each day shows its plate; tapping a day picks that date in the booking box.
 */
export function WeekMenuCard({ ar, menu, dates, initialDate, today, priceLabel, fallback = true }: {
  ar: boolean; menu: Record<number, DayMeal | null>; dates: Chip[]; initialDate: string; today: string; priceLabel?: string | null;
  /** Show the standard plate on days the weekly menu leaves empty (dinner add-on); otherwise those days are skipped. */
  fallback?: boolean;
}) {
  const [date, setDate] = useState(initialDate);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<string>).detail; if (d) setDate(d); };
    window.addEventListener(DATE_EVENT, on);
    return () => window.removeEventListener(DATE_EVENT, on);
  }, []);
  const mealOf = (d: string): DayMeal | null => menu[weekday(d)] ?? (fallback ? STANDARD : null);
  const shownDate = date || dates[0]?.date || today;
  const m = mealOf(shownDate) ?? Object.values(menu).find(Boolean) ?? STANDARD;
  const chip = dates.find((x) => x.date === shownDate);
  const title = t(m.title, ar);
  const kicker = shownDate === today ? (ar ? 'وجبة النهارده' : 'Today’s meal') : (ar ? `وجبة ${chip?.label ?? ''}` : `Meal · ${chip?.label ?? ''}`);

  return (
    <section className="evmeal wk" aria-labelledby="evmealH" dir={ar ? 'rtl' : 'ltr'}>
      <button type="button" className="wk-cover" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {m.img && <img className="evmeal-img" src={m.img} alt={title} loading="lazy" decoding="async" />}
        <span className="wk-badge">{kicker}</span>
        <span className="wk-cta">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
          {ar ? 'اضغط وشوف منيو الأسبوع كله' : 'Tap to see this week’s menu'}
        </span>
      </button>
      <div className="evmeal-body">
        <h2 id="evmealH">{title}</h2>
        {m.dishes.length > 0 && <p className="evmeal-desc">{m.dishes.map((x) => t(x, ar)).join(' · ')}</p>}
        {priceLabel && <p className="evmeal-price">{ar ? 'طبق كامل للفرد' : 'A full plate per person'} · <b dir="ltr">+{priceLabel}</b></p>}
      </div>
      {open && <WeekSheet ar={ar} dates={dates} mealOf={mealOf} chosen={shownDate} today={today} onClose={() => setOpen(false)} />}
    </section>
  );
}

function WeekSheet({ ar, dates, mealOf, chosen, today, onClose }: {
  ar: boolean; dates: Chip[]; mealOf: (d: string) => DayMeal | null; chosen: string; today: string; onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; prevFocus?.focus?.(); };
  }, [onClose]);
  // The next seven event days that have a meal.
  const days = dates.map((d) => ({ ...d, meal: mealOf(d.date) })).filter((d) => d.meal).slice(0, 7);
  const pick = (d: string) => {
    window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: d }));
    onClose();
    setTimeout(() => document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  return createPortal(
    <div className="meal-scrim" onClick={onClose}>
      <div className="meal-sheet wk-sheet" role="dialog" aria-modal="true" aria-labelledby="wk-h" dir={ar ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <span className="meal-grab" aria-hidden />
        <div className="wk-head">
          <h3 id="wk-h">{ar ? 'منيو الأسبوع' : 'This week’s menu'}</h3>
          <button ref={closeRef} type="button" className="meal-x static" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <p className="wk-hint">{ar ? 'اختار اليوم اللي عاجبك أكله، وهنحجزلك عليه على طول.' : 'Pick the day whose meal you like — we’ll book that day for you.'}</p>
        <ul className="wk-list">
          {days.map((d) => {
            const full = d.left === 0;
            const title = t(d.meal!.title, ar);
            return (
              <li key={d.date}>
                <button type="button" className={`wk-day ${d.date === chosen ? 'on' : ''}`} disabled={full} onClick={() => pick(d.date)}>
                  {d.meal!.img ? <img src={d.meal!.img} alt="" loading="lazy" decoding="async" /> : <span className="wk-noimg" aria-hidden />}
                  <span className="wk-txt">
                    <small>{d.date === today ? (ar ? 'النهارده' : 'Today') : d.label} · {d.sub}</small>
                    <b>{title}</b>
                    {d.meal!.dishes.length > 0 && <em>{d.meal!.dishes.map((x) => t(x, ar)).join(' · ')}</em>}
                  </span>
                  <span className="wk-go">{full ? (ar ? 'كامل العدد' : 'Sold out') : d.date === chosen ? (ar ? 'متختار' : 'Chosen') : (ar ? 'احجز اليوم ده' : 'Book this day')}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
