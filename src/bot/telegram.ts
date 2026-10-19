import { env } from '@/lib/env';
import type { ChannelAdapter, Keyboard } from '@/services/channels';

const api = (method: string) => `https://api.telegram.org/bot${env.botToken}/${method}`;

async function call<T = any>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(api(method), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  const j: any = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${method} failed: ${j.description ?? res.status}`);
  return j.result as T;
}

export function toReplyMarkup(kb?: Keyboard) {
  if (!kb) return undefined;
  if (kb.inline) return { inline_keyboard: kb.inline.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: (b.data ?? b.text).slice(0, 64) }))) };
  if (kb.reply) return { keyboard: kb.reply.map((row) => row.map((b) => ({ text: b.text, ...(b.requestContact ? { request_contact: true } : {}) }))), resize_keyboard: true, one_time_keyboard: true };
  if (kb.remove) return { remove_keyboard: true };
  return undefined;
}

export class TelegramAdapter implements ChannelAdapter {
  name = 'telegram';
  async send(chatId: string, text: string, kb?: Keyboard) {
    const r = await call<{ message_id: number }>('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), reply_markup: toReplyMarkup(kb) });
    return { messageId: String(r.message_id) };
  }
}

export const tg = {
  getUpdates: (offset: number, timeout = 25, signal?: AbortSignal) => call<any[]>('getUpdates', { offset, timeout, allowed_updates: ['message', 'callback_query'] }, signal),
  answerCallback: (id: string) => call('answerCallbackQuery', { callback_query_id: id }).catch(() => {}),
  deleteWebhook: () => call('deleteWebhook', { drop_pending_updates: false }),
  getMe: () => call<{ username: string }>('getMe', {}),
  async downloadFile(fileId: string): Promise<{ data: Buffer; path: string }> {
    const f = await call<{ file_path: string }>('getFile', { file_id: fileId });
    const res = await fetch(`https://api.telegram.org/file/bot${env.botToken}/${f.file_path}`);
    if (!res.ok) throw new Error('file download failed');
    return { data: Buffer.from(await res.arrayBuffer()), path: f.file_path };
  },
};
