'use client';

import { useRef, useState } from 'react';
import { Icon } from '@/components/icons';

/* ───────── shared ───────── */

const CHUNK = 8 * 1024 * 1024;
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50';
const BTN = `${btn} bg-cocoa-800 text-white hover:bg-cocoa-900`;
const GHOST = `${btn} border border-cocoa-200 bg-white text-cocoa-800 hover:border-cocoa-600`;
const MINI = 'inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-white/95 px-1.5 text-[11px] font-bold text-cocoa-900 shadow disabled:opacity-40';
const INPUT = 'w-full rounded-lg border border-cocoa-200 bg-white px-3 py-2 text-sm outline-none focus:border-cocoa-600';
const LBL = 'mb-1 block text-xs font-semibold text-cocoa-700';
const mb = (n: number) => `${Math.max(0.1, n / 1024 / 1024).toFixed(1)} MB`;

type Loc = { ar?: string; en?: string };

/** Send one file in 8 MB pieces (resumes after a dropped connection); returns its address on the website. */
async function upload(file: File, want: 'photo' | 'video', onProgress: (sent: number) => void): Promise<string> {
  const uploadId = crypto.randomUUID();
  const count = Math.max(1, Math.ceil(file.size / CHUNK));
  let offset = 0, index = 0;
  for (;;) {
    const piece = file.slice(offset, Math.min(file.size, offset + CHUNK));
    let tries = 0;
    for (;;) {
      try {
        const res = await fetch('/api/dashboard/site/upload', {
          method: 'POST', body: piece,
          headers: {
            'x-upload-id': uploadId, 'x-chunk-index': String(index), 'x-chunk-count': String(count), 'x-offset': String(offset), 'x-file-size': String(file.size),
            'x-file-type': file.type || (want === 'video' ? 'video/mp4' : 'image/jpeg'), 'x-file-name': encodeURIComponent(file.name), 'x-want': want,
          },
        });
        const j = await res.json().catch(() => ({}));
        if (res.status === 409 && j.error === 'resume' && typeof j.have === 'number') { offset = j.have; index = Math.floor(offset / CHUNK); break; }
        if (!res.ok) throw Object.assign(new Error(j.error || `Upload failed (${res.status})`), { fatal: res.status < 500 && res.status !== 408 && res.status !== 429 });
        offset += piece.size; index += 1; onProgress(offset);
        if (j.done && j.url) return j.url as string;
        break;
      } catch (e: any) {
        if (e?.fatal || ++tries >= 5) throw e;
        await new Promise((r) => setTimeout(r, 1500 * tries));
      }
    }
  }
}

async function act(body: Record<string, unknown>): Promise<{ ok: boolean; out?: any; error?: string }> {
  const res = await fetch('/api/dashboard/site', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, out: j.out } : { ok: false, error: j.error || 'Failed' };
}

/** A button that opens a file picker and uploads; shows progress. */
function UploadButton({ want, multiple, label, onDone, className = GHOST }: { want: 'photo' | 'video'; multiple?: boolean; label: string; onDone: (urls: string[]) => Promise<void> | void; className?: string }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function go(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    const urls: string[] = [];
    const list = Array.from(files);
    try {
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        setStatus(`${list.length > 1 ? `${i + 1}/${list.length} · ` : ''}${f.name} · 0%`);
        urls.push(await upload(f, want, (sent) => setStatus(`${list.length > 1 ? `${i + 1}/${list.length} · ` : ''}${f.name} · ${Math.round((sent / f.size) * 100)}% of ${mb(f.size)}`)));
      }
      setStatus('Saving…');
      await onDone(urls);
      setStatus(null);
    } catch (e: any) { setStatus(null); setErr(e?.message || 'Upload failed'); }
  }
  return (
    <span className="inline-flex flex-col gap-1">
      <input ref={ref} type="file" accept={want === 'video' ? 'video/*' : 'image/*'} multiple={multiple} className="sr-only" onChange={(e) => { void go(e.target.files); e.target.value = ''; }} />
      <button type="button" className={className} disabled={!!status} onClick={() => ref.current?.click()}><Icon name="upload" size={15} /> {status ?? label}</button>
      {err && <span className="text-xs font-semibold text-red-700">{err}</span>}
    </span>
  );
}

