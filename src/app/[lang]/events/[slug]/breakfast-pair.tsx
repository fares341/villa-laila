import React from 'react';
import type { DayMenu } from '@/services/weekly-menu';

const t = (x: { ar?: string; en?: string } | undefined, ar: boolean) => (ar ? x?.ar || x?.en : x?.en || x?.ar) || '';

/**
 * The villa's two breakfasts (the same every day), side by side in the gold menu frame: each photo shown whole,
 * its name and a few points about it.
 */
export function BreakfastPair({ ar, meals }: { ar: boolean; meals: DayMenu[] }) {
  if (!meals.length) return null;
  return (
    <section className="evmeal bfp" aria-labelledby="bfpH" dir={ar ? 'rtl' : 'ltr'}>
      <p className="evmeal-k bfp-k" id="bfpH">{ar ? (meals.length > 1 ? 'اختار فطارك' : 'الفطار') : meals.length > 1 ? 'Choose your breakfast' : 'Breakfast'}</p>
      <div className={`bfp-grid n${meals.length}`}>
        {meals.map((m, i) => {
          const title = t(m.title, ar);
          const pts = t(m.description, ar).split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 6);
          const dishes = m.dishes.map((x) => t(x, ar)).filter(Boolean);
          return (
            <figure key={i} className="bfp-item">
              <div className="bfp-photo" style={m.img ? ({ ['--bg' as string]: `url("${m.img}")` } as React.CSSProperties) : undefined}>{m.img ? <img src={m.img} alt={title} loading="lazy" decoding="async" /> : <span aria-hidden />}</div>
              <figcaption>
                <h3>{title}</h3>
                {pts.length > 0
                  ? <ul className="evmeal-pts">{pts.map((x, k) => <li key={k}>{x}</li>)}</ul>
                  : dishes.length > 0 && <p className="evmeal-desc">{dishes.join(' · ')}</p>}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
