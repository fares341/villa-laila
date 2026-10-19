import { currentUser } from '@/lib/auth';
import { DashShell } from '@/components/dash';

export const metadata = { title: 'Villa Layla Dashboard', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  // The login page renders without the shell. Every other page enforces auth itself via requireUser().
  if (!user) return <div className="min-h-screen bg-slate-100">{children}</div>;
  return <DashShell user={user}>{children}</DashShell>;
}
