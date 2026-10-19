import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { q } from './db';
import { env } from './env';
import { can, type Role } from './permissions';

const COOKIE = 'vl_session';
const MAX_AGE = 60 * 60 * 12; // 12h

export type SessionUser = { id: string; email: string; name: string; role: Role };

function key() {
  const s = env.authSecret;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET must be set (>=16 chars)');
  return new TextEncoder().encode(s);
}

export async function createSession(u: SessionUser) {
  const token = await new SignJWT({ ...u }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(key());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.PUBLIC_BASE_URL?.startsWith('https') ?? false, path: '/', maxAge: MAX_AGE });
}

export async function destroySession() { (await cookies()).delete(COOKIE); }

/** Re-reads the user from the DB on every call, so deactivated users / role changes apply immediately. */
export async function currentUser(): Promise<SessionUser | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, key());
    const rows = await q<{ id: string; email: string; name: string; role: Role; active: boolean }>('SELECT id,email,name,role,active FROM users WHERE id=$1', [payload.id]);
    const u = rows[0];
    if (!u || !u.active) return null;
    return { id: u.id, email: u.email, name: u.name, role: u.role };
  } catch { return null; }
}

/** Use at the top of EVERY server action / API route / page that touches protected data. */
export async function requireUser(perm: string): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect('/dashboard/login');
  if (!can(u.role, perm)) throw new Error('FORBIDDEN: your role cannot do this');
  return u;
}

export async function login(email: string, password: string, ip: string): Promise<SessionUser | { error: string }> {
  const k = `${ip}|${email.toLowerCase()}`;
  const recent = await q<{ n: number }>("SELECT count(*)::int n FROM login_attempts WHERE key=$1 AND created_at > now() - interval '15 minutes'", [k]);
  if (recent[0].n >= 8) return { error: 'Too many attempts. Try again in 15 minutes.' };
  const rows = await q<any>('SELECT * FROM users WHERE lower(email)=lower($1)', [email]);
  const u = rows[0];
  const ok = u && u.active && (await bcrypt.compare(password, u.password_hash));
  if (!ok) {
    await q('INSERT INTO login_attempts(key) VALUES($1)', [k]);
    return { error: 'Wrong email or password.' };
  }
  await q('DELETE FROM login_attempts WHERE key=$1', [k]);
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export const hash = (p: string) => bcrypt.hash(p, 11);
