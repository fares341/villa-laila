import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { env } from './env';

// bigint -> number (amounts are minor units, safe below 2^53); DATE -> plain 'YYYY-MM-DD' string (no timezone shifting)
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1082, (v) => v);

const g = globalThis as unknown as { __pool?: Pool };
export function pool(): Pool {
  if (!g.__pool) g.__pool = new Pool({ connectionString: env.databaseUrl, max: 10 });
  return g.__pool;
}

export type Q = { query: <R extends QueryResultRow = any>(text: string, params?: any[]) => Promise<{ rows: R[]; rowCount: number | null }> };

export async function q<R extends QueryResultRow = any>(text: string, params: any[] = []) {
  const r = await pool().query<R>(text, params);
  return r.rows;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