const Notice = ({ msg }: { msg: { ok: boolean; t: string } | null }) => msg ? <p className={`rounded-lg px-3 py-2 text-sm font-semibold ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{msg.t}</p> : null;

/* ───────── Room photos ───────── */

type Room = { id: string; code: string; name: Loc; active: boolean; photos: string[] };

export function RoomPhotosManager({ rooms: initial }: { rooms: Room[] }) {
  const [rooms, setRooms] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function edit(room: Room, e: Record<string, unknown>, done: string) {
    const r = await act({ op: 'room.photos', id: room.id, edit: e });
    if (!r.ok) { setMsg({ ok: false, t: r.error! }); return; }
    setRooms((all) => all.map((x) => (x.id === room.id ? { ...x, photos: r.out } : x)));
    setMsg({ ok: true, t: `${room.name.en || room.code}: ${done}` });
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-600">These are the photos on the website: the home page room cards and each room’s own page. The <b>first photo is the cover</b>. Upload as many as you like (JPG, PNG, WebP), put them in order with the arrows, or remove them.</p>
      <Notice msg={msg} />
      {rooms.map((room) => (
        <section key={room.id} className="rounded-2xl border border-cocoa-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-bold text-cocoa-900">{room.name.en || room.code} <span className="font-normal text-slate-500">· {room.name.ar}</span>{!room.active && <span className="ms-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">not on sale</span>}</h3>
            <UploadButton want="photo" multiple label="Add photos" className={BTN} onDone={(urls) => edit(room, { add: urls }, `${urls.length} photo${urls.length > 1 ? 's' : ''} added`)} />
          </div>
          {room.photos.length === 0 ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">No photos yet — the website shows a plain placeholder.</p> : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {room.photos.map((p, i) => (
                <li key={p} className={`relative overflow-hidden rounded-xl border ${i === 0 ? 'border-amber-400 ring-2 ring-amber-300' : 'border-cocoa-100'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.includes('imgix.net') ? `${p}?w=400&auto=format&fit=crop` : p} alt="" loading="lazy" className="aspect-[4/3] w-full bg-cocoa-50 object-cover" />
                  {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-md bg-amber-400 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">Cover</span>}
                  <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
                    <span className="flex gap-1">
                      <button type="button" className={MINI} title="Move earlier" disabled={i === 0} onClick={() => edit(room, { move: { from: i, dir: -1 } }, 'order saved')}>←</button>
                      <button type="button" className={MINI} title="Move later" disabled={i === room.photos.length - 1} onClick={() => edit(room, { move: { from: i, dir: 1 } }, 'order saved')}>→</button>
                      {i !== 0 && <button type="button" className={MINI} title="Make it the cover" onClick={() => edit(room, { cover: i }, 'new cover')}>★</button>}
                    </span>
                    <button type="button" className={`${MINI} text-red-700`} title="Remove" onClick={() => { if (confirm('Remove this photo from the website?')) void edit(room, { remove: i }, 'photo removed'); }}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/* ───────── Day trips ───────── */

type Tour = { id: string; active: boolean; name: Loc; duration: Loc; tag: Loc; included: { ar?: string[]; en?: string[] }; excluded: Loc; image: string | null };
const blank: Tour = { id: '', active: true, name: {}, duration: {}, tag: {}, included: {}, excluded: {}, image: null };

function TourForm({ tour, onSaved, onCancel }: { tour: Tour; onSaved: (msg: string) => void; onCancel?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(tour.image);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const fields = Object.fromEntries(new FormData(e.currentTarget).entries());
    const r = await act({ op: 'tour.save', id: tour.id || undefined, fields: { ...fields, image } });
    setBusy(false);
    if (!r.ok) { setErr(r.error!); return; }
    onSaved(tour.id ? 'Trip saved · live on the website' : 'Trip added · live on the website');
  }
  const two = (label: string, nameAr: string, nameEn: string, ar = '', en = '', area = false) => (
    <div className="grid gap-2 sm:grid-cols-2">
      <div><label className={LBL}>{label} (Arabic)</label>{area ? <textarea name={nameAr} dir="rtl" rows={4} defaultValue={ar} className={INPUT} /> : <input name={nameAr} dir="rtl" defaultValue={ar} className={INPUT} />}</div>
      <div><label className={LBL}>{label} (English)</label>{area ? <textarea name={nameEn} rows={4} defaultValue={en} className={INPUT} /> : <input name={nameEn} defaultValue={en} className={INPUT} />}</div>
    </div>
  );
  return (
    <form onSubmit={submit} className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="sm:w-56 sm:flex-none">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {image ? <img src={image} alt="" className="aspect-[4/3] w-full rounded-xl bg-cocoa-50 object-cover" /> : <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-cocoa-50 text-xs text-slate-500">No photo</div>}
          <div className="mt-2"><UploadButton want="photo" label={image ? 'Change photo' : 'Upload photo'} onDone={(urls) => setImage(urls[0])} /></div>
        </div>
        <div className="grid min-w-0 flex-1 gap-2">
          {two('Trip name', 'nameAr', 'nameEn', tour.name.ar, tour.name.en)}
          {two('Duration / time', 'durAr', 'durEn', tour.duration.ar, tour.duration.en)}
          {two('Badge on the card', 'tagAr', 'tagEn', tour.tag.ar, tour.tag.en)}
        </div>
      </div>
      {two('Included — one per line', 'inclAr', 'inclEn', (tour.included.ar ?? []).join('\n'), (tour.included.en ?? []).join('\n'), true)}
      {two('Not included (red note)', 'exclAr', 'exclEn', tour.excluded.ar, tour.excluded.en)}
      {err && <p className="text-sm font-semibold text-red-700">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={BTN} disabled={busy}><Icon name="check" size={15} /> {busy ? 'Saving…' : tour.id ? 'Save trip' : 'Add trip'}</button>
        {onCancel && <button type="button" className={GHOST} onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

export function ToursManager({ tours }: { tours: Tour[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const reload = (t: string) => { window.location.replace(`${location.pathname}?tab=tours&ok=${encodeURIComponent(t)}`); };
  async function op(body: Record<string, unknown>, done: string) {
    const r = await act({ what: 'tour', ...body });
    if (!r.ok) setMsg({ ok: false, t: r.error! }); else reload(done);
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">The “Day trips” cards on the home page, in this order. Hidden trips stay here but aren’t shown on the website.</p>
      <Notice msg={msg} />
      {tours.map((t, i) => (
        <section key={t.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${t.active ? 'border-cocoa-100' : 'border-dashed border-slate-300 opacity-80'}`}>
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {t.image ? <img src={t.image} alt="" className="h-14 w-20 rounded-lg object-cover" /> : <div className="h-14 w-20 rounded-lg bg-cocoa-50" />}
            <div className="min-w-0 flex-1">
              <b className="block truncate text-cocoa-900">{t.name.en || t.name.ar}</b>
              <span className="block truncate text-sm text-slate-500" dir="rtl">{t.name.ar}</span>
            </div>
            {!t.active && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Hidden</span>}
            <div className="flex flex-wrap gap-1.5">
              <button type="button" className={GHOST} disabled={i === 0} onClick={() => op({ op: 'up', id: t.id }, 'Order saved')} title="Move up">↑</button>
              <button type="button" className={GHOST} disabled={i === tours.length - 1} onClick={() => op({ op: 'down', id: t.id }, 'Order saved')} title="Move down">↓</button>
              <button type="button" className={GHOST} onClick={() => op({ op: t.active ? 'hide' : 'show', id: t.id }, t.active ? 'Trip hidden' : 'Trip shown')}>{t.active ? 'Hide' : 'Show'}</button>
              <button type="button" className={GHOST} onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'Close' : 'Edit'}</button>
              <button type="button" className={`${GHOST} text-red-700`} onClick={() => { if (confirm('Delete this trip from the website?')) void op({ op: 'delete', id: t.id }, 'Trip deleted'); }}><Icon name="trash" size={14} /></button>
            </div>
          </div>
          {open === t.id && <div className="mt-4 border-t border-cocoa-100 pt-4"><TourForm tour={t} onSaved={reload} onCancel={() => setOpen(null)} /></div>}
        </section>
      ))}
      <section className="rounded-2xl border border-dashed border-cocoa-300 bg-cocoa-50/50 p-4">
        {open === 'new'
          ? <><h3 className="mb-3 font-bold text-cocoa-900">New trip</h3><TourForm tour={blank} onSaved={reload} onCancel={() => setOpen(null)} /></>
          : <button type="button" className={BTN} onClick={() => setOpen('new')}><Icon name="plus" size={15} /> Add a trip</button>}
      </section>
    </div>
  );
}

/* ───────── Guest films ───────── */

type Film = { id: string; kind: 'main' | 'reel'; active: boolean; video: string; poster: string | null };

function FilmCard({ f, first, last, onOp }: { f: Film; first: boolean; last: boolean; onOp: (b: Record<string, unknown>, done: string) => void }) {
  return (
    <li className={`overflow-hidden rounded-xl border bg-white ${f.active ? 'border-cocoa-100' : 'border-dashed border-slate-300 opacity-75'}`}>
      <video src={f.video} poster={f.poster ?? undefined} controls preload="none" playsInline className={`w-full bg-black object-cover ${f.kind === 'main' ? 'aspect-video' : 'aspect-[9/16] max-h-80'}`} />
      <div className="flex flex-wrap items-center gap-1.5 p-2">
        {f.kind === 'reel' && <>
          <button type="button" className={GHOST} disabled={first} onClick={() => onOp({ op: 'up', id: f.id }, 'Order saved')} title="Earlier">←</button>
          <button type="button" className={GHOST} disabled={last} onClick={() => onOp({ op: 'down', id: f.id }, 'Order saved')} title="Later">→</button>
        </>}
        <UploadButton want="photo" label="Cover photo" onDone={(urls) => onOp({ op: 'film.poster', id: f.id, url: urls[0] }, 'Cover photo saved')} />
        <button type="button" className={GHOST} onClick={() => onOp({ op: f.active ? 'hide' : 'show', id: f.id }, f.active ? 'Video hidden' : 'Video shown')}>{f.active ? 'Hide' : 'Show'}</button>
        <button type="button" className={`${GHOST} text-red-700`} onClick={() => { if (confirm('Delete this video from the website?')) onOp({ op: 'delete', id: f.id }, 'Video deleted'); }}><Icon name="trash" size={14} /></button>
      </div>
    </li>
  );
}

export function FilmsManager({ films }: { films: Film[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const reload = (t: string) => { window.location.replace(`${location.pathname}?tab=films&ok=${encodeURIComponent(t)}`); };
  async function op(body: Record<string, unknown>, done: string) {
    const r = await act({ what: 'film', ...body });
    if (!r.ok) setMsg({ ok: false, t: r.error! }); else reload(done);
  }
  const mains = films.filter((f) => f.kind === 'main');
  const reels = films.filter((f) => f.kind === 'reel');
  const addFilm = (kind: 'main' | 'reel') => async (urls: string[]) => {
    for (const u of urls) { const r = await act({ op: 'film.add', kind, video: u }); if (!r.ok) { setMsg({ ok: false, t: r.error! }); return; } }
    reload(kind === 'main' ? 'Wide film replaced · live on the website' : `${urls.length} reel${urls.length > 1 ? 's' : ''} added · add a cover photo for each`);
  };
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">The “Guest films” section on the home page: one wide film and the portrait reels next to it (Instagram style). Videos of any size; give each one a cover photo so the page looks good before it plays.</p>
      <Notice msg={msg} />
      <section className="rounded-2xl border border-cocoa-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-cocoa-900">Wide film (landscape)</h3>
          <UploadButton want="video" label={mains.some((m) => m.active) ? 'Replace the wide film' : 'Upload the wide film'} className={BTN} onDone={addFilm('main')} />
        </div>
        {mains.length ? <ul className="grid gap-3 md:grid-cols-2">{mains.map((f, i) => <FilmCard key={f.id} f={f} first={i === 0} last={i === mains.length - 1} onOp={op} />)}</ul> : <p className="text-sm text-slate-500">No wide film yet.</p>}
        {mains.length > 1 && <p className="mt-2 text-xs text-slate-500">Only one wide film is shown; older ones stay hidden here so you can bring one back with “Show”.</p>}
      </section>
      <section className="rounded-2xl border border-cocoa-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-cocoa-900">Reels (portrait) · {reels.filter((r) => r.active).length} shown</h3>
          <UploadButton want="video" multiple label="Add reels" className={BTN} onDone={addFilm('reel')} />
        </div>
        {reels.length ? <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{reels.map((f, i) => <FilmCard key={f.id} f={f} first={i === 0} last={i === reels.length - 1} onOp={op} />)}</ul> : <p className="text-sm text-slate-500">No reels yet.</p>}
      </section>
    </div>
  );
}
