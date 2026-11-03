'use client';

import { useState } from 'react';
import { Input } from '@/components/dash-ui';

type Q = { id: string; label: { ar?: string; en?: string }; type: 'text' | 'choice' | 'multi'; options: { ar?: string; en?: string }[]; required: boolean };
const MAX = 8;
const blank = (): Q => ({ id: '', label: {}, type: 'text', options: [], required: false });

/** Extra questions on the ticket form: the ones saved, «Add a question» for one more (up to 8), × to remove one. */
export function QuestionsEditor({ initial }: { initial: Q[] }) {
  const [list, setList] = useState<(Q & { key: number })[]>(() => (initial.length ? initial : [blank()]).map((q, k) => ({ ...q, key: k })));
  const [next, setNext] = useState(list.length);
  const add = () => { if (list.length < MAX) { setList((l) => [...l, { ...blank(), key: next }]); setNext((n) => n + 1); } };
  const remove = (key: number) => setList((l) => l.filter((q) => q.key !== key));
  return (
    <div className="space-y-4">
      {list.map((qn, i) => (
        <fieldset key={qn.key} className="rounded-xl border border-cocoa-200 p-3">
          <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-cocoa-800">Question {i + 1}</legend>
          <input type="hidden" name={`q${i}_present`} value="1" /><input type="hidden" name={`q${i}_id`} value={qn.id} />
          <div className="grid gap-2 sm:grid-cols-2">
            <input name={`q${i}_labelAr`} dir="rtl" defaultValue={qn.label.ar ?? ''} placeholder="السؤال بالعربي" className={Input} aria-label="Question (Arabic)" />
            <input name={`q${i}_labelEn`} defaultValue={qn.label.en ?? ''} placeholder="Question in English" className={Input} aria-label="Question (English)" />
            <select name={`q${i}_type`} defaultValue={qn.type} className={Input} aria-label="Answer type"
              onChange={(e) => setList((l) => l.map((x) => (x.key === qn.key ? { ...x, type: e.target.value as Q['type'] } : x)))}>
              <option value="text">Written answer</option>
              <option value="choice">One choice</option>
              <option value="multi">Several choices (checkboxes)</option>
            </select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name={`q${i}_required`} defaultChecked={qn.required} /> Must be answered</label>
            {qn.type !== 'text' && (
              <>
                <textarea name={`q${i}_optionsAr`} dir="rtl" rows={3} defaultValue={qn.options.map((o) => o.ar ?? '').join('\n')} placeholder={'الاختيارات\nسطر لكل اختيار'} className={Input} aria-label="Choices (Arabic)" />
                <textarea name={`q${i}_optionsEn`} rows={3} defaultValue={qn.options.map((o) => o.en ?? '').join('\n')} placeholder={'Choices\none per line'} className={Input} aria-label="Choices (English)" />
              </>
            )}
          </div>
          <button type="button" onClick={() => remove(qn.key)} className="mt-2 text-xs font-semibold text-red-700 underline">Remove this question</button>
        </fieldset>
      ))}
      {list.length < MAX
        ? <button type="button" onClick={add} className="w-full rounded-xl border border-dashed border-cocoa-300 bg-cocoa-50 px-3 py-2.5 text-sm font-semibold text-cocoa-800 hover:border-cocoa-600">+ Add a question</button>
        : <p className="text-xs text-slate-500">8 questions is the most.</p>}
    </div>
  );
}
