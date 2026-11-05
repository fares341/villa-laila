'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A photo field for dashboard forms. Big phone photos (5–15 MB, 4000+ px) are made smaller in the browser before the
 * form is sent (longest side `max` px, JPG; PNG stays PNG so logos keep their transparent background). So many
 * photos can go in one save without hitting the upload limit, and the pages load fast.
 */
export function ImageInput({ name, multiple, max = 2000, id, className, label }: { name: string; multiple?: boolean; max?: number; id?: string; className?: string; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  const [bad, setBad] = useState(false);

  const onChange = async () => {
    const el = ref.current;
    if (!el?.files?.length) { setNote(''); return; }
    const form = el.form;
    const files = [...el.files];
    form?.setAttribute('data-busy', String(Number(form.getAttribute('data-busy') || 0) + 1));
    setBad(false);
    setNote(files.length > 1 ? `Preparing ${files.length} photos…` : 'Preparing the photo…');
    const out: File[] = [];
    const problems: string[] = [];
    for (const f of files) {
      try { out.push(await shrink(f, max)); }
      catch { problems.push(f.name); out.push(f); }
    }
    try {
      const dt = new DataTransfer();
      out.forEach((f) => dt.items.add(f));
      el.files = dt.files;
    } catch { /* very old browser: the original files are sent */ }
    form?.setAttribute('data-busy', String(Math.max(0, Number(form.getAttribute('data-busy') || 1) - 1)));
    const total = out.reduce((s, f) => s + f.size, 0);
    if (problems.length) {
      setBad(true);
      setNote(`Could not read ${problems.join(', ')}. If it is an iPhone HEIC photo, save it as JPG first.`);
    } else setNote(`${out.length > 1 ? `${out.length} photos` : 'Photo'} ready · ${mb(total)}`);
  };

  return (
    <>
      <input ref={ref} id={id} name={name} type="file" accept="image/*" multiple={multiple} className={className} aria-label={label} onChange={() => { void onChange(); }} />
      {note && <p className={`mt-1 text-xs ${bad ? 'text-red-700' : 'text-emerald-700'}`} role="status">{note}</p>}
    </>
  );
}

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function shrink(f: File, max: number): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) && !/\.(jpe?g|png|webp)$/i.test(f.name)) {
    if (/^image\/gif$/.test(f.type)) return f;
    if (/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name)) throw new Error('heic');
  }
  const bmp = await createImageBitmap(f).catch(async () => {
    const url = URL.createObjectURL(f);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  });
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width, h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  const k = Math.min(1, max / Math.max(w, h));
  // Already small: keep the file as it is.
  if (k === 1 && f.size <= 1.5 * 1024 * 1024 && /^image\/(jpeg|png|webp)$/.test(f.type)) return f;
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const g = c.getContext('2d');
  if (!g) return f;
  const png = f.type === 'image/png';
  if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
  g.drawImage(bmp as CanvasImageSource, 0, 0, c.width, c.height);
  const type = png ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.86));
  if (!blob || (blob.size >= f.size && /^image\/(jpeg|png|webp)$/.test(f.type))) return f;
  return new File([blob], f.name.replace(/\.[a-z0-9]+$/i, '') + (png ? '.png' : '.jpg'), { type, lastModified: Date.now() });
}

/**
 * Put once inside a form with photo fields: waits while photos are being prepared, stops a save that is too big for
 * the server (and says which to remove), and shows «Saving…» so the button is not pressed twice.
 */
export function UploadGuard({ limitMb = 45 }: { limitMb?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const form = ref.current?.closest('form');
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      if (Number(form.getAttribute('data-busy') || 0) > 0) { e.preventDefault(); setMsg('Wait a second, the photos are still being prepared…'); return; }
      let total = 0;
      form.querySelectorAll<HTMLInputElement>('input[type=file]').forEach((i) => [...(i.files ?? [])].forEach((f) => { total += f.size; }));
      if (total > limitMb * 1024 * 1024) { e.preventDefault(); setMsg(`The photos together are ${mb(total)}; the most in one save is ${limitMb} MB. Save fewer photos now and add the rest after.`); return; }
      if (form.getAttribute('data-sending') === '1') { e.preventDefault(); return; }
      form.setAttribute('data-sending', '1');
      setMsg(total > 0 ? `Saving and uploading ${mb(total)}…` : 'Saving…');
      // If the browser stays on the page (an error), allow saving again.
      setTimeout(() => form.removeAttribute('data-sending'), 60_000);
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, [limitMb]);
  return <span ref={ref} role="status" className={`block text-center text-sm ${/most|Wait/.test(msg) ? 'text-red-700' : 'text-slate-600'}`}>{msg}</span>;
}
