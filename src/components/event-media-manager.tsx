'use client';

import { useRef, useState } from 'react';
import { Icon } from '@/components/icons';

type Item = { id: string; kind: 'meal' | 'video' | 'gallery' | 'hero'; src: string; external: boolean; orientation: 'landscape' | 'portrait'; size?: number | null; mime?: string | null };
type Job = { name: string; size: number; sent: number; state: 'waiting' | 'sending' | 'done' | 'error'; msg?: string };

const CHUNK = 8 * 1024 * 1024;
const mb = (n: number) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.max(0.1, n / 1024 / 1024).toFixed(1)} MB`);
const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold';
const BTN = `${btn} bg-cocoa-800 text-white hover:bg-cocoa-900 disabled:opacity-50`;
const GHOST = `${btn} border border-cocoa-200 bg-white text-cocoa-800 hover:border-cocoa-600`;

async function uploadFile(file: File, eventId: string, kind: 'meal' | 'video' | 'hero', orientation: string, onProgress: (sent: number) => void) {
  const uploadId = crypto.randomUUID();
  const count = Math.max(1, Math.ceil(file.size / CHUNK));
  let offset = 0;
  let index = 0;
  while (offset < file.size || (file.size === 0 && index === 0)) {
    const piece = file.slice(offset, Math.min(file.size, offset + CHUNK));
    let tries = 0;
    for (;;) {
      try {
        const res = await fetch('/api/dashboard/event-media/chunk', {
          method: 'POST', body: piece,
          headers: {
            'x-upload-id': uploadId, 'x-event-id': eventId, 'x-chunk-index': String(index), 'x-chunk-count': String(count), 'x-offset': String(offset),
            'x-file-size': String(file.size), 'x-file-type': file.type || (kind === 'meal' ? 'image/jpeg' : 'video/mp4'), 'x-file-name': encodeURIComponent(file.name), 'x-kind': kind, 'x-orientation': orientation,
          },
        });
        const j = await res.json().catch(() => ({}));
        if (res.status === 409 && j.error === 'resume' && typeof j.have === 'number') { offset = j.have; index = Math.floor(offset / CHUNK); break; }
        if (!res.ok) throw Object.assign(new Error(j.error || `Upload failed (${res.status})`), { fatal: res.status < 500 && res.status !== 408 && res.status !== 429 });
        offset += piece.size; index += 1; onProgress(offset);
        break;
      } catch (e: any) {
        if (e?.fatal || ++tries >= 5) throw e;
        await new Promise((r) => setTimeout(r, 1500 * tries)); // network blip: try the same piece again
      }
    }
    if (file.size === 0) break;
  }
}

/**
 * Meal photos and videos of an event, inside the event form. Files go up in 8 MB pieces with a progress bar,
 * so a long video of several GB is fine and a dropped connection resumes instead of failing.
 */
export function EventMediaManager({ eventId, items: initial }: { eventId: string | null; items: Item[] }) {
  const [items, setItems] = useState(initial);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [shape, setShape] = useState<'landscape' | 'portrait'>('landscape');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const busy = jobs.some((j) => j.state === 'sending' || j.state === 'waiting');
  const videoInput = useRef<HTMLInputElement | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const meals = items.filter((i) => i.kind === 'meal');
  const hero = items.filter((i) => i.kind === 'hero');
  const heroInput = useRef<HTMLInputElement | null>(null);
  const videos = items.filter((i) => i.kind === 'video');

  if (!eventId) {
    return (
      <div className="rounded-xl border border-dashed border-cocoa-300 bg-cocoa-50 p-4 text-sm text-cocoa-700">
        <p className="flex items-center gap-2 font-semibold"><Icon name="upload" size={16} /> Meal photos and videos</p>
        <p className="mt-1">Press <b>Create and publish</b> first. The page reopens with the upload buttons for photos and videos (any size) right here.</p>
      </div>
    );
  }

  const refresh = () => { window.location.replace(window.location.pathname + '?ok=' + encodeURIComponent('Saved · shown on the event page') + '#media'); };

  async function send(files: FileList | null, kind: 'meal' | 'video' | 'hero') {
    if (!files?.length) return;
    setError('');
    const list = Array.from(files);
    const start = jobs.length;
    setJobs((j) => [...j, ...list.map((f) => ({ name: f.name, size: f.size, sent: 0, state: 'waiting' as const }))]);
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      const set = (p: Partial<Job>) => setJobs((j) => j.map((x, k) => (k === start + i ? { ...x, ...p } : x)));
      set({ state: 'sending' });
      try { await uploadFile(list[i], eventId!, kind, shape, (sent) => set({ sent })); set({ state: 'done', sent: list[i].size }); }
      catch (e: any) { failed++; set({ state: 'error', msg: e?.message || 'Failed' }); }
    }
    if (!failed) refresh();
  }

  async function act(body: Record<string, unknown>) {
    setError('');
    const res = await fetch('/api/dashboard/event-media/item', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventId, ...body }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setError(j.error || 'Failed'); return false; }
    return true;
  }

  return (
    <div className="space-y-5">
      {/* Top of the event page */}
      <div>
        <p className="mb-1 text-sm font-semibold text-cocoa-800">Event page look ({hero.length})</p>
        <p className="mb-2 text-xs text-slate-500">Photos or one video for the top of this event's own page. The cover photo stays on the event cards and when the link is shared. Several photos turn into a slideshow; a video plays silently in a loop.</p>
        {hero.length > 0 && (
          <ul className="mb-2 grid grid-cols-3 gap-2">
            {hero.map((m) => (
              <li key={m.id} className="relative">
                {m.mime?.startsWith('video/')
                  ? <video src={m.src} muted preload="metadata" className="aspect-video w-full rounded-lg bg-black object-cover" />
                  : <img src={m.src} alt="" className="aspect-video w-full rounded-lg object-cover" />}
                <button type="button" className="absolute right-1 top-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-red-800 shadow"
                  onClick={async () => { if (await act({ op: 'delete', id: m.id })) setItems((s) => s.filter((x) => x.id !== m.id)); }}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <input ref={heroInput} type="file" accept="image/*,video/*" multiple className="sr-only" onChange={(e) => { void send(e.target.files, 'hero'); e.target.value = ''; }} />
        <button type="button" className={`${GHOST} w-full justify-center py-2.5`} disabled={busy} onClick={() => heroInput.current?.click()}><Icon name="upload" size={16} /> Add photos or a video for the page top</button>
      </div>

      {/* Videos */}
      <div className="border-t border-cocoa-100 pt-4">
        <p className="mb-2 flex items-center justify-between text-sm font-semibold text-cocoa-800"><span>Videos ({videos.length})</span><span className="text-xs font-normal text-slate-500">Any size · MP4, MOV, WebM</span></p>
        <div className="mb-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Video shape">
          {(['landscape', 'portrait'] as const).map((o) => (
            <button key={o} type="button" role="radio" aria-checked={shape === o} onClick={() => setShape(o)}
              className={`${btn} border ${shape === o ? 'border-cocoa-800 bg-cocoa-800 text-white' : 'border-cocoa-200 bg-white text-cocoa-800'}`}>
              <span className={`inline-block rounded-sm border-2 border-current ${o === 'landscape' ? 'h-3 w-5' : 'h-5 w-3'}`} aria-hidden />
              {o === 'landscape' ? 'Wide 16:9' : 'Tall 9:16 (Reels)'}
            </button>
          ))}
        </div>
        <input ref={videoInput} type="file" accept="video/*" multiple className="sr-only" onChange={(e) => { void send(e.target.files, 'video'); e.target.value = ''; }} />
        <button type="button" className={`${BTN} w-full justify-center py-3`} disabled={busy} onClick={() => videoInput.current?.click()}><Icon name="upload" size={18} /> Upload video</button>
        <div className="mt-2 flex gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} dir="ltr" placeholder="or paste a YouTube / Instagram link" aria-label="Video link"
            className="min-w-0 flex-1 rounded-lg border border-cocoa-200 bg-white px-3 py-2 text-sm" />
          <button type="button" className={GHOST} disabled={!link.trim()} onClick={async () => { if (await act({ op: 'link', url: link, orientation: shape })) refresh(); }}>Add link</button>
        </div>
        {videos.length > 0 && (
          <ul className="mt-3 space-y-2">
            {videos.map((v, i) => (
              <li key={v.id} className="flex items-center gap-3 rounded-lg border border-cocoa-100 bg-white p-2 text-sm">
                {v.external ? <span className="grid h-14 w-20 shrink-0 place-items-center rounded-md bg-cocoa-100 text-xs text-cocoa-700">Link</span>
                  : <video src={v.src} className={`shrink-0 rounded-md bg-black object-cover ${v.orientation === 'portrait' ? 'h-16 w-9' : 'h-14 w-24'}`} muted preload="metadata" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{v.external ? v.src : `Video ${i + 1}`}</span>
                  <span className="text-xs text-slate-500">{v.orientation === 'portrait' ? 'Tall 9:16' : 'Wide 16:9'}{v.size ? ` · ${mb(v.size)}` : ''}</span>
                </span>
                <button type="button" className="text-xs font-semibold text-cocoa-700 underline" onClick={async () => { const o = v.orientation === 'portrait' ? 'landscape' : 'portrait'; if (await act({ op: 'shape', id: v.id, orientation: o })) setItems((s) => s.map((x) => (x.id === v.id ? { ...x, orientation: o } : x))); }}>
                  Make {v.orientation === 'portrait' ? 'wide' : 'tall'}
                </button>
                <button type="button" className="text-xs font-semibold text-red-800 underline" onClick={async () => { if (confirm('Remove this video from the website?') && (await act({ op: 'delete', id: v.id }))) setItems((s) => s.filter((x) => x.id !== v.id)); }}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Meal photos */}
      <div className="border-t border-cocoa-100 pt-4">
        <p className="mb-2 text-sm font-semibold text-cocoa-800">Meal photos ({meals.length})</p>
        {meals.length > 0 && (
          <ul className="mb-3 grid grid-cols-3 gap-2">
            {meals.map((m) => (
              <li key={m.id} className="relative">
                <img src={m.src} alt="" className="aspect-square w-full rounded-lg object-cover" />
                <button type="button" className="absolute right-1 top-1 rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-red-800 shadow"
                  onClick={async () => { if (await act({ op: 'delete', id: m.id })) setItems((s) => s.filter((x) => x.id !== m.id)); }}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <input ref={photoInput} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void send(e.target.files, 'meal'); e.target.value = ''; }} />
        <button type="button" className={`${GHOST} w-full justify-center py-2.5`} disabled={busy} onClick={() => photoInput.current?.click()}><Icon name="upload" size={16} /> Add meal photos</button>
      </div>

      {jobs.length > 0 && (
        <ul className="space-y-2" aria-live="polite">
          {jobs.map((j, i) => {
            const pct = j.size ? Math.round((j.sent / j.size) * 100) : 0;
            return (
              <li key={i} className="rounded-lg border border-cocoa-100 bg-white p-2 text-xs">
                <div className="flex justify-between gap-2"><span className="truncate font-medium">{j.name}</span>
                  <span className={j.state === 'error' ? 'text-red-800' : 'text-slate-600'}>{j.state === 'error' ? j.msg : j.state === 'done' ? 'Done' : j.state === 'waiting' ? 'Waiting' : `${pct}% · ${mb(j.sent)} of ${mb(j.size)}`}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-cocoa-100"><div className={`h-full rounded-full ${j.state === 'error' ? 'bg-red-600' : 'bg-cocoa-700'}`} style={{ width: `${j.state === 'done' ? 100 : pct}%` }} /></div>
              </li>
            );
          })}
        </ul>
      )}
      {busy && <p className="text-xs text-amber-800">Keep this page open until the upload finishes.</p>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </div>
  );
}
