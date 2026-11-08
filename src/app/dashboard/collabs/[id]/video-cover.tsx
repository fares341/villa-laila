'use client';

import { useRef, useState } from 'react';
import { upload } from '@/components/site-manager';

/**
 * Video cover of a collab event, inside the Covers card. The video is sent in pieces while you keep editing (any size,
 * resumes after a dropped connection); its address goes into the form and is saved with «Save changes».
 */
export function VideoCover({ current }: { current: string | null }) {
  const [url, setUrl] = useState(current ?? '');
  const [pct, setPct] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const pick = async () => {
    const f = ref.current?.files?.[0];
    if (!f) return;
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm)$/i.test(f.name)) { setBad(true); setMsg('Choose a video file (MP4, MOV…)'); return; }
    const form = ref.current?.form;
    form?.setAttribute('data-busy', String(Number(form.getAttribute('data-busy') || 0) + 1));
    setBad(false); setPct(0); setMsg(`Uploading ${f.name}…`);
    try {
      const u = await upload(f, 'video', (sent) => setPct(Math.round((sent / f.size) * 100)));
      setUrl(u); setMsg('Video uploaded ✓ Press «Save changes» to put it on the page.');
    } catch (e: any) {
      setBad(true); setMsg(e?.message || 'Upload failed, try again');
    } finally {
      setPct(null);
      if (ref.current) ref.current.value = '';
      form?.setAttribute('data-busy', String(Math.max(0, Number(form.getAttribute('data-busy') || 1) - 1)));
    }
  };

  return (
    <div className="grid content-start gap-2">
      <p className="text-sm font-semibold text-cocoa-800">Video cover</p>
      {url
        ? <video src={url} className="aspect-video w-full rounded-lg border border-cocoa-200 bg-black object-cover" muted loop playsInline autoPlay controls />
        : <span className="grid aspect-video w-full place-items-center rounded-lg bg-cocoa-50 px-3 text-center text-xs text-slate-500">No video · the inside cover photo is shown</span>}
      <input type="hidden" name="coverVideo" value={url} />
      <input ref={ref} type="file" accept="video/*" aria-label="Video cover" onChange={() => { void pick(); }} disabled={pct != null}
        className="w-full rounded-lg border border-cocoa-200 bg-white px-3 py-2 text-sm" />
      {pct != null && <div className="h-2 overflow-hidden rounded-full bg-cocoa-100"><div className="h-full bg-cocoa-700 transition-all" style={{ width: `${pct}%` }} /></div>}
      {msg && <p role="status" className={`text-xs ${bad ? 'text-red-700' : 'text-emerald-700'}`}>{msg}{pct != null ? ` ${pct}%` : ''}</p>}
      <p className="text-xs text-slate-500">Plays silently on a loop at the top of the event page (MP4 or MOV, any size). The photo covers stay for the events list and shared links.</p>
      {url && <label className="flex items-center gap-2 text-sm text-red-700"><input type="checkbox" name="removeCoverVideo" /> Remove the video</label>}
    </div>
  );
}
