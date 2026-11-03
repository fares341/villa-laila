'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/dash-ui';

declare global { interface Window { L?: any } }

const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const VILLA: [number, number] = [30.0335, 31.2381];

const loadLeaflet = () => new Promise<any>((res, rej) => {
  if (window.L) return res(window.L);
  if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAFLET_CSS; document.head.appendChild(l); }
  const s = document.createElement('script'); s.src = LEAFLET_JS; s.async = true;
  s.onload = () => res(window.L); s.onerror = () => rej(new Error('map did not load'));
  document.head.appendChild(s);
});

/** Coordinates in a Google Maps link (…/@30.03,31.23,17z or ?q=30.03,31.23), if it has them. */
const coordsOf = (url: string): [number, number] | null => {
  const m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ?? url.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};

/**
 * Where an event happens: the written address and its place on the map. Search the place (or the address) or tap
 * the map to drop the pin; the pin is saved as a Google Maps link, so the event page's map and «Map» button open
 * exactly there. A Google Maps link can also be pasted. Empty = the villa.
 */
export function MapPicker({ addressAr, addressEn, mapUrl }: { addressAr: string; addressEn: string; mapUrl: string }) {
  const [url, setUrl] = useState(mapUrl);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [results, setResults] = useState<{ name: string; lat: number; lon: number }[]>([]);
  const box = useRef<HTMLDivElement | null>(null);
  const map = useRef<any>(null);
  const pin = useRef<any>(null);

  const place = (lat: number, lon: number, zoom = 17) => {
    const L = window.L; if (!L || !map.current) return;
    if (!pin.current) {
      pin.current = L.marker([lat, lon], { draggable: true }).addTo(map.current);
      pin.current.on('dragend', () => { const p = pin.current.getLatLng(); setUrl(`https://www.google.com/maps?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`); });
    } else pin.current.setLatLng([lat, lon]);
    map.current.setView([lat, lon], zoom);
    setUrl(`https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`);
  };

  useEffect(() => {
    let off = false;
    loadLeaflet().then((L) => {
      if (off || !box.current || map.current) return;
      const start = coordsOf(mapUrl);
      map.current = L.map(box.current).setView(start ?? VILLA, start ? 17 : 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current);
      if (start) { pin.current = null; place(start[0], start[1]); setUrl(mapUrl); }
      map.current.on('click', (e: any) => place(e.latlng.lat, e.latlng.lng, map.current.getZoom()));
    }).catch(() => setMsg('The map could not load here. Paste a Google Maps link below instead.'));
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async (text: string) => {
    if (!text.trim()) return;
    setMsg('Searching…'); setResults([]);
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=eg&accept-language=en&q=${encodeURIComponent(text)}`);
      const list = ((await r.json()) as any[]).map((x) => ({ name: x.display_name as string, lat: Number(x.lat), lon: Number(x.lon) }));
      setResults(list); setMsg(list.length ? '' : 'Nothing found. Try a shorter name, or tap the place on the map.');
      if (list[0]) place(list[0].lat, list[0].lon);
    } catch { setMsg('Search did not work. Tap the place on the map instead.'); }
  };

  return (
    <div className="grid gap-2 text-sm">
      <div><label className="mb-1 block text-xs font-semibold text-cocoa-700" htmlFor="e-ada">Address (Arabic)</label><input id="e-ada" name="addressAr" dir="rtl" defaultValue={addressAr} placeholder="فيلا ليلى، ٢٠ شارع صفية زغلول، السيدة زينب" className={Input} /></div>
      <div><label className="mb-1 block text-xs font-semibold text-cocoa-700" htmlFor="e-ade">Address (English)</label><input id="e-ade" name="addressEn" defaultValue={addressEn} placeholder="Villa Layla, 20 Safiya Zaghloul St, El Sayeda Zeinab" className={Input} /></div>
      <div className="mt-1 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(q); } }} placeholder="Find the place on the map (name or address)" className={Input} aria-label="Find the place" />
        <button type="button" className="shrink-0 rounded-lg border border-cocoa-200 bg-white px-3 py-2 text-sm font-semibold text-cocoa-800" onClick={() => search(q || (document.getElementById('e-ade') as HTMLInputElement)?.value || '')}>Find</button>
      </div>
      {results.length > 1 && (
        <ul className="max-h-32 overflow-y-auto rounded-lg border border-cocoa-200 bg-white text-xs">
          {results.map((r, k) => <li key={k}><button type="button" className="w-full px-3 py-1.5 text-start hover:bg-cocoa-50" onClick={() => place(r.lat, r.lon)}>{r.name}</button></li>)}
        </ul>
      )}
      <div ref={box} className="h-64 w-full overflow-hidden rounded-xl border border-cocoa-200 bg-cocoa-50" aria-label="Map: tap to put the pin" />
      <p className="text-xs text-slate-500">{msg || 'Tap the map (or drag the pin) to set exactly where the event is.'}</p>
      <div><label className="mb-1 block text-xs font-semibold text-cocoa-700" htmlFor="e-map">Google Maps link (filled by the pin, or paste one)</label>
        <input id="e-map" name="mapUrl" dir="ltr" value={url} onChange={(e) => { setUrl(e.target.value); const c = coordsOf(e.target.value); if (c) place(c[0], c[1]); }} placeholder="https://maps.app.goo.gl/…" className={Input} /></div>
      <div className="flex flex-wrap gap-2">
        {url && <a className="text-xs font-semibold text-cocoa-700 underline" href={url} target="_blank" rel="noopener noreferrer">Check it on Google Maps</a>}
        {url && <button type="button" className="text-xs font-semibold text-red-700 underline" onClick={() => { setUrl(''); if (pin.current) { map.current.removeLayer(pin.current); pin.current = null; } map.current?.setView(VILLA, 14); }}>Use the villa (clear the pin)</button>}
      </div>
      <p className="text-xs text-slate-500">Leave the address and the pin empty for an event at the villa.</p>
    </div>
  );
}
