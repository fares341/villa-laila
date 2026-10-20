'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function DashNavLink({ href, external, children }: { href: string; external?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = !external && (href === '/dashboard' ? path === href : path === href || path.startsWith(href + '/'));
  const cls = `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-white/10 font-semibold text-white' : 'text-cocoa-100 hover:bg-white/5 hover:text-white'}`;
  if (external) return <a href={href} target="_blank" rel="noopener" className={cls}>{children}</a>;
  return <Link href={href} className={cls} aria-current={active ? 'page' : undefined}>{children}</Link>;
}
