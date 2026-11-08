import React from 'react';

export type Group = { title: string | null; lines: string[] };
/** "## Title" starts a group; "- " lines are points; other lines are paragraphs. */
export const groups = (text: string): Group[] => {
  const out: Group[] = [{ title: null, lines: [] }];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('## ')) out.push({ title: l.slice(3).trim(), lines: [] });
    else out[out.length - 1].lines.push(l);
  }
  return out.filter((g) => g.title || g.lines.length);
};
export const Body = ({ lines }: { lines: string[] }) => {
  const out: React.ReactNode[] = [];
  let pts: string[] = [];
  const flush = () => { if (pts.length) out.push(<ul key={out.length}>{pts.map((x, i) => <li key={i}>{x}</li>)}</ul>); pts = []; };
  for (const l of lines) {
    if (/^[-•*]\s+/.test(l)) pts.push(l.replace(/^[-•*]\s+/, ''));
    else { flush(); out.push(<p key={out.length}>{l}</p>); }
  }
  flush();
  return <>{out}</>;
};

