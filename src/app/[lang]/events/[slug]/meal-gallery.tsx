'use client';

import React, { useCallback, useEffect, useState } from 'react';

type Photo = { id: string; src: string; caption: string | null };

/** Meal photos beside the booking box: a tidy grid, tap to open full size and swipe through. */
export function MealGallery({ photos, lang }: { photos: Photo[]; lang: string }) {
  const ar = lang === 'ar';
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const go = useCallback((d: number) => setOpen((i) => (i === null ? i : (i + d + photos.length) % photos.length)), [photos.length]);
  useEffect(() => {
    if (open === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(ar ? -1 : 1); if (e.key === 'ArrowLeft') go(ar ? 1 : -1); };
    document.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [open, close, go, ar]);
  if (!photos.length) return null;
  const shown = photos.slice(0, 6);
  const more = photos.length - shown.length;

  return (
    <section className="evm" aria-labelledby="evmH">
      <h2 id="evmH">{ar ? 'الأكل' : 'The food'} <small>{photos.length} {ar ? 'صور' : photos.length === 1 ? 'photo' : 'photos'}</small></h2>
      <ul className={`evm-grid n${Math.min(shown.length, 6)}`}>
        {shown.map((p, i) => (
          <li key={p.id}>
            <button type="button" onClick={() => setOpen(i)} aria-label={(ar ? 'افتح الصورة ' : 'Open photo ') + (i + 1)}>
              <img src={p.src} alt={p.caption ?? ''} loading="lazy" />
              {i === shown.length - 1 && more > 0 && <span className="evm-more">+{more}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open !== null && (
        <div className="evm-lb" role="dialog" aria-modal="true" aria-label={ar ? 'صور الأكل' : 'Food photos'} onClick={close}>
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={photos[open].src} alt={photos[open].caption ?? ''} />
            {photos[open].caption && <figcaption>{photos[open].caption}</figcaption>}
          </figure>
          <span className="evm-count">{open + 1} / {photos.length}</span>
          <button type="button" className="evm-x" onClick={close} aria-label={ar ? 'إغلاق' : 'Close'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
          {photos.length > 1 && (
            <>
              <button type="button" className="evm-nav prev" onClick={(e) => { e.stopPropagation(); go(-1); }} aria-label={ar ? 'السابقة' : 'Previous'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
              </button>
              <button type="button" className="evm-nav next" onClick={(e) => { e.stopPropagation(); go(1); }} aria-label={ar ? 'التالية' : 'Next'}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m9 18 6-6-6-6" /></svg>
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
