'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type Story = { id: string; type: 'photo' | 'video' | 'embed'; src: string };

const PHOTO_MS = 5000;

/**
 * The event's photos and videos as Instagram-style stories: a row of tall 9:16 cards; a tap opens them full screen
 * one after the other with progress bars at the top. Tap the right side for the next, the left for the one before
 * (mirrored in Arabic), hold to pause, swipe down or × to close.
 */
export function StoryStrip({ stories, ar, title }: { stories: Story[]; ar: boolean; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!stories.length) return null;
  return (
    <>
      <div className="st-row" role="list">
        {stories.map((s, i) => (
          <button key={s.id} type="button" role="listitem" className="st-card" onClick={() => setOpen(i)} aria-label={(ar ? 'افتح الستوري ' : 'Open story ') + (i + 1)}>
            {s.type === 'photo' ? <img src={s.src} alt="" loading="lazy" decoding="async" />
              : s.type === 'video' ? <video src={s.src + '#t=0.1'} muted playsInline preload="metadata" />
              : <span className="st-embed-thumb" aria-hidden>▶</span>}
            {s.type !== 'photo' && <span className="st-play" aria-hidden><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>}
          </button>
        ))}
      </div>
      {open !== null && <StoryViewer stories={stories} start={open} ar={ar} title={title} onClose={() => setOpen(null)} />}
    </>
  );
}

function StoryViewer({ stories, start, ar, title, onClose }: { stories: Story[]; start: number; ar: boolean; title: string; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [progress, setProgress] = useState(0); // 0..1 of the current story
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const vid = useRef<HTMLVideoElement | null>(null);
  const touchY = useRef<number | null>(null);
  const pressAt = useRef(0);
  const s = stories[i];

  const next = useCallback(() => { if (i < stories.length - 1) { setI(i + 1); setProgress(0); } else onClose(); }, [i, stories.length, onClose]);
  const prev = useCallback(() => { if (i > 0) { setI(i - 1); setProgress(0); } else setProgress(0); }, [i]);

  // Photos advance after 5 s; videos follow their own time; links (YouTube / Instagram) wait for a tap.
  useEffect(() => {
    if (s.type !== 'photo' || paused) return;
    const t0 = performance.now() - progress * PHOTO_MS;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / PHOTO_MS);
      setProgress(p);
      if (p >= 1) next(); else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, paused, s.type]);

  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (paused) v.pause(); else v.play().catch(() => { setMuted(true); v.muted = true; v.play().catch(() => {}); });
  }, [paused, i]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') (ar ? prev : next)();
      if (e.key === 'ArrowLeft') (ar ? next : prev)();
      if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
    };
    window.addEventListener('keydown', k);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prevOverflow; };
  }, [next, prev, onClose, ar]);

  // Tap zones: the side the text starts from goes back, the other side goes on.
  const onTap = (e: React.MouseEvent<HTMLDivElement>) => {
    if (performance.now() - pressAt.current > 300) return; // a long press only paused
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const back = ar ? x > 0.66 : x < 0.34;
    if (back) prev(); else next();
  };

  return createPortal(
    <div className="st-scrim" role="dialog" aria-modal="true" aria-label={title} dir={ar ? 'rtl' : 'ltr'}
      onTouchStart={(e) => { touchY.current = e.touches[0].clientY; }}
      onTouchEnd={(e) => { if (touchY.current != null && e.changedTouches[0].clientY - touchY.current > 90) onClose(); touchY.current = null; }}>
      <div className="st-frame">
        <div className="st-bars" aria-hidden>
          {stories.map((_, k) => <span key={k}><i style={{ width: `${k < i ? 100 : k === i ? progress * 100 : 0}%` }} /></span>)}
        </div>
        <div className="st-top">
          <b>{title}</b>
          <span className="st-acts">
            {s.type === 'video' && <button type="button" onClick={() => { const m = !muted; setMuted(m); if (vid.current) vid.current.muted = m; }} aria-label={muted ? (ar ? 'شغّل الصوت' : 'Sound on') : (ar ? 'اكتم الصوت' : 'Mute')}>{muted ? '🔇' : '🔊'}</button>}
            {s.type !== 'embed' && <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? (ar ? 'كمّل' : 'Play') : (ar ? 'وقّف' : 'Pause')}>{paused ? '▶' : '❚❚'}</button>}
            <button type="button" onClick={onClose} aria-label={ar ? 'إغلاق' : 'Close'}>×</button>
          </span>
        </div>
        <div className="st-media">
          {s.type === 'photo' && <img key={s.id} src={s.src} alt="" />}
          {s.type === 'video' && (
            <video key={s.id} ref={vid} src={s.src} autoPlay playsInline muted={muted}
              onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
              onEnded={next} />
          )}
          {s.type === 'embed' && <iframe key={s.id} src={s.src} title={title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />}
        </div>
        {/* Tap zones (not over a link player, which needs its own taps) */}
        {s.type !== 'embed'
          ? <div className="st-tap" onClick={onTap} onPointerDown={() => { pressAt.current = performance.now(); setPaused(true); }} onPointerUp={() => setPaused(false)} onPointerLeave={() => setPaused(false)} />
          : <div className="st-nav"><button type="button" onClick={ar ? next : prev} aria-label={ar ? 'التالي' : 'Previous'}>‹</button><button type="button" onClick={ar ? prev : next} aria-label={ar ? 'السابق' : 'Next'}>›</button></div>}
      </div>
    </div>,
    document.body,
  );
}
