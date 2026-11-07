'use client';

import { useState } from 'react';
import { Input } from '@/components/dash-ui';

type Opt = { key: string; en: string; ar: string; hidden?: boolean };

/**
 * Choices the guest picks on the booking form (e.g. Egyptian breakfast / Western breakfast, or Game only / Game +
 * dinner). Untick «Show» to hide a choice from the website (the POS still lists it). Saved as JSON in «optionsJson».
 */
export function OptionsEditor({ initial }: { initial: Opt[] }) {
  const [rows, setRows] = useState<Opt[]>(initial);
  const set = (i: number, p: Partial<Opt>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <div className="grid gap-2 text-sm">
      <input type="hidden" name="optionsJson" value={JSON.stringify(rows)} />
      {rows.length === 0 && <p className="text-slate-500">No choices: the guest just picks the date and the number of people.</p>}
      {rows.map((o, i) => (
        <div key={i} className={`grid gap-2 rounded-lg border p-2.5 ${o.hidden ? 'border-dashed border-slate-300 bg-slate-50 opacity-75' : 'border-cocoa-200'}`}>
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs font-semibold text-cocoa-800" title="Shown on the website booking form">
              <input type="checkbox" checked={!o.hidden} onChange={(e) => set(i, { hidden: !e.target.checked })} /> {o.hidden ? 'Hidden on the website' : 'Shown on the website'}
            </label>
            <button type="button" className="rounded-md px-2 py-1 text-xs text-red-700 hover:bg-red-50" onClick={() => setRows((r) => r.filter((_, k) => k !== i))}>Remove</button>
          </div>
          <input aria-label="Choice in English" placeholder="In English, e.g. Egyptian breakfast" value={o.en} onChange={(e) => set(i, { en: e.target.value })} className={Input} />
          <input aria-label="Choice in Arabic" dir="rtl" placeholder="بالعربي، مثلًا فطور مصري" value={o.ar} onChange={(e) => set(i, { ar: e.target.value })} className={Input} />
        </div>
      ))}
      {rows.length < 10 && <button type="button" className="justify-self-start rounded-lg border border-cocoa-300 px-3 py-1.5 text-sm font-semibold text-cocoa-800 hover:bg-cocoa-50" onClick={() => setRows((r) => [...r, { key: '', en: '', ar: '' }])}>+ Add a choice</button>}
    </div>
  );
}
