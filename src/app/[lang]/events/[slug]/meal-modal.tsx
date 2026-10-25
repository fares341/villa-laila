'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type Loc = { ar?: string; en?: string };
/** The meal of a weekday (Events → Weekly dinner menu): one photo, its name, the dishes on the plate. */
export type DayMeal = { title: Loc; dishes: Loc[]; description: Loc; img: string | null };

/** Shown on a day with nothing in the weekly menu yet. */
const STANDARD: DayMeal = {
  img: '/photos/events/meals/egyptian-salad.webp',
  title: { ar: 'طاجن لحمة بالبصل', en: 'Beef & onion tagine' },
  dishes: [
    { ar: 'أرز مصري بالشعرية', en: 'Egyptian vermicelli rice' },
    { ar: 'شوربة لسان عصفور', en: 'Orzo soup' },
    { ar: 'سلطة خضراء بلدي', en: 'Fresh Egyptian salad' },
  ],
  description: { ar: 'لحمة طرية مطهية على نار هادية مع البصل في صوص غني.', en: 'Tender beef slowly cooked with onions in a rich sauce.' },
};

const t = (x: Loc | undefined, ar: boolean) => (ar ? x?.ar || x?.en : x?.en || x?.ar) || '';

/** Button with the meal photo that opens the meal of the chosen day. */
export function MealLink({ ar, onOpen, meal, day }: { ar: boolean; onOpen: () => void; meal?: DayMeal | null; day?: string | null }) {
  const m = meal ?? STANDARD;
  return (
    <button type="button" className={`evb-meal-link${m.img ? ' has-img' : ''}`} onClick={onOpen} aria-haspopup="dialog">
      {m.img && <img className="evb-meal-cover" src={m.img} alt="" loading="lazy" />}
      <span className="evb-meal-t">
        <b>{ar ? 'شاهد صور وتفاصيل الوجبة' : 'View meal photos & details'}</b>
        <small>{meal && day ? `${ar ? 'عشاء' : 'Dinner'} ${day}: ${t(m.title, ar)}` : t(m.title, ar)}</small>
      </span>
    </button>
  );
}

/**
 * The meal of the day: one photo of the plate, its name and what is on it.
 * A bottom sheet on phones, a centred card on larger screens; closes with X, Esc or a tap outside.
 */
export function MealModal({ ar, priceLabel, onClose, meal, day }: { ar: boolean; priceLabel?: string | null; onClose: () => void; meal?: DayMeal | null; day?: string | null }) {
  const m = meal ?? STANDARD;
  const closeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      prevFocus?.focus?.();
    };
  }, [onClose]);

  const title = t(m.title, ar);
  const desc = t(m.description, ar);
  return createPortal(
    <div className="meal-scrim" onClick={onClose}>
      <div className="meal-sheet" role="dialog" aria-modal="true" aria-labelledby="meal-h" dir={ar ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <span className="meal-grab" aria-hidden />
        <div className="meal-photo">
          {m.img ? <img src={m.img} alt={title} decoding="async" /> : <span className="meal-noimg" aria-hidden>🍽️</span>}
          <button ref={closeRef} type="button" className="meal-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          {meal && day && <span className="meal-day">{ar ? `منيو ${day}` : `Menu · ${day}`}</span>}
        </div>
        <div className="meal-body">
          <span className="meal-kicker">{ar ? 'عشاء بيتي بجانب المسبح' : 'Home-cooked dinner by the pool'}</span>
          <h3 id="meal-h">{title || (ar ? 'عشاء اليوم' : 'Tonight’s dinner')}</h3>
          {desc && <p className="meal-desc">{desc}</p>}
          {m.dishes.length > 0 && (
            <>
              <h4>{ar ? 'في الطبق' : 'On the plate'}</h4>
              <ul className="meal-dishes">
                {m.dishes.map((d, i) => (
                  <li key={i} style={{ ['--i' as string]: i }}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="m5 12 5 5 9-10" /></svg>
                    {t(d, ar)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="meal-foot">
            {priceLabel && <span className="meal-price">{ar ? 'طبق كامل للفرد' : 'A full plate per person'} · <b dir="ltr">+{priceLabel}</b></span>}
            <span>{ar ? 'بيتطبخ طازة في مطبخ الفيلا ويتقدم جنب المسبح.' : 'Cooked fresh in the villa kitchen, served by the pool.'}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Fired by the booking box when the guest picks another date, so the meal card beside it follows. */
export const DATE_EVENT = 'evb:date';

/**
 * The meal of the chosen date, shown in full beside the booking box (no tap needed): the whole photo in a gold
 * frame, its name, a short description and what is on the plate. Follows the date picked in the booking box.
 */
export function DayMealCard({ ar, menu, dates, initialDate, priceLabel }: { ar: boolean; menu: Record<number, DayMeal | null>; dates: { date: string; label: string }[]; initialDate: string; priceLabel?: string | null }) {
  const [date, setDate] = useState(initialDate);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<string>).detail; if (d) setDate(d); };
    window.addEventListener(DATE_EVENT, on);
    return () => window.removeEventListener(DATE_EVENT, on);
  }, []);
  const set = date ? menu[new Date(date + 'T12:00:00Z').getUTCDay()] ?? null : null;
  const m = set ?? STANDARD;
  const day = set ? dates.find((x) => x.date === date)?.label ?? null : null;
  const title = t(m.title, ar);
  const desc = t(m.description, ar);
  return (
    <section className="evmeal" aria-labelledby="evmealH" dir={ar ? 'rtl' : 'ltr'}>
      {m.img && <img className="evmeal-img" src={m.img} alt={title} loading="lazy" decoding="async" />}
      <div className="evmeal-body">
        <span className="evmeal-k">{day ? (ar ? `عشاء ${day}` : `Dinner · ${day}`) : (ar ? 'عشاء الليلة' : 'Tonight’s dinner')}</span>
        <h2 id="evmealH">{title}</h2>
        {desc && <p className="evmeal-desc">{desc}</p>}
        {m.dishes.length > 0 && (
          <ul className="evmeal-dishes">
            {m.dishes.map((x, i) => <li key={i}>{t(x, ar)}</li>)}
          </ul>
        )}
        {priceLabel && <p className="evmeal-price">{ar ? 'طبق كامل للفرد' : 'A full plate per person'} · <b dir="ltr">+{priceLabel}</b></p>}
      </div>
    </section>
  );
}
