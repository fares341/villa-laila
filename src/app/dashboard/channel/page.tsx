import { redirect } from 'next/navigation';

// Little Hotelier is no longer used from the dashboard: site bookings are entered under "Bookings by source".
export default async function Channel() { redirect('/dashboard/ota'); }
