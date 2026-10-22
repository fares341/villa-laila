import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { env } from './env';

/** Which staff member unlocked the POS on this device (set after a correct PIN). */
const COOKIE = 'vl_pos';
const MAX_AGE = 60 * 60 * 14;

const key = () => new TextEncoder().encode(env.authSecret + ':pos');

export async function setPosStaff(staffId: string) {
  const token = await new SignJWT({ sid: staffId }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key());
  const isHttps = (await headers()).get('x-forwarded-proto') === 'https';
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isHttps, path: '/', maxAge: MAX_AGE });
}

export async function clearPosStaff() { (await cookies()).delete(COOKIE); }

export async function posStaffId(): Promise<string | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  try { const { payload } = await jwtVerify(t, key()); return typeof payload.sid === 'string' ? payload.sid : null; } catch { return null; }
}
