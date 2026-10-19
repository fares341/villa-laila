import { headers } from 'next/headers';
import { env } from './env';

/** Public origin for callback URLs (PUBLIC_BASE_URL, else the request's host). */
export async function siteBase(): Promise<string> {
  if (env.baseUrl) return env.baseUrl.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto.split(',')[0].trim()}://${host.split(',')[0].trim()}`;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
}
