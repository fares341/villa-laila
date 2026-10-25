'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Guest films, Instagram style.
 *
 *  - Profile bar (logo ring, @villalaylacairo, Follow).
 *  - The wide film: a cinema stage with an ambient glow of its own poster, a pulsing play button,
 *    full screen.
 *  - The 5 reels: a swipeable row (arrows on desktop) of 9:16 cards with the Instagram ring;
 *    on desktop a card plays a silent preview on hover.
 *  - A reel opens in a story-style viewer: progress bars, auto-next at the end, tap left/right,
 *    swipe, keys, sound on/off, "Open on Instagram".
 *
 * Videos load only when played or previewed (preload="none"); posters first.
 */

const IG = 'https://instagram.com/villalaylacairo';
const HANDLE = '@villalaylacairo';
const MAIN = { src: '/videos/films/film-5.mp4', poster: '/photos/films/film-5-poster.jpg' };
const REELS = [0, 1, 2, 3, 4].map((i) => ({ src: `/videos/films/film-${i}.mp4`, poster: `/photos/films/film-${i}-poster.jpg` }));

const Svg = ({ d, fill = false, size = 20 }: { d: string; fill?: boolean; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const P = {
  play: 'M8 5v14l11-7z',
  prev: 'm15 18-6-6 6-6',
  next: 'm9 18 6-6-6-6',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  close: 'M18 6 6 18M6 6l12 12',
  soundOn: 'M11 5 6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  soundOff: 'M11 5 6 9H3v6h3l5 4V5zM22 9l-6 6M16 9l6 6',
  reel: 'M3 7h18M8 3l3 4M14 3l3 4M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM10 11v6l5-3z',
  ig: 'M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zM16 11.4A4 4 0 1 1 12.6 8a4 4 0 0 1 3.4 3.4zM17.5 6.5h.01',
};

function Avatar({ size = 44 }: { size?: number }) {
  return (
    <span className="gf-ava" style={{ width: size, height: size }}>
      <span>
        <img src="/assets/logo-240.webp" alt="" />
      </span>
    </span>
  );
}

export function GuestFilms({ isAr }: { isAr: boolean }) {
  const t = (ar: string, en: string) => (isAr ? ar : en);
  const mainRef = useRef<HTMLVideoElement | null>(null);
  const [mainOn, setMainOn] = useState(false);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const [open, setOpen] = useState<number | null>(null);

  const playMain = () => {
    const v = mainRef.current;
    if (!v) return;
    setMainOn(true);
    v.play().catch(() => setMainOn(false));
  };
  const fullMain = () => {
    const v = mainRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    if (v.requestFullscreen) v.requestFullscreen().catch(() => {});
    else v.webkitEnterFullscreen?.();
    if (v.paused) playMain();
  };

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

  const scrollRow = (dir: 1 | -1) => {
    const el = rowRef.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.gf-card');
    const step = ((card?.offsetWidth ?? 220) + 16) * (window.innerWidth > 900 ? 2 : 1);
    const rtl = getComputedStyle(el).direction === 'rtl';
    el.scrollBy({ left: dir * (rtl ? -1 : 1) * step, behavior: 'smooth' });
  };

  // Silent preview on hover (desktop pointers only).
  const preview = (e: React.MouseEvent<HTMLButtonElement>, on: boolean) => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const v = e.currentTarget.querySelector('video');
    if (!v) return;
    if (on) { v.muted = true; v.play().catch(() => {}); }
    else { v.pause(); try { v.currentTime = 0; } catch {} }
  };

  return (
    <div className="gf">
      <div className="gf-profile">
        <a className="gf-who" href={IG} target="_blank" rel="noopener noreferrer">
          <Avatar />
          <span>
            <b dir="ltr">{HANDLE}</b>
            <small>{t('فيلا ليلى · القاهرة', 'Villa Layla · Cairo')}</small>
          </span>
        </a>
        <a className="gf-follow" href={IG} target="_blank" rel="noopener noreferrer">
          <Svg d={P.ig} size={18} /> {t('تابعنا', 'Follow')}
        </a>
      </div>

      <div className={`gf-stage ${mainOn ? 'on' : ''}`} style={{ ['--poster' as string]: `url(${MAIN.poster})` }}>
        <div className="gf-stage-in">
          <video
            ref={mainRef}
            src={MAIN.src}
            poster={MAIN.poster}
            preload="none"
            playsInline
            controls={mainOn}
            onPlay={() => setMainOn(true)}
            onEnded={() => setMainOn(false)}
          />
          {!mainOn && (
            <button className="gf-big-play" onClick={playMain} aria-label={t('تشغيل الفيلم', 'Play the film')}>
              <span className="gf-pulse" aria-hidden="true" />
              <span className="gf-big-play-btn"><Svg d={P.play} fill size={30} /></span>
              <span className="gf-big-play-t">{t('شاهد الفيلم', 'Watch the film')}</span>
            </button>
          )}
          {!mainOn && (
            <div className="gf-cap">
              <span className="gf-chip"><Svg d={P.reel} size={14} /> {t('فيلم الفيلا', 'Villa film')}</span>
              <b>{t('يوم في فيلا ليلى', 'A day at Villa Layla')}</b>
            </div>
          )}
          <button className="gf-full" aria-label={t('ملء الشاشة', 'Full screen')} onClick={fullMain}>
            <Svg d={P.full} />
          </button>
        </div>
      </div>

      <div className="gf-reels-hd">
        <b><Svg d={P.reel} size={18} /> {t('ريلز من الفيلا', 'Reels from the villa')}</b>
        <span className="gf-reels-nav">
          <button className="gf-arrow" aria-label={t('السابق', 'Previous')} onClick={() => scrollRow(-1)} disabled={edge.start}>
            <Svg d={isAr ? P.next : P.prev} />
          </button>
          <button className="gf-arrow" aria-label={t('التالي', 'Next')} onClick={() => scrollRow(1)} disabled={edge.end}>
            <Svg d={isAr ? P.prev : P.next} />
          </button>
        </span>
      </div>
      <div className={`gf-row-wrap ${edge.start ? '' : 'fade-s'} ${edge.end ? '' : 'fade-e'}`}>
        <div className="gf-row" ref={rowRef} onScroll={measure}>
          {REELS.map((r, i) => (
            <button
              key={r.src}
              className="gf-card"
              onClick={() => setOpen(i)}
              onMouseEnter={(e) => preview(e, true)}
              onMouseLeave={(e) => preview(e, false)}
              aria-label={t(`شاهد الريل ${i + 1}`, `Watch reel ${i + 1}`)}
            >
              <span className="gf-card-in">
                <img src={r.poster} alt="" loading="lazy" />
                <video src={r.src} muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1} />
                <span className="gf-card-top"><Svg d={P.reel} size={16} /></span>
                <span className="gf-card-play"><Svg d={P.play} fill size={22} /></span>
                <span className="gf-card-ft">
                  <Avatar size={26} />
                  <span dir="ltr">{HANDLE}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {open !== null && <ReelViewer index={open} onIndex={setOpen} onClose={() => setOpen(null)} isAr={isAr} />}
    </div>
  );
}

function ReelViewer({ index, onIndex, onClose, isAr }: { index: number; onIndex: (i: number) => void; onClose: () => void; isAr: boolean }) {
  const n = REELS.length;
  const vRef = useRef<HTMLVideoElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const touch = useRef<{ x: number; t: number } | null>(null);
  const go = useCallback((d: number) => {
    const next = index + d;
    if (next < 0) return;
    if (next >= n) { onClose(); return; }
    onIndex(next);
  }, [index, n, onIndex, onClose]);

  useEffect(() => { setProgress(0); setPaused(false); }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(isAr ? -1 : 1);
      else if (e.key === 'ArrowLeft') go(isAr ? 1 : -1);
      else if (e.key === ' ') { e.preventDefault(); toggle(); }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  });

  const toggle = () => {
    const v = vRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => {}); setPaused(false); } else { v.pause(); setPaused(true); }
  };

  const r = REELS[index];
  return (
    <div className="gf-modal" role="dialog" aria-modal="true" aria-label={isAr ? 'ريلز فيلا ليلى' : 'Villa Layla reels'} onClick={onClose}>
      <div className="gf-modal-bg" style={{ backgroundImage: `url(${r.poster})` }} aria-hidden="true" />
      <button className="gf-arrow gf-side prev" aria-label={isAr ? 'السابق' : 'Previous'} onClick={(e) => { e.stopPropagation(); go(-1); }} disabled={index === 0}>
        <Svg d={isAr ? P.next : P.prev} />
      </button>
      <div
        className="gf-story"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, t: Date.now() }; }}
        onTouchEnd={(e) => {
          const s = touch.current; touch.current = null;
          if (!s) return;
          const dx = e.changedTouches[0].clientX - s.x;
          if (Math.abs(dx) > 50) go((dx < 0 ? 1 : -1) * (isAr ? -1 : 1));
        }}
      >
        <video
          key={r.src}
          ref={vRef}
          src={r.src}
          poster={r.poster}
          autoPlay
          playsInline
          muted={muted}
          onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
          onEnded={() => go(1)}
        />
        {/* Tap the left / right third to go back / on, the middle to pause (like Instagram). */}
        <button className="gf-tap s" aria-label={isAr ? 'السابق' : 'Previous'} onClick={() => go(-1)} />
        <button className="gf-tap m" aria-label={paused ? (isAr ? 'تشغيل' : 'Play') : (isAr ? 'إيقاف مؤقت' : 'Pause')} onClick={toggle} />
        <button className="gf-tap e" aria-label={isAr ? 'التالي' : 'Next'} onClick={() => go(1)} />
        {paused && <span className="gf-paused" aria-hidden="true"><Svg d={P.play} fill size={34} /></span>}

        <div className="gf-story-top">
          <div className="gf-bars">
            {REELS.map((_, i) => (
              <span key={i}><i style={{ transform: `scaleX(${i < index ? 1 : i === index ? progress : 0})` }} /></span>
            ))}
          </div>
          <div className="gf-story-hd">
            <span className="gf-story-who"><Avatar size={32} /><b dir="ltr">{HANDLE}</b></span>
            <span className="gf-story-act">
              <button aria-label={muted ? (isAr ? 'تشغيل الصوت' : 'Sound on') : (isAr ? 'كتم الصوت' : 'Mute')} onClick={() => setMuted((m) => !m)}>
                <Svg d={muted ? P.soundOff : P.soundOn} />
              </button>
              <button aria-label={isAr ? 'إغلاق' : 'Close'} onClick={onClose}><Svg d={P.close} /></button>
            </span>
          </div>
        </div>
        <a className="gf-story-cta" href={IG} target="_blank" rel="noopener noreferrer">
          <Svg d={P.ig} size={18} /> {isAr ? 'شاهد المزيد على إنستغرام' : 'More on Instagram'}
        </a>
      </div>
      <button className="gf-arrow gf-side next" aria-label={isAr ? 'التالي' : 'Next'} onClick={(e) => { e.stopPropagation(); go(1); }}>
        <Svg d={isAr ? P.prev : P.next} />
      </button>
    </div>
  );
}
