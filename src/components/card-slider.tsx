'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Makes a set of cards (the children of the element with id `gridId`) a coverflow slider: one card big in the
 * middle, the one before and the one after smaller behind it on each side. It moves by itself every few seconds
 * (back to the first after the last); arrows, a swipe or a tap on a side card move it by hand. It pauses while the
 * visitor touches, hovers or uses it, and does not move for people who ask for reduced motion. Right-to-left aware.
 */
export function CardSlider({ gridId, ar, every = 3800 }: { gridId: string; ar: boolean; every?: number }) {
  const paused = useRef(false);
  const [n, setN] = useState(0);
  const [i, setI] = useState(0);
  const idx = useRef(0);
  const grid = () => document.getElementById(gridId);

  // Place every card: centre, the ones beside it (before / after), the rest hidden behind.
  const paint = (cur: number) => {
    const el = grid(); if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    const total = kids.length;
    kids.forEach((k, j) => {
      let d = j - cur;
      if (total > 2) { if (d > total / 2) d -= total; if (d < -total / 2) d += total; }
      k.dataset.cf = d === 0 ? 'c' : d === 1 ? 'n' : d === -1 ? 'p' : d > 0 ? 'hn' : 'hp';
      k.setAttribute('aria-hidden', d === 0 ? 'false' : 'true');
      k.querySelectorAll('a,button').forEach((a) => ((a as HTMLElement).tabIndex = d === 0 ? 0 : -1));
    });
  };
  const go = (to: number) => {
    const total = grid()?.children.length ?? 0; if (!total) return;
    const v = ((to % total) + total) % total;
    idx.current = v; setI(v); paint(v);
  };
  const step = (dir: 1 | -1) => go(idx.current + dir);

  useEffect(() => {
    const el = grid(); if (!el) return;
    setN(el.children.length);
    el.classList.add('cf-on');
    paint(0);
    const stop = () => { paused.current = true; };
    const resume = () => { paused.current = false; };
    // A tap on a side card brings it to the middle instead of opening it.
    const onClick = (e: Event) => {
      const card = (e.target as HTMLElement).closest('[data-cf]') as HTMLElement | null;
      if (card && (card.dataset.cf === 'n' || card.dataset.cf === 'p')) { e.preventDefault(); e.stopPropagation(); paused.current = true; step(card.dataset.cf === 'n' ? 1 : -1); }
    };
    let x0: number | null = null;
    const ts = (e: TouchEvent) => { x0 = e.touches[0].clientX; paused.current = true; };
    const te = (e: TouchEvent) => {
      if (x0 != null) { const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) step(((dx < 0) !== ar ? 1 : -1) as 1 | -1); }
      x0 = null; setTimeout(resume, 5000);
    };
    el.addEventListener('click', onClick, true);
    el.addEventListener('pointerenter', stop); el.addEventListener('pointerleave', resume);
    el.addEventListener('touchstart', ts, { passive: true }); el.addEventListener('touchend', te, { passive: true });
    el.addEventListener('focusin', stop); el.addEventListener('focusout', resume);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = reduce ? null : setInterval(() => { if (!paused.current && !document.hidden) step(1); }, every);
    return () => {
      if (t) clearInterval(t);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('pointerenter', stop); el.removeEventListener('pointerleave', resume);
      el.removeEventListener('touchstart', ts); el.removeEventListener('touchend', te);
      el.removeEventListener('focusin', stop); el.removeEventListener('focusout', resume);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridId, every, ar]);

  if (n < 2) return null;
  const arrow = (d: 'l' | 'r') => <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d === 'l' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} /></svg>;
  return (
    <div className="cs-ctrl">
      <button type="button" onClick={() => { paused.current = true; step(-1); }} aria-label={ar ? 'السابق' : 'Previous'}>{ar ? arrow('r') : arrow('l')}</button>
      <span className="cs-dots" aria-hidden>{Array.from({ length: n }, (_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</span>
      <button type="button" onClick={() => { paused.current = true; step(1); }} aria-label={ar ? 'التالي' : 'Next'}>{ar ? arrow('l') : arrow('r')}</button>
    </div>
  );
}
