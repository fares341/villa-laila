export function fmtMoney(cents: number, currency = 'EGP'): string {
  const v = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return `${v} ${currency}`;
}
export function toCents(input: string | number): number {
  const n = typeof input === 'number' ? input : Number(String(input).replace(/,/g, '.'));
  if (!isFinite(n)) throw new Error('Invalid amount');
  return Math.round(n * 100);
}
