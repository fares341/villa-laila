import type { Q } from '@/lib/db';
import { q } from '@/lib/db';

export type Condition = { field: string; op: 'eq' | 'neq' | 'in' | 'exists' | 'missing'; value?: unknown };
export type PolicyRule = { id: string; name: string; version: number; active: boolean; conditions: Condition[]; action: 'ask' | 'review' | 'require_approval' | 'inform' | 'block'; questions: any[]; message: Record<string, string> };
export type Facts = Record<string, string | number | boolean | null | undefined>;

export type PolicyOutcome = {
  version: string;                // which policy set was applied
  needsReview: boolean;           // human must look at it before confirmation
  reasons: string[];
  appliedRules: { id: string; name: string; action: string }[];
  messages: Record<string, string>[];   // per-language guest-facing text from matched 'inform'/'ask' rules
  blocked: { name: string; message: Record<string, string> } | null;   // a 'block' rule matched: request must be refused
  undecidable: string[];          // facts that were needed but unavailable -> NEVER auto-reject, route to review
};

const norm = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

function test(c: Condition, facts: Facts): 'yes' | 'no' | 'unknown' {
  const raw = facts[c.field];
  const present = raw !== undefined && raw !== null && raw !== '';
  if (c.op === 'exists') return present ? 'yes' : 'no';
  if (c.op === 'missing') return present ? 'no' : 'yes';
  if (!present) return 'unknown';
  const v = norm(raw);
  switch (c.op) {
    case 'eq': return v === norm(c.value) ? 'yes' : 'no';
    case 'neq': return v !== norm(c.value) ? 'yes' : 'no';
    case 'in': return Array.isArray(c.value) && c.value.map(norm).includes(v) ? 'yes' : 'no';
  }
}

export async function activeRules(c?: Q): Promise<PolicyRule[]> {
  const sql = 'SELECT * FROM policy_rules WHERE active ORDER BY name';
  return (c ? (await c.query(sql)).rows : await q(sql)) as PolicyRule[];
}

/** Which facts the guest-facing flows must collect because an ACTIVE rule depends on them. */
export function requiredFacts(rules: PolicyRule[]): string[] {
  return [...new Set(rules.flatMap((r) => r.conditions.map((c) => c.field)))];
}

export function evaluate(rules: PolicyRule[], facts: Facts): PolicyOutcome {
  const out: PolicyOutcome = { version: rules.length ? rules.map((r) => `${r.id.slice(0, 8)}@${r.version}`).join(',') : 'none', needsReview: false, reasons: [], appliedRules: [], messages: [], blocked: null, undecidable: [] };
  for (const r of rules) {
    const results = r.conditions.map((c) => test(c, facts));
    if (results.includes('no')) continue;
    if (results.includes('unknown')) {
      // Cannot tell whether the rule applies: do NOT reject. Send to a human.
      out.needsReview = true;
      const missing = r.conditions.filter((_, i) => results[i] === 'unknown').map((c) => c.field);
      out.undecidable.push(...missing);
      out.reasons.push(`Rule "${r.name}" could not be evaluated (missing: ${missing.join(', ')})`);
      continue;
    }
    out.appliedRules.push({ id: r.id, name: r.name, action: r.action });
    if (r.message && Object.keys(r.message).length) out.messages.push(r.message);
    if (r.action === 'block' && !out.blocked) out.blocked = { name: r.name, message: r.message ?? {} };
    if (r.action === 'review' || r.action === 'require_approval') {
      out.needsReview = true;
      out.reasons.push(`Rule "${r.name}" requires staff ${r.action === 'review' ? 'review' : 'approval'}`);
    }
  }
  out.undecidable = [...new Set(out.undecidable)];
  return out;
}

/** Normalises the governorate printed on an Egyptian national ID (English/Arabic spellings) to a stable key. */
export function normalizeGovernorate(s: string): string {
  const x = s.trim().toLowerCase().replace(/[\u064B-\u0652]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
  if (/^(cairo|al.?qahira|el.?qahira|القاهره|قاهره|القاهرة)$/.test(x)) return 'cairo';
  if (/^(giza|gizeh|al.?jiza|el.?giza|الجيزه|جيزه|الجيزة)$/.test(x)) return 'giza';
  if (/^(qalyubia|qalyubiyya|qaliubiya|qalubia|kalyubia|القليوبيه|قليوبيه|القليوبية|benha|banha|بنها)$/.test(x)) return 'qalyubia';
  return x.slice(0, 40);
}
