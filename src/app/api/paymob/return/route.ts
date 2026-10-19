import { verifyRedirectHmac, txnFromRedirect } from '@/services/paymob';
import { applyPaymobTxn, landingFor } from '@/services/online-payments';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

// The guest's browser comes back here from Paymob's checkout (redirection_url).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries()) as Record<string, string>;
  const base = env.baseUrl || `${url.protocol}//${url.host}`;
  let target = '/en';
  let state = 'failed';
  if (verifyRedirectHmac(params)) {
    try {
      const t = txnFromRedirect(params);
      const op = await applyPaymobTxn(t, { source: 'redirect', params });
      if (op) {
        target = await landingFor(op);
        state = op.status === 'paid' ? 'paid' : t.pending ? 'pending' : 'failed';
      }
    } catch (e) {
      console.error('[paymob return]', e);
    }
  } else {
    console.warn('[paymob return] bad hmac');
  }
  const sep = target.includes('?') ? '&' : '?';
  return Response.redirect(`${base}${target}${sep}payment=${state}`, 303);
}
