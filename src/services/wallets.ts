import { getSetting, setSetting } from './settings';
import { instapay as envInstapay } from './instapay';

/**
 * Manual wallet payments: the guest sends the money to the hostel's InstaPay or Vodafone Cash account and uploads
 * the receipt. Nothing is paid until a person checks the app and approves it (dashboard or Telegram admin bot).
 * Accounts are set in Dashboard → Events → Settings; the old INSTAPAY_* env values are used until then.
 */
export type Wallets = {
  instapay: { address: string; phone: string; name: string; link: string; enabled: boolean };
  vodafone_cash: { number: string; name: string; enabled: boolean };
};
export type WalletMethod = keyof Wallets;
export const WALLET_METHODS: WalletMethod[] = ['instapay', 'vodafone_cash'];

let cache: { at: number; v: Wallets } | null = null;

export async function getWallets(fresh = false): Promise<Wallets> {
  if (!fresh && cache && Date.now() - cache.at < 15_000) return cache.v;
  const s = ((await getSetting<any>('wallets').catch(() => null)) ?? {}) as Partial<Record<WalletMethod, any>>;
  const ip = s.instapay ?? {};
  const vf = s.vodafone_cash ?? {};
  const v: Wallets = {
    instapay: {
      address: ip.address ?? envInstapay.address, phone: ip.phone ?? envInstapay.phone,
      name: ip.name || envInstapay.name, link: ip.link ?? envInstapay.link, enabled: ip.enabled ?? true,
    },
    vodafone_cash: { number: vf.number ?? '', name: vf.name || envInstapay.name, enabled: vf.enabled ?? true },
  };
  cache = { at: Date.now(), v };
  return v;
}

export async function saveWallets(v: Wallets) {
  await setSetting('wallets', v);
  cache = null;
}

/** A wallet is offered only when it has an account to send to, and only for EGP prices. */
export function walletOn(w: Wallets, m: WalletMethod, currency?: string): boolean {
  if (currency && currency.toUpperCase() !== 'EGP') return false;
  if (m === 'instapay') return w.instapay.enabled && !!(w.instapay.address || w.instapay.phone);
  return w.vodafone_cash.enabled && !!w.vodafone_cash.number;
}

export const isWallet = (m: string): m is WalletMethod => m === 'instapay' || m === 'vodafone_cash';
export const walletLabel = (m: string, ar = false) => (m === 'vodafone_cash' ? (ar ? 'فودافون كاش' : 'Vodafone Cash') : m === 'instapay' ? 'InstaPay' : m);
