'use client';

import React, { useEffect, useRef, useState } from 'react';

/** Photos as swipeable cards (story-style), with dots; a tap opens the photo full screen. */
export function PhotoStrip({ photos, ar }: { photos: string[]; ar: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const on = () => { const w = el.firstElementChild?.getBoundingClientRect().width ?? 1; setI(Math.round(Math.abs(el.scrollLeft) / (w + 12))); };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);
  useEffect(() => {
    if (open === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  return (
    <>
      <div className="cb-strip" ref={ref}>
        {photos.map((p, k) => (
          <button key={p} type="button" onClick={() => setOpen(k)} aria-label={(ar ? 'افتح الصورة ' : 'Open photo ') + (k + 1)}>
            <img src={p} alt="" loading={k < 2 ? 'eager' : 'lazy'} />
          </button>
        ))}
      </div>
      {photos.length > 1 && <div className="cb-dots" aria-hidden>{photos.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>}
      {open !== null && (
        <div className="cb-lb" role="dialog" aria-modal="true" onClick={() => setOpen(null)}>
          <img src={photos[open]} alt="" />
          <button type="button" aria-label={ar ? 'إغلاق' : 'Close'} onClick={() => setOpen(null)}>×</button>
        </div>
      )}
    </>
  );
}
