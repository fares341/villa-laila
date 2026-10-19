import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader, Card, Flash, fmt, dt, Input, Lbl, Btn, BtnGhost } from '@/components/dash';
import { getActiveShift, getShiftsHistory, getExpensesList } from '@/services/frontdesk';
import {
  openShiftAction,
  closeShiftAction,
  takeShiftAction,
  recordExpenseAction,
} from '../frontdesk-actions';
import { ShiftsClient } from './shifts-client';

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser('shifts.manage');
  const sp = await searchParams;

  const activeShift = await getActiveShift();
  const shifts = await getShiftsHistory(35);
  const expenses = await getExpensesList({
    shiftId: activeShift?.id || undefined,
    limit: 40,
  });

  const canTake = can(user.role, 'shifts.take');

  return (
    <>
      <PageHeader
        title="الدرج والورديات والخزينة (Cash Drawer & Shifts)"
        sub="تقفيل الدرج اليومي، جرد النقدية بالجنيه والدولار واليورو، تسجيل المصروفات النثرية، وتوريد الخزينة للإدارة."
      >
        <Link href="/dashboard/pos" className={BtnGhost}>
          🛒 نقطة البيع السريعة
        </Link>
        <Link href="/dashboard/reports/services" className={BtnGhost}>
          📊 تقرير مبيعات الخدمات
        </Link>
      </PageHeader>

      <Flash sp={sp} />

      <ShiftsClient
        activeShift={activeShift}
        shifts={shifts}
        expenses={expenses}
        canTake={canTake}
        openShiftAction={openShiftAction}
        closeShiftAction={closeShiftAction}
        takeShiftAction={takeShiftAction}
        recordExpenseAction={recordExpenseAction}
      />
    </>
  );
}
