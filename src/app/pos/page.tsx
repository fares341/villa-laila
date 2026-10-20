import type { Metadata, Viewport } from 'next';
import { requireUser } from '@/lib/auth';
import { PosApp } from './pos-app';
import '@/styles/pos.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Point of Sale · Villa Layla', robots: { index: false, follow: false } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1, userScalable: false, themeColor: '#2F2925' };

export default async function PosPage() {
  const u = await requireUser('pos.use');
  return <PosApp hotel="Villa Layla Hostel" branch="Cairo · El Sayeda Zeinab" device={u.name} />;
}
