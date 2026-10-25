'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Guest films: one wide film on top (play inline, full-screen button), then a
 * swipeable row of portrait reels. A reel opens in a pop-up player (arrows /
 * swipe / Esc). Videos load only when played (preload="none"), posters first.
 */

const MAIN = { src: '/videos/films/film-5.mp4', poster: '/photos/films/film-5-poster.jpg' };
const REELS = [0, 1, 2, 3, 4].map((i) => ({ src: `/videos/films/film-${i}.mp4`, poster: `/photos/films/film-${i}-poster.jpg` }));

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);
const Chevron = ({ dir }: { dir: 'prev' | 'next' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d={dir === 'prev' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
  </svg>
);

export function GuestFilms({ isAr }: { isAr: boolean }) {
  const mainRef = useRef<HTMLVideoElement | null>(null);
  const [mainPlaying, setMainPlaying] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const [open, setOpen] = useState<number | null>(null);
  const t = (ar: string, en: string) => (isAr ? ar : en);

  const playMain = () => {
    const v = mainRef.current;
    if (!v) return;
    v.play().then(() => setMainPlaying(true)).catch(() => setMainPlaying(false));
  };
  const fullMain = () => {
    const v = mainRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
    else v.webkitEnterFullscreen?.(); // iPhone Safari
    if (v.paused) playMain();
  };

  // Arrow state: hide the arrow at each end of the row (RTL-aware).
  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    setEdge({ start: pos <= 4, end: pos >= max - 4 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const scrollRow = (dir: 'prev' | 'next') => {
    const el = rowRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.gf-card');
    const step = (card?.offsetWidth ?? 220) + 14;
    const rtl = getComputedStyle(el).direction === 'rtl';
    el.scrollBy({ left: (dir === 'next' ? 1 : -1) * (rtl ? -1 : 1) * step, behavior: 'smooth' });
  };

  return (
    <>
      <div className="gf-stage">
        <video
          ref={mainRef}
          src={MAIN.src}
          poster={MAIN.poster}
          preload="none"
          playsInline
          controls={mainPlaying}
          onPause={() => setMainPlaying(!mainRef.current?.paused)}
          onPlay={() => setMainPlaying(true)}
          onEnded={() => setMainPlaying(false)}
        />
        {!mainPlaying && (
          <>
            <button className="play-btn" aria-label={t('تشغيل الفيديو', 'Play video')} onClick={playMain}>
              <PlayIcon />
            </button>
            <div className="cap">
              <b>{t('يوم في فيلا ليلى', 'A day at Villa Layla')}</b>
              <span>{t('بعدسة ضيوفنا', 'Filmed by our guests')}</span>
            </div>
          </>
        )}
        <button className="gf-full" aria-label={t('ملء الشاشة', 'Full screen')} onClick={fullMain}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>

      <div className="gf-row-wrap">
        <button className="gf-arrow prev" aria-label={t('السابق', 'Previous')} onClick={() => scrollRow('prev')} disabled={edge.start}>
          <Chevron dir={isAr ? 'next' : 'prev'} />
        </button>
        <div className="gf-row" ref={rowRef} onScroll={measure}>
          {REELS.map((r, i) => (
            <button key={r.src} className="gf-card" onClick={() => setOpen(i)} aria-label={t(`تشغيل ريلز ${i + 1}`, `Play reel ${i + 1}`)}>
              <img src={r.poster} alt="" loading="lazy" />
              <span className="gf-card-play">
                <PlayIcon />
              </span>
            </button>
          ))}
        </div>
        <button className="gf-arrow next" aria-label={t('التالي', 'Next')} onClick={() => scrollRow('next')} disabled={edge.end}>
          <Chevron dir={isAr ? 'prev' : 'next'} />
        </button>
      </div>

      {open !== null && <ReelModal index={open} onIndex={setOpen} onClose={() => setOpen(null)} isAr={isAr} />}
    </>
  );
}

function ReelModal({ index, onIndex, onClose, isAr }: { index: number; onIndex: (i: number) => void; onClose: () => void; isAr: boolean }) {
  const n = REELS.length;
  const go = useCallback((d: number) => onIndex((index + d + n) % n), [index, n, onIndex]);
  const touch = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(isAr ? -1 : 1);
      if (e.key === 'ArrowLeft') go(isAr ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose, isAr]);

  const r = REELS[index];
  return (
    <div className="gf-modal" role="dialog" aria-modal="true" aria-label={isAr ? 'فيديو' : 'Video'} onClick={onClose}>
      <div
        className="gf-modal-box"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touch.current === null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (Math.abs(dx) > 50) go((dx < 0 ? 1 : -1) * (isAr ? -1 : 1));
        }}
      >
        <video key={r.src} src={r.src} poster={r.poster} autoPlay playsInline controls />
        <button className="gf-close" aria-label={isAr ? 'إغلاق' : 'Close'} onClick={onClose}>
          ×
        </button>
        <button className="gf-arrow prev in" aria-label={isAr ? 'السابق' : 'Previous'} onClick={() => go(-1)}>
          <Chevron dir={isAr ? 'next' : 'prev'} />
        </button>
        <button className="gf-arrow next in" aria-label={isAr ? 'التالي' : 'Next'} onClick={() => go(1)}>
          <Chevron dir={isAr ? 'prev' : 'next'} />
        </button>
        <span className="gf-count" dir="ltr">
          {index + 1} / {n}
        </span>
      </div>
    </div>
  );
}
