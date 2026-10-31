import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Paymob (Egypt) — Intention API + Unified Checkout.
 * Turned on automatically once PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_HMAC_SECRET and PAYMOB_INTEGRATION_IDS are set.
 *
 * Paymob dashboard → Developers:
 *   - Secret key  → PAYMOB_SECRET_KEY   (starts with egy_sk_…)
 *   - Public key  → PAYMOB_PUBLIC_KEY   (starts with egy_pk_…)
 *   - HMAC        → PAYMOB_HMAC_SECRET
 *   - Payment integrations (card, wallet …) → PAYMOB_INTEGRATION_IDS="123456,654321"
 * Callbacks are sent per intention (notification_url / redirection_url), so nothing has to be set in the Paymob dashboard.
 */
export const paymobEnv = {
  get base() { return (process.env.PAYMOB_BASE_URL || 'https://accept.paymob.com').replace(/\/+$/, ''); },
  get secretKey() { return process.env.PAYMOB_SECRET_KEY || ''; },
  get publicKey() { return process.env.PAYMOB_PUBLIC_KEY || ''; },
  get hmacSecret() { return process.env.PAYMOB_HMAC_SECRET || ''; },
  get integrationIds(): number[] {
    return (process.env.PAYMOB_INTEGRATION_IDS || '').split(/[,\s]+/).map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
  },
  get currency() { return (process.env.PAYMOB_CURRENCY || 'EGP').toUpperCase(); },
};

export function paymobEnabled(currency?: string): boolean {
  const ok = !!(paymobEnv.secretKey && paymobEnv.publicKey && paymobEnv.hmacSecret && paymobEnv.integrationIds.length);
  if (!ok) return false;
  return !currency || currency.toUpperCase() === paymobEnv.currency;
}

export type IntentionInput = {
  amountCents: number;
  currency: string;
  merchantRef: string;            // our unique reference (special_reference)
  itemName: string;
  itemDescription?: string;
  quantity?: number;
  customer: { name: string; email: string; phone?: string | null };
  notificationUrl: string;
  redirectionUrl: string;
};

function splitName(full: string) {
  const parts = full.trim().split(/\s+/);
  const first = parts.shift() || 'Guest';
  return { first, last: parts.join(' ') || first };
}

/** Creates a payment intention and returns the hosted checkout URL to send the guest to. */
export async function createIntention(i: IntentionInput): Promise<{ checkoutUrl: string; intentionId: string | null; orderId: string | null; raw: any }> {
  if (!paymobEnabled(i.currency)) throw new Error('Paymob is not configured');
  const { first, last } = splitName(i.customer.name);
  const phone = (i.customer.phone || '').replace(/[^\d+]/g, '') || '+201000000000';
  const qty = Math.max(1, i.quantity ?? 1);
  // Paymob requires item amounts to add up to the total; send one line with the full amount.
  const body = {
    amount: i.amountCents,
    currency: i.currency.toUpperCase(),
    payment_methods: paymobEnv.integrationIds,
    items: [{ name: i.itemName.slice(0, 50), amount: i.amountCents, description: (i.itemDescription || i.itemName).slice(0, 255), quantity: 1 }],
    billing_data: {
      first_name: first, last_name: last, email: i.customer.email, phone_number: phone,
      apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA', city: 'Cairo', state: 'Cairo', country: 'EG', postal_code: 'NA',
    },
    customer: { first_name: first, last_name: last, email: i.customer.email },
    special_reference: i.merchantRef,
    notification_url: i.notificationUrl,
    redirection_url: i.redirectionUrl,
    extras: { merchant_ref: i.merchantRef, quantity: qty },
  };
  const res = await fetch(`${paymobEnv.base}/v1/intention/`, {
    method: 'POST',
    headers: { Authorization: `Token ${paymobEnv.secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok || !raw?.client_secret) {
    console.error('[paymob] intention failed', res.status, JSON.stringify(raw).slice(0, 500));
    throw new Error('Paymob intention failed');
  }
  const checkoutUrl = `${paymobEnv.base}/unifiedcheckout/?publicKey=${encodeURIComponent(paymobEnv.publicKey)}&clientSecret=${encodeURIComponent(raw.client_secret)}`;
  return { checkoutUrl, intentionId: raw.id ?? null, orderId: raw.intention_order_id != null ? String(raw.intention_order_id) : null, raw };
}

/** Field order Paymob uses for the transaction HMAC (processed + response callbacks). */
const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure',
  'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending',
  'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
] as const;

const str = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));

function get(obj: any, path: string) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a.toLowerCase()), y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

export function hmacOf(concatenated: string, secret = paymobEnv.hmacSecret) {
  return createHmac('sha512', secret).update(concatenated).digest('hex');
}

/** HMAC check for the POST "transaction processed" callback: body = { type: 'TRANSACTION', obj: {...} }, ?hmac=… */
export function verifyProcessedHmac(obj: any, hmac: string, secret = paymobEnv.hmacSecret): boolean {
  if (!obj || !hmac || !secret) return false;
  const s = HMAC_FIELDS.map((f) => str(get(obj, f))).join('');
  return safeEq(hmacOf(s, secret), hmac);
}

/** HMAC check for the GET redirection (query params are flat: order instead of order.id). */
export function verifyRedirectHmac(params: Record<string, string | undefined>, secret = paymobEnv.hmacSecret): boolean {
  const hmac = params.hmac || '';
  if (!hmac || !secret) return false;
  const s = HMAC_FIELDS.map((f) => str(params[f === 'order.id' ? 'order' : f])).join('');
  return safeEq(hmacOf(s, secret), hmac);
}

export type PaymobTxn = { success: boolean; pending: boolean; amountCents: number; currency: string; txnId: string; orderId: string; merchantRef: string | null };

export function txnFromProcessed(obj: any): PaymobTxn {
  return {
    success: obj?.success === true || obj?.success === 'true',
    pending: obj?.pending === true || obj?.pending === 'true',
    amountCents: Number(obj?.amount_cents ?? 0),
    currency: String(obj?.currency ?? ''),
    txnId: String(obj?.id ?? ''),
    orderId: String(obj?.order?.id ?? ''),
    merchantRef: obj?.order?.merchant_order_id ?? obj?.special_reference ?? null,
  };
}

export function txnFromRedirect(p: Record<string, string | undefined>): PaymobTxn {
  return {
    success: p.success === 'true',
    pending: p.pending === 'true',
    amountCents: Number(p.amount_cents ?? 0),
    currency: String(p.currency ?? ''),
    txnId: String(p.id ?? ''),
    orderId: String(p.order ?? ''),
    merchantRef: p.merchant_order_id ?? null,
  };
}

/**
 * Online payment for ROOM bookings on the website. Off for now (owner's decision): guests send the booking and pay
 * at the villa; reception confirms. Set ROOM_PAYMOB=1 in .env to take the deposit by Paymob again.
 */
export const roomPaymobOn = () => process.env.ROOM_PAYMOB === '1' && paymobEnabled();
