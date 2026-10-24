import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { PageHeader, Empty, Flash, dt } from '@/components/dash';

const PRI: Record<string, string> = { high: 'bg-red-100 text-red-900', normal: 'bg-slate-100 text-slate-800', low: 'bg-slate-50 text-slate-500' };

export default async function Inbox({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('inbox.use');
  const sp = await searchParams;
  const show = sp.show === 'all' ? 'all' : sp.show === 'mine' ? 'mine' : 'open';
  const rows = await q<any>(
    `SELECT c.*, g.full_name, u.name staff, r.reference,
       (SELECT text FROM messages m WHERE m.conversation_id=c.id AND m.direction='in' ORDER BY created_at DESC LIMIT 1) last_text
     FROM conversations c LEFT JOIN guests g ON g.id=c.guest_id LEFT JOIN users u ON u.id=c.assigned_to LEFT JOIN reservations r ON r.id=c.reservation_id
     WHERE ($1='all' OR ($1='open' AND (c.status='needs_staff' OR c.mode='human') AND c.status<>'resolved') OR ($1='mine' AND c.mode='human' AND c.status<>'resolved'))
     ORDER BY (c.status='needs_staff') DESC, c.priority='high' DESC, c.last_guest_message_at DESC NULLS LAST LIMIT 100`, [show]);
  return (
    <>
      <PageHeader title="Guest messages" sub="Chats where a guest needs a person. While you are answering a chat, the bot stays quiet." />
      <Flash sp={sp} />
      <div className="mb-4 flex gap-4 text-sm">{[['open', 'Needs reception'], ['mine', 'I am answering'], ['all', 'All']].map(([k, l]) => <Link key={k} href={`?show=${k}`} className={show === k ? 'font-bold underline' : 'text-slate-600 underline'}>{l}</Link>)}</div>
      {rows.length === 0 ? <Empty>No conversations here. When a guest asks for reception or the bot cannot help, it appears here.</Empty> : (
        <div className="divide-y rounded-xl border border-slate-200 bg-white">{rows.map((c) => (
          <Link key={c.id} href={`/dashboard/inbox/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PRI[c.priority]}`}>{c.priority}</span>
            <div className="min-w-0 flex-1"><p className="font-medium">{c.full_name ?? `Telegram ${c.external_id}`} {c.reference && <span className="font-mono text-xs text-slate-500">{c.reference}</span>}</p>
              <p className="truncate text-sm text-slate-600">{c.last_text ?? '—'}</p><p className="text-xs text-slate-500">{c.escalation_reason}</p></div>
            <div className="text-end text-xs text-slate-500"><p>{dt(c.last_guest_message_at)}</p><p>{c.mode === 'human' ? `Assigned: ${c.staff ?? 'staff'}` : c.status === 'needs_staff' ? 'Unassigned' : c.status}</p></div>
          </Link>))}</div>)}
    </>
  );
}
