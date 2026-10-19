import { q, tx } from '@/lib/db';
import type { Q } from '@/lib/db';
import { getAdapter, type Keyboard } from './channels';
import { audit } from './audit';
import { cancelFollowups } from './followups';
import { BookingError } from './errors';
import { env } from '@/lib/env';

export type Conversation = {
  id: string; channel: string; external_id: string; guest_id: string | null; reservation_id: string | null; language: 'en' | 'es' | 'fr' | 'ar' | null;
  flow: string; step: string; data: Record<string, any>; mode: 'bot' | 'human'; status: 'open' | 'needs_staff' | 'resolved';
  assigned_to: string | null; priority: string; escalation_reason: string | null; last_guest_message_at: string | null;
};

export async function getOrCreateConversation(channel: string, externalId: string): Promise<Conversation> {
  const rows = await q<Conversation>(
    `INSERT INTO conversations(channel, external_id) VALUES($1,$2)
     ON CONFLICT (channel, external_id) DO UPDATE SET updated_at = conversations.updated_at RETURNING *`, [channel, externalId]);
  return rows[0];
}
export async function getConversation(id: string): Promise<Conversation | null> {
  return (await q<Conversation>('SELECT * FROM conversations WHERE id=$1', [id]))[0] ?? null;
}

/** Durable state: flow/step/data live in the DB, never only in the model's context. */
export async function saveState(id: string, patch: { flow?: string; step?: string; data?: Record<string, any>; language?: string; guest_id?: string | null; reservation_id?: string | null }) {
  await q(
    `UPDATE conversations SET flow=COALESCE($2,flow), step=COALESCE($3,step), data=COALESCE($4::jsonb,data), language=COALESCE($5,language),
       guest_id=COALESCE($6,guest_id), reservation_id=COALESCE($7,reservation_id), updated_at=now() WHERE id=$1`,
    [id, patch.flow ?? null, patch.step ?? null, patch.data ? JSON.stringify(patch.data) : null, patch.language ?? null, patch.guest_id ?? null, patch.reservation_id ?? null]);
}

