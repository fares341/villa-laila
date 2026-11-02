'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Makes a row of cards (the element with id `gridId`) a slider that moves by itself, one card every few seconds,
 * back to the first after the last. Arrows move it by hand; it pauses while the visitor touches, hovers or uses it,
 * and does not move for people who ask for reduced motion. Works right-to-left (Arabic) too.
 */
export function CardSlider({ gridId, ar, every = 3500 }: { gridId: string; ar: boolean; every?: number }) {
  const paused = useRef(false);
  const [n, setN] = useState(0);
  const grid = () => document.getElementById(gridId);

  const step = (dir: 1 | -1) => {
    const el = grid(); if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const w = (card?.getBoundingClientRect().width ?? el.clientWidth) + parseFloat(getComputedStyle(el).columnGap || '12');
    const rtl = getComputedStyle(el).direction === 'rtl';
    const pos = Math.abs(el.scrollLeft), max = el.scrollWidth - el.clientWidth;
    if (dir === 1 && pos >= max - 4) { el.scrollTo({ left: 0, behavior: 'smooth' }); return; }
    if (dir === -1 && pos <= 4) { el.scrollTo({ left: rtl ? -max : max, behavior: 'smooth' }); return; }
    el.scrollBy({ left: (rtl ? -1 : 1) * dir * w, behavior: 'smooth' });
  };

  useEffect(() => {
    const el = grid(); if (!el) return;
    setN(el.children.length);
    const stop = () => { paused.current = true; };
    const go = () => { paused.current = false; };
    el.addEventListener('pointerenter', stop); el.addEventListener('pointerleave', go);
    el.addEventListener('touchstart', stop, { passive: true }); el.addEventListener('touchend', () => setTimeout(go, 4000), { passive: true });
    el.addEventListener('focusin', stop); el.addEventListener('focusout', go);
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => { if (!paused.current && !document.hidden && el.scrollWidth > el.clientWidth + 4) step(1); }, every);
    return () => { clearInterval(t); el.removeEventListener('pointerenter', stop); el.removeEventListener('pointerleave', go); el.removeEventListener('focusin', stop); el.removeEventListener('focusout', go); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridId, every]);

  if (n < 2) return null;
  const arrow = (d: 'l' | 'r') => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d === 'l' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} /></svg>;
  // In Arabic the next card is on the left.
  return (
    <div className="cs-ctrl">
      <button type="button" onClick={() => { paused.current = true; step(-1); }} aria-label={ar ? 'السابق' : 'Previous'}>{ar ? arrow('r') : arrow('l')}</button>
      <button type="button" onClick={() => { paused.current = true; step(1); }} aria-label={ar ? 'التالي' : 'Next'}>{ar ? arrow('l') : arrow('r')}</button>
    </div>
  );
}
