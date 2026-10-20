import { redirect } from 'next/navigation';
// Shifts are opened and blind-closed on the POS; reports live in Shifts & Z-reports.
export default function OldShifts() { redirect('/dashboard/shift-reports'); }
