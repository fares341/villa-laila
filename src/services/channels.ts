// Channel abstraction. Telegram implements it today; a WhatsApp adapter can implement the same interface later
// and reuse every service (reservations, conversations, followups) unchanged.
export type Button = { text: string; data?: string; url?: string; requestContact?: boolean };
export type Keyboard = { inline?: Button[][]; reply?: Button[][]; remove?: boolean };
export interface ChannelAdapter {
  name: string;
  send(externalId: string, text: string, kb?: Keyboard): Promise<{ messageId?: string }>;
}

const registry = new Map<string, ChannelAdapter>();
export function registerAdapter(a: ChannelAdapter) { registry.set(a.name, a); }

export async function getAdapter(channel: string): Promise<ChannelAdapter | null> {
  if (registry.has(channel)) return registry.get(channel)!;
  if (channel === 'telegram') {
    const { TelegramAdapter } = await import('@/bot/telegram');
    if (!process.env.TELEGRAM_BOT_TOKEN) return null;
    const a = new TelegramAdapter();
    registry.set('telegram', a);
    return a;
  }
  return null;
}
