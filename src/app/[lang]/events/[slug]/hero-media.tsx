'use client';

import { useEffect, useState } from 'react';

/**
 * Top of the event page: the event's own video (silent loop) or a slow slideshow of its page photos.
 * Falls back to the cover photo. The cover stays the image on the event cards and in shared links.
 */
export function HeroMedia({ video, photos, cover }: { video: string | null; photos: string[]; cover: string | null }) {
  const [i, setI] = useState(0);
  const [reduce, setReduce] = useState(false);
  useEffect(() => { setReduce(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false); }, []);
  useEffect(() => {
    if (video || photos.length < 2 || reduce) return;
    const t = setInterval(() => setI((x) => (x + 1) % photos.length), 5000);
    return () => clearInterval(t);
  }, [video, photos.length, reduce]);

  if (video && !reduce) return <video className="evd-hero-media" src={video} poster={photos[0] ?? cover ?? undefined} autoPlay muted loop playsInline preload="metadata" aria-hidden />;
  const list = photos.length ? photos : cover ? [cover] : [];
  return (
    <>
      {list.map((src, k) => <img key={src} src={src} alt="" className={`evd-hero-media ${k === i ? 'on' : ''}`} aria-hidden={k !== i} />)}
    </>
  );
}
