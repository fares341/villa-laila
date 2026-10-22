import { redirect } from 'next/navigation';

// The movement cockpit is now the Today page.
export default async function FrontDesk({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null) as [string, string][]).toString();
  redirect('/dashboard' + (qs ? '?' + qs : '') + (sp.walkin ? '#walkin' : ''));
}
