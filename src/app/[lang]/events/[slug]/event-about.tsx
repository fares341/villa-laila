import React from 'react';
/**
 * The event's "About" text, laid out: the first paragraph is the lead, blank lines start new paragraphs, lines
 * starting with - • * · ✓ ✔ (or an emoji) become a tidy list, and a short line ending with ":" becomes a sub-heading.
 */
export type AboutPart = { kind: 'p' | 'h'; text: string } | { kind: 'ul'; items: string[] };
const BULLET = /^\s*(?:[-•*·▪●✓✔☑➤→]|\d+[.)-]|\p{Extended_Pictographic}\uFE0F?)\s*/u;
export function aboutParts(text: string): AboutPart[] {
  const out: AboutPart[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const last = out[out.length - 1];
    if (!line) { out.push({ kind: 'p', text: '' }); continue; }
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, '').trim();
      if (!item) continue;
      if (last?.kind === 'ul') last.items.push(item); else out.push({ kind: 'ul', items: [item] });
    } else if (line.length <= 60 && /[:：]$/.test(line)) out.push({ kind: 'h', text: line.replace(/[:：]$/, '') });
    else if (last?.kind === 'p' && last.text) last.text += ' ' + line;
    else if (last?.kind === 'p') last.text = line;
    else out.push({ kind: 'p', text: line });
  }
  return out.filter((x) => (x.kind === 'ul' ? x.items.length : x.text));
}

export function EventAbout({ text, includes, note, isAr }: { text: string; includes: string[]; note: string; isAr: boolean }) {
  const parts = aboutParts(text);
  if (!parts.length && !includes.length && !note) return null;
  let lead = true;
  return (
    <section className="evd-about" aria-labelledby="aboutH">
      <header className="evd-about-h">
        <span className="evd-about-k">{isAr ? 'فيلا ليلى' : 'Villa Layla'}</span>
        <h2 id="aboutH">{isAr ? 'عن الفعالية' : 'About the event'}</h2>
      </header>
      <div className="evd-about-body">
        {parts.map((x, i) => {
          if (x.kind === 'h') return <h3 key={i}>{x.text}</h3>;
          if (x.kind === 'ul') return (
            <ul key={i} className="evd-about-list">
              {x.items.map((it, j) => <li key={j}>{it}</li>)}
            </ul>
          );
          const cls = lead ? 'evd-about-lead' : undefined;
          lead = false;
          return <p key={i} className={cls}>{x.text}</p>;
        })}
      </div>
      {includes.length > 0 && (
        <div className="evd-about-inc">
          <h3>{isAr ? 'التذكرة تشمل' : 'Your ticket includes'}</h3>
          <ul>
            {includes.map((x, i) => (
              <li key={i}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="m5 12 5 5 9-10" /></svg>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {note && <p className="evd-about-note">{note}</p>}
    </section>
  );
}
