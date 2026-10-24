import { redirect } from 'next/navigation';

// The bill is part of the guest's stay page now (one page per stay).
export default async function Folio({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v != null) as [string, string][]).toString();
  redirect(`/dashboard/reservations/${encodeURIComponent(id)}${qs ? '?' + qs : ''}`);
}
