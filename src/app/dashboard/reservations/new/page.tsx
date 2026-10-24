import { redirect } from 'next/navigation';

// One booking form for everything: Bookings by source (pick where the booking came from).
export default async function NewReservation({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = new URLSearchParams({ ch: sp.ch ?? 'website' });
  for (const k of ['unit', 'checkIn', 'checkOut'] as const) if (sp[k]) p.set(k, sp[k]!);
  redirect(`/dashboard/ota?${p.toString()}#add`);
}
