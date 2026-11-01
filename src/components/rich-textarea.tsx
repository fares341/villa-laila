'use client';

import React, { useRef } from 'react';

/**
 * A large text box with a small toolbar for the event description: bold, italic, a big line (heading) and a list
 * item. It writes simple marks into the text (**bold**, _italic_, "## " heading, "- " list) that the event page
 * turns into formatting.
 */
export function RichTextarea({ id, name, defaultValue, dir, rows = 12, placeholder }: { id: string; name: string; defaultValue?: string; dir?: 'rtl' | 'ltr'; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrap = (mark: string, sample: string) => {
    const t = ref.current; if (!t) return;
    const { selectionStart: a, selectionEnd: b, value } = t;
    const inner = value.slice(a, b) || sample;
    t.setRangeText(mark + inner + mark, a, b, 'end');
    t.focus();
    t.setSelectionRange(a + mark.length, a + mark.length + inner.length);
  };
  const line = (prefix: string) => {
    const t = ref.current; if (!t) return;
    const { selectionStart: a, selectionEnd: b, value } = t;
    const start = value.lastIndexOf('\n', a - 1) + 1;
    const end = value.indexOf('\n', b) === -1 ? value.length : value.indexOf('\n', b);
    const lines = value.slice(start, end).split('\n').map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : prefix + l.replace(/^(## |- )/, '')));
    t.setRangeText(lines.join('\n'), start, end, 'end');
    t.focus();
  };
  const B = 'inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-cocoa-200 bg-white px-2.5 text-sm text-cocoa-800 hover:bg-cocoa-50';
  return (
    <div className="overflow-hidden rounded-xl border border-cocoa-200 bg-white focus-within:border-cocoa-600 focus-within:ring-2 focus-within:ring-cocoa-200">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-cocoa-100 bg-cocoa-50 px-2 py-1.5" role="toolbar" aria-label="Formatting">
        <button type="button" className={B + ' font-extrabold'} title="Bold (select text first)" onClick={() => wrap('**', 'bold text')}>B</button>
        <button type="button" className={B + ' italic'} title="Italic (select text first)" onClick={() => wrap('_', 'italic text')}>I</button>
        <button type="button" className={B + ' font-bold'} title="Big line (sub-heading)" onClick={() => line('## ')}>H</button>
        <button type="button" className={B} title="List item" onClick={() => line('- ')} aria-label="List item">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></svg>
        </button>
        <span className="ms-auto px-1 text-[11px] text-slate-500">Select words, then B / I. Empty line = new paragraph.</span>
      </div>
      <textarea ref={ref} id={id} name={name} rows={rows} dir={dir} defaultValue={defaultValue} placeholder={placeholder}
        className="block w-full resize-y border-0 bg-white px-4 py-3 text-[15px] leading-7 text-slate-900 outline-none" />
    </div>
  );
}