export async function logMessage(conversationId: string, direction: 'in' | 'out', sender: 'guest' | 'bot' | 'staff' | 'system', text: string, opts: { kind?: string; externalMsgId?: string; delivery?: 'sent' | 'failed' } = {}) {
  await q('INSERT INTO messages(conversation_id,direction,sender,text,kind,external_msg_id,delivery_status) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [conversationId, direction, sender, text, opts.kind ?? 'text', opts.externalMsgId ?? null, opts.delivery ?? 'sent']);
  if (direction === 'in') await q('UPDATE conversations SET last_guest_message_at=now(), updated_at=now() WHERE id=$1', [conversationId]);
}

/** Bot reply. Refuses to send if staff has taken over (re-checked at send time) so AI and staff never talk over each other. */
export async function botSend(conv: Pick<Conversation, 'id' | 'channel' | 'external_id'>, text: string, kb?: Keyboard, opts: { allowHuman?: boolean } = {}): Promise<boolean> {
  if (!opts.allowHuman) {
    const ok = await q('SELECT 1 FROM conversations WHERE id=$1 AND mode=\'bot\'', [conv.id]);
    if (!ok[0]) return false;
  }
  const adapter = await getAdapter(conv.channel);
  if (!adapter) { await logMessage(conv.id, 'out', 'bot', text, { delivery: 'failed' }); throw new Error(`No adapter configured for ${conv.channel}`); }
  try {
    const r = await adapter.send(conv.external_id, text, kb);
    await logMessage(conv.id, 'out', 'bot', text, { externalMsgId: r.messageId });
    return true;
  } catch (e) {
    await logMessage(conv.id, 'out', 'bot', text, { delivery: 'failed' });
    throw e;
  }
}

export async function staffSend(conversationId: string, staffUserId: string, staffName: string, text: string) {
  const conv = await getConversation(conversationId);
  if (!conv) throw new BookingError('NOT_FOUND');
  if (conv.mode !== 'human' || conv.assigned_to !== staffUserId) throw new BookingError('BAD_STATE', 'Take over the conversation before replying');
  const adapter = await getAdapter(conv.channel);
  if (!adapter) throw new Error(`No adapter configured for ${conv.channel} — is TELEGRAM_BOT_TOKEN set?`);
  const r = await adapter.send(conv.external_id, text);
  await logMessage(conv.id, 'out', 'staff', text, { externalMsgId: r.messageId });
  await q('UPDATE conversations SET updated_at=now() WHERE id=$1', [conv.id]);
  await audit(staffName, 'inbox.reply', 'conversation', conv.id, {});
}

export async function takeOver(conversationId: string, staffUserId: string, staffName: string) {
  const r = await q(
    `UPDATE conversations SET mode='human', assigned_to=$2, status='open', updated_at=now()
     WHERE id=$1 AND (assigned_to IS NULL OR assigned_to=$2 OR mode='bot') RETURNING id`, [conversationId, staffUserId]);
  if (!r[0]) throw new BookingError('CONFLICT', 'Another staff member already handles this conversation');
  // bot follow-ups for this chat stop immediately
  await cancelFollowups({ conversationId, kinds: ['incomplete_booking', 'pending_reminder', 'payment_followup', 'extension_followup', 'expiry_notice'] });
  await audit(staffName, 'inbox.takeover', 'conversation', conversationId, {});
}
export async function assign(conversationId: string, staffUserId: string | null, actor: string) {
  await q('UPDATE conversations SET assigned_to=$2, updated_at=now() WHERE id=$1', [conversationId, staffUserId]);
  await audit(actor, 'inbox.assign', 'conversation', conversationId, { staffUserId });
}
/** Explicit, authorised "resume bot" action — the only way automated replies restart after a takeover. */
export async function resumeBot(conversationId: string, actor: string) {
  await q(`UPDATE conversations SET mode='bot', updated_at=now() WHERE id=$1`, [conversationId]);
  await audit(actor, 'inbox.resume_bot', 'conversation', conversationId, {});
}
export async function resolve(conversationId: string, actor: string) {
  await q(`UPDATE conversations SET status='resolved', updated_at=now() WHERE id=$1`, [conversationId]);
  await q(`UPDATE tasks SET status='done', completed_at=now() WHERE conversation_id=$1 AND status='open'`, [conversationId]);
  await audit(actor, 'inbox.resolve', 'conversation', conversationId, {});
}
export async function reopen(conversationId: string, actor: string) {
  await q(`UPDATE conversations SET status='needs_staff', updated_at=now() WHERE id=$1`, [conversationId]);
  await audit(actor, 'inbox.reopen', 'conversation', conversationId, {});
}

/** Notify reception (Telegram staff chat). Failure here must never break the guest flow. */
export async function notifyStaff(text: string) {
  if (!env.staffChatId) return;
  try { const a = await getAdapter('telegram'); await a?.send(env.staffChatId, text); } catch (e) { console.error('[notifyStaff]', (e as Error).message); }
}

export async function escalate(conversationId: string, reason: string, opts: { priority?: 'low' | 'normal' | 'high'; missing?: string; recommended?: string; summary?: string } = {}) {
  await tx(async (c) => {
    const cq = c as unknown as Q;
    await c.query(
      `UPDATE conversations SET status='needs_staff', escalation_reason=$2, priority=$3, missing_info=COALESCE($4,missing_info),
         recommended_action=COALESCE($5,recommended_action), summary=COALESCE($6,summary), escalated_at=now(), updated_at=now() WHERE id=$1`,
      [conversationId, reason, opts.priority ?? 'normal', opts.missing ?? null, opts.recommended ?? null, opts.summary ?? null]);
    await c.query(
      `INSERT INTO tasks(title,detail,kind,conversation_id,dedupe_key) VALUES($1,$2,'escalation',$3,$4)
       ON CONFLICT (dedupe_key) DO UPDATE SET status='open', detail=EXCLUDED.detail, completed_at=NULL`,
      [`Guest needs reception: ${reason}`, opts.recommended ?? null, conversationId, 'esc:' + conversationId]);
    await audit('bot', 'conversation.escalate', 'conversation', conversationId, { reason }, cq);
  });
  await notifyStaff(`🔔 Guest needs reception — ${reason}\nOpen the dashboard inbox to reply.`);
}

/** Plain, deterministic summary used when no AI summary is available. */
export async function basicSummary(conversationId: string): Promise<string> {
  const msgs = await q<{ sender: string; text: string }>('SELECT sender,text FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 6', [conversationId]);
  return msgs.reverse().map((m) => `${m.sender}: ${m.text.slice(0, 160)}`).join('\n');
}
