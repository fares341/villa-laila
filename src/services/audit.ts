import type { Q } from '@/lib/db';
import { pool } from '@/lib/db';

export async function audit(actor: string, action: string, entity?: string, entityId?: string | null, detail: unknown = {}, c?: Q) {
  const runner: Q = c ?? (pool() as unknown as Q);
  await runner.query('INSERT INTO audit_log(actor,action,entity,entity_id,detail) VALUES($1,$2,$3,$4,$5)', [actor, action, entity ?? null, entityId ?? null, JSON.stringify(detail)]);
}
