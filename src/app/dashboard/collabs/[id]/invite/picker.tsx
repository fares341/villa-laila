'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/dash-ui';

type C = { email: string; name: string; last: string; times: number; from: string; invited: boolean; optedOut: boolean };

/** The list of past guests to invite: search, select all / none / not yet invited, one checkbox each. */
export function InvitePicker({ contacts }: { contacts: C[] }) {
  const [qq, setQ] = useState('');
  const [on, setOn] = useState<Set<string>>(new Set());
  const list = useMemo(() => {
    const s = qq.trim().toLowerCase();
    return s ? contacts.filter((c) => `${c.email} ${c.name} ${c.from}`.toLowerCase().includes(s)) : contacts;
  }, [qq, contacts]);
  const can = (c: C) => !c.optedOut;
  const set = (emails: string[], v: boolean) => setOn((p) => { const n = new Set(p); for (const e of emails) v ? n.add(e) : n.delete(e); return n; });
  const btn = 'rounded-lg border border-cocoa-200 bg-white px-3 py-1.5 text-xs font-semibold text-cocoa-800';
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={qq} onChange={(e) => setQ(e.target.value)} placeholder="Search name, e-mail or event" className={Input + ' max-w-xs'} aria-label="Search" />
        <button type="button" className={btn} onClick={() => set(list.filter(can).map((c) => c.email), true)}>Select all{qq ? ' shown' : ''} ({list.filter(can).length})</button>
        <button type="button" className={btn} onClick={() => set(list.filter((c) => can(c) && !c.invited).map((c) => c.email), true)}>Select not invited yet</button>
        <button type="button" className={btn} onClick={() => setOn(new Set())}>Clear</button>
        <span className="ms-auto text-sm"><b className="tabular-nums">{on.size}</b> chosen</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto rounded-xl border border-cocoa-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-cocoa-50 text-left text-slate-600"><tr><th className="w-10 py-2 ps-3" /><th>Name / e-mail</th><th>Last came to</th><th>Times</th><th /></tr></thead>
          <tbody>{list.map((c) => (
            <tr key={c.email} className={`border-t border-slate-100 ${c.optedOut ? 'opacity-50' : ''}`}>
              <td className="py-2 ps-3"><input type="checkbox" name="to" value={c.email} disabled={!can(c)} checked={on.has(c.email)} onChange={(e) => set([c.email], e.target.checked)} aria-label={c.email} /></td>
              <td><b>{c.name || '—'}</b><div className="text-xs text-slate-500" dir="ltr">{c.email}</div></td>
              <td className="text-xs">{c.from}<div className="text-slate-500">{c.last}</div></td>
              <td className="tabular-nums">{c.times}</td>
              <td className="pe-3 text-xs">{c.optedOut ? <span className="text-red-700">No invitations</span> : c.invited ? <span className="text-emerald-700">Invited</span> : null}</td>
            </tr>
          ))}</tbody>
        </table>
        {list.length === 0 && <p className="p-4 text-sm text-slate-500">Nobody here yet. Past guests appear once they leave an e-mail (turn on «Ask for e-mail too» on the ticket form).</p>}
      </div>
    </div>
  );
}
