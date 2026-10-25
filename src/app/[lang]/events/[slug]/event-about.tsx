import React from 'react';
/**
 * The event's "About" text, laid out: the first paragraph is the lead, blank lines start new paragraphs, lines
 * starting with - • * · ✓ ✔ (or an emoji) become a tidy list, and a short line ending with ":" becomes a sub-heading.
 */
export type AboutItem = { text: string; icon?: string };
export type AboutPart = { kind: 'p' | 'h'; text: string } | { kind: 'ul'; items: AboutItem[] };
// A plain marker (- • * …, "1.") or a whole emoji, including joined ones like 🕵️‍♂️ (kept and shown as the bullet).
const MARK = /^\s*(?:[-•*·▪●➤→]|\d+[.)-])\s*/u;
const EMOJI = /^\s*((?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200D|\uFE0F|\u20E3|[\u2640\u2642])+)\s*/u;
const BULLET = new RegExp(`${MARK.source}|${EMOJI.source}`, 'u');

/** Text with links: a pasted address becomes a short tappable link instead of a long unbreakable line. */
export function withLinks(text: string): React.ReactNode {
  const bits = text.split(/(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?،؛)\]])/u);
  if (bits.length === 1) return text;
  return bits.map((b, i) => {
    if (i % 2 === 0) return b;
    let label = b;
    try { const u = new URL(b); label = (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, ''); } catch { /* keep */ }
    if (label.length > 34) label = label.slice(0, 32) + '…';
    return <a key={i} href={b} target="_blank" rel="noopener noreferrer" className="evd-link" dir="ltr">{label}</a>;
  });
}
export function aboutParts(text: string): AboutPart[] {
  const out: AboutPart[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const last = out[out.length - 1];
    if (!line) { out.push({ kind: 'p', text: '' }); continue; }
    if (BULLET.test(line)) {
      const em = line.match(EMOJI);
      const icon = em && !MARK.test(line) ? em[1] : undefined;
      const item = line.replace(BULLET, '').trim();
      if (!item) continue;
      const it: AboutItem = icon ? { text: item, icon } : { text: item };
      if (last?.kind === 'ul') last.items.push(it); else out.push({ kind: 'ul', items: [it] });
    } else if (line.length <= 60 && /[:：]$/.test(line)) out.push({ kind: 'h', text: line.replace(/[:：]$/, '') });
    else if (last?.kind === 'p' && last.text) last.text += ' ' + line;
    else if (last?.kind === 'p') last.text = line;
    else out.push({ kind: 'p', text: line });
  }
  return out.filter((x) => (x.kind === 'ul' ? x.items.length : x.text));
}

/** Split off the first sentence (it becomes the big tagline) when the text starts with a normal paragraph. */
function splitTagline(parts: AboutPart[]): { tag: string | null; rest: AboutPart[] } {
  const first = parts[0];
  // Text that starts with one emoji line ("🕵️ Trust no one!"): that line is the tagline.
  if (first?.kind === 'ul' && first.items.length === 1) return { tag: [first.items[0].icon, first.items[0].text].filter(Boolean).join(' '), rest: parts.slice(1) };
  if (!first || first.kind !== 'p') return { tag: null, rest: parts };
  const m = first.text.match(/^(.{12,140}?[.!؟?…])\s+(.+)$/su);
  if (!m) return first.text.length <= 140 ? { tag: first.text, rest: parts.slice(1) } : { tag: null, rest: parts };
  return { tag: m[1], rest: [{ kind: 'p', text: m[2] }, ...parts.slice(1)] };
}

/**
 * "About the event", laid out like a magazine intro rather than a box: a small gold heading, the first sentence as a
 * big tagline, the rest as calm body text and gold-diamond lists; then what the ticket includes and the note.
 */
export function EventAbout({ text, includes, note, isAr }: { text: string; includes: string[]; note: string; isAr: boolean }) {
  const parts = aboutParts(text);
  if (!parts.length && !includes.length && !note) return null;
  const { tag, rest: restRaw } = splitTagline(parts);
  // Long paragraphs (4+ sentences) read better split into short ones.
  const rest: AboutPart[] = restRaw.flatMap((x) => {
    if (x.kind !== 'p') return [x];
    const sentences = x.text.match(/[^.!؟?…]+[.!؟?…]+["'»”)]*\s*|[^.!؟?…]+$/gu)?.map((t) => t.trim()).filter(Boolean) ?? [x.text];
    if (sentences.length <= 3) return [x];
    // Even groups of 2–3 sentences (5 → 3 + 2, 4 → 2 + 2), never one sentence left alone at the end.
    const size = Math.ceil(sentences.length / Math.ceil(sentences.length / 3));
    const out: AboutPart[] = [];
    for (let i = 0; i < sentences.length; i += size) out.push({ kind: 'p', text: sentences.slice(i, i + size).join(' ') });
    return out;
  });
  return (
    <section className="evd-about" aria-labelledby="aboutH">
      <h2 id="aboutH" className="evd-about-k">{isAr ? 'عن الفعالية' : 'About the event'}</h2>
      {tag && <p className="evd-about-tag">{withLinks(tag)}</p>}
      {rest.length > 0 && (
        <div className="evd-about-body">
          {rest.map((x, i) => {
            if (x.kind === 'h') return <h3 key={i}>{x.text}</h3>;
            if (x.kind === 'ul') return (
              <ul key={i} className="evd-about-list">
                {x.items.map((it, j) => <li key={j} className={it.icon ? 'ic' : undefined}>{it.icon && <span className="evd-about-ic" aria-hidden>{it.icon}</span>}<span>{withLinks(it.text)}</span></li>)}
              </ul>
            );
            return <p key={i}>{withLinks(x.text)}</p>;
          })}
        </div>
      )}
      {includes.length > 0 && (
        <div className="evd-about-inc">
          <h3>{isAr ? 'التذكرة تشمل' : 'Your ticket includes'}</h3>
          <ul>
            {includes.map((x, i) => (
              <li key={i}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="m5 12 5 5 9-10" /></svg>{withLinks(x)}</li>
            ))}
          </ul>
        </div>
      )}
      {note && (
        <p className="evd-about-note">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
          <span>{withLinks(note)}</span>
        </p>
      )}
    </section>
  );
}
