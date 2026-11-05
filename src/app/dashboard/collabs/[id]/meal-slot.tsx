'use client';

import { useState } from 'react';
import { Input, InputLg } from '@/components/dash-ui';
import { ImageInput } from '@/components/image-input';

export type MenuChoice = { key: string; group: string; label: string; titleAr: string; titleEn: string; points: string; img: string | null };
type M = { title: { ar?: string; en?: string }; points: { ar?: string; en?: string }; img: string | null; from?: string | null };


/**
 * One meal of a collab event: either one of the villa's weekly menu meals (picked from a list, its photo, name and
 * points come from the menu) or a meal of its own (name, points and photo typed / uploaded here).
 */
export function MealSlot({ i, m, choices }: { i: number; m: M; choices: MenuChoice[] }) {
  const [mode, setMode] = useState<'menu' | 'own'>(m.from ? 'menu' : 'own');
  const [pick, setPick] = useState(m.from ?? '');
  const chosen = choices.find((c) => c.key === pick) ?? null;
  const has = !!(m.title.ar || m.title.en);
  const groups = [...new Set(choices.map((c) => c.group))];
  const img = mode === 'menu' ? chosen?.img ?? null : m.img;
  return (
    <fieldset className="rounded-xl border border-cocoa-200 p-3">
      <legend className="px-1 text-sm font-semibold text-cocoa-800">Meal {i + 1}</legend>
      <input type="hidden" name={`m${i}_present`} value="1" />
      <input type="hidden" name={`m${i}_img`} value={m.img ?? ''} />
      <div className="mb-3 inline-flex rounded-lg border border-cocoa-200 p-0.5 text-sm" role="radiogroup" aria-label="Where the meal comes from">
        <label className={`cursor-pointer rounded-md px-3 py-1.5 ${mode === 'menu' ? 'bg-cocoa-800 text-white' : 'text-cocoa-800'}`}>
          <input type="radio" className="sr-only" name={`m${i}_mode`} value="menu" checked={mode === 'menu'} onChange={() => setMode('menu')} /> From Villa Layla’s menu
        </label>
        <label className={`cursor-pointer rounded-md px-3 py-1.5 ${mode === 'own' ? 'bg-cocoa-800 text-white' : 'text-cocoa-800'}`}>
          <input type="radio" className="sr-only" name={`m${i}_mode`} value="own" checked={mode === 'own'} onChange={() => setMode('own')} /> Its own meal (upload)
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-[120px_1fr]">
        {img
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={img} alt="" className="aspect-square w-28 rounded-lg bg-black object-contain md:w-full" />
          : <span className="grid aspect-square w-28 place-items-center rounded-lg bg-cocoa-50 text-center text-xs text-slate-500 md:w-full">No photo</span>}
        {mode === 'menu' ? (
          <div className="grid content-start gap-3">
            {choices.length === 0 ? (
              <p className="text-sm text-slate-500">The weekly menu is empty. Add meals in Events → Weekly menu, or use «Its own meal».</p>
            ) : (
              <select name={`m${i}_pick`} value={pick} onChange={(e) => setPick(e.target.value)} className={InputLg} aria-label="Meal from the weekly menu">
                <option value="">— Choose a meal —</option>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {choices.filter((c) => c.group === g).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </optgroup>
                ))}
              </select>
            )}
            {chosen && (
              <div className="rounded-lg bg-cocoa-50 p-3 text-base leading-relaxed">
                <b>{chosen.titleEn || chosen.titleAr}</b>{chosen.titleAr && chosen.titleEn && <span className="text-slate-700"> · <bdi>{chosen.titleAr}</bdi></span>}
                {chosen.points && <ul className="mt-1 list-disc ps-5 text-[15px] text-slate-700">{chosen.points.split('\n').map((p, k) => <li key={k}>{p}</li>)}</ul>}
              </div>
            )}
            {has && <label className="flex items-center gap-2 text-sm text-red-700"><input type="checkbox" name={`m${i}_remove`} /> Remove this meal</label>}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">Meal name (Arabic)</span>
              <input name={`m${i}_titleAr`} dir="rtl" defaultValue={m.from ? '' : m.title.ar ?? ''} placeholder="اسم الوجبة" className={InputLg} /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">Meal name (English)</span>
              <input name={`m${i}_titleEn`} defaultValue={m.from ? '' : m.title.en ?? ''} placeholder="Meal name" className={InputLg} /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">About the meal (Arabic) · one point per line, up to 6</span>
              <textarea name={`m${i}_pointsAr`} dir="rtl" rows={6} defaultValue={m.from ? '' : m.points.ar ?? ''} placeholder={'مثال:\nفراخ مشوية على الفحم\nأرز بسمتي\nسلطة خضرا'} className={InputLg} /></label>
            <label className="block"><span className="mb-1 block text-sm font-medium text-slate-700">About the meal (English) · same order</span>
              <textarea name={`m${i}_pointsEn`} rows={6} defaultValue={m.from ? '' : m.points.en ?? ''} placeholder={'e.g.\nCharcoal-grilled chicken\nBasmati rice\nGreen salad'} className={InputLg} /></label>
            <label className="block lg:col-span-2"><span className="mb-1 block text-sm font-medium text-slate-700">{m.img && !m.from ? 'Change the photo' : 'Photo of the meal'}</span>
              <ImageInput name={`m${i}_photo`} className={Input} label="Meal photo" /></label>
            {has && <label className="flex items-center gap-2 text-sm text-red-700"><input type="checkbox" name={`m${i}_remove`} /> Remove this meal</label>}
          </div>
        )}
      </div>
    </fieldset>
  );
}
