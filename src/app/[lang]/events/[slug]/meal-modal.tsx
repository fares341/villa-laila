'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/** The four dishes of the home-cooked poolside dinner (photos in /public/photos/events/meals). */
const MEALS = [
  {
    img: '/photos/events/meals/beef-onion-tagen.webp',
    ar: { t: 'طاجن لحمة بالبصل المكرمل', d: 'لحمة طرية مطهية على نار هادية مع البصل المكرمل في صوص غني.' },
    en: { t: 'Beef & caramelised onion tagine', d: 'Tender beef slowly cooked with onions in a rich sauce.' },
  },
  {
    img: '/photos/events/meals/vermicelli-rice.webp',
    ar: { t: 'أرز مصري بالشعرية الذهبية', d: 'أرز مصري مفلفل بالشعرية المحمّرة.' },
    en: { t: 'Egyptian vermicelli rice', d: 'Fluffy Egyptian rice with toasted vermicelli.' },
  },
  {
    img: '/photos/events/meals/orzo-soup.webp',
    ar: { t: 'شوربة لسان عصفور ساخنة', d: 'شوربة دافية ومريحة بلسان العصفور.' },
    en: { t: 'Warm orzo soup', d: 'Warm, comforting orzo soup.' },
  },
  {
    img: '/photos/events/meals/egyptian-salad.webp',
    ar: { t: 'سلطة خضراء بلدي طازجة', d: 'سلطة مصرية طازجة من خضار اليوم.' },
    en: { t: 'Fresh Egyptian salad', d: 'Fresh Egyptian salad.' },
  },
];

/** Small text button that opens the dinner photos. */
export function MealLink({ ar, onOpen }: { ar: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="evb-meal-link" onClick={onOpen} aria-haspopup="dialog">
      <span aria-hidden>🍽️</span> {ar ? 'شاهد صور وتفاصيل الوجبة' : 'View meal photos'}
    </button>
  );
}

/**
 * The dinner, dish by dish. A bottom sheet on phones, a centred card on larger screens.
 * Closes with X, Esc or a tap outside; the page behind does not scroll while it is open.
 */
export function MealModal({ ar, priceLabel, onClose }: { ar: boolean; priceLabel?: string | null; onClose: () => void }) {
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

  return createPortal(
    <div className="meal-scrim" onClick={onClose}>
      <div className="meal-sheet" role="dialog" aria-modal="true" aria-labelledby="meal-h" dir={ar ? 'rtl' : 'ltr'} onClick={(e) => e.stopPropagation()}>
        <span className="meal-grab" aria-hidden />
        <header className="meal-hd">
          <div>
            <span className="meal-kicker">{ar ? 'عشاء بيتي بجانب المسبح' : 'Home-cooked dinner by the pool'}</span>
            <h3 id="meal-h">{ar ? 'إيه اللي في الوجبة؟' : 'What’s on the plate'}</h3>
            {priceLabel && <p>{ar ? <>طبق كامل لكل فرد · <b dir="ltr">+{priceLabel}</b></> : <>A full plate per person · <b dir="ltr">+{priceLabel}</b></>}</p>}
          </div>
          <button ref={closeRef} type="button" className="meal-x" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </header>
        <ul className="meal-grid">
          {MEALS.map((m, i) => {
            const x = ar ? m.ar : m.en;
            return (
              <li key={m.img} style={{ ['--i' as string]: i }}>
                <span className="meal-ph"><img src={m.img} alt={x.t} loading="eager" decoding="async" /></span>
                <b>{x.t}</b>
                <small>{x.d}</small>
              </li>
            );
          })}
        </ul>
        <p className="meal-note">{ar ? 'بيتطبخ طازة في مطبخ الفيلا يوم الفعالية، ويتقدم على الترابيزات جنب المسبح.' : 'Cooked fresh in the villa kitchen on the day and served at the tables by the pool.'}</p>
      </div>
    </div>,
    document.body,
  );
}
