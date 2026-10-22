import { getSetting, setSetting } from './settings';

/**
 * WhatsApp messages to guests (cancellation, confirmation, reminder before the event).
 *
 * Sent automatically through the WhatsApp Cloud API (Meta) when its access token and phone number ID are saved in
 * Dashboard → Events → Settings. Messages a guest did not start must use a template approved by Meta; put the
 * template names there. Without these settings nothing is sent automatically: the admin bot gets a one-tap
 * wa.me link with the message already written instead.
 */
export type WhatsAppConfig = { token: string; phone_number_id: string; template_lang: string; template_reminder: string; template_cancel: string; template_confirm: string };

export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const s = ((await getSetting<any>('whatsapp').catch(() => null)) ?? {}) as Partial<WhatsAppConfig>;
  return {
    token: s.token || process.env.WHATSAPP_TOKEN || '', phone_number_id: s.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    template_lang: s.template_lang || 'ar', template_reminder: s.template_reminder || '', template_cancel: s.template_cancel || '', template_confirm: s.template_confirm || '',
  };
}
export async function saveWhatsAppConfig(v: WhatsAppConfig) { await setSetting('whatsapp', v); }

/** Egyptian numbers written locally (010…, 1…) become 2010…; anything else keeps its country code. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (/^01\d{9}$/.test(d)) d = '2' + d;
  else if (/^1\d{9}$/.test(d)) d = '20' + d;
  return /^\d{8,15}$/.test(d) ? d : null;
}

export const waLink = (phone: string | null, text: string) => phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null;

export type WaResult = { sent: boolean; link: string | null; error?: string };

/**
 * Send `text` to the guest. When a template name is given (and configured), the template is used with `params`
 * as its body variables, which is what WhatsApp requires for messages the guest did not start.
 */
export async function sendWhatsApp(rawPhone: string | null | undefined, text: string, template?: { name: string; params: string[] }): Promise<WaResult> {
  const phone = normalizePhone(rawPhone);
  const link = waLink(phone, text);
  if (!phone) return { sent: false, link: null, error: 'no phone number' };
  const cfg = await getWhatsAppConfig();
  if (!cfg.token || !cfg.phone_number_id) return { sent: false, link };
  const body = template?.name
    ? { messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: template.name, language: { code: cfg.template_lang }, components: [{ type: 'body', parameters: template.params.map((p) => ({ type: 'text', text: p })) }] } }
    : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text.slice(0, 4000), preview_url: true } };
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`, {
      method: 'POST', headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (res.ok) return { sent: true, link };
    const j: any = await res.json().catch(() => ({}));
    return { sent: false, link, error: j?.error?.message || `HTTP ${res.status}` };
  } catch (e) {
    return { sent: false, link, error: (e as Error).message };
  }
}
