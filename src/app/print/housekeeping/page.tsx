import { requireUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { todayLocal, addDays } from '@/lib/dates';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'ورقة التنضيف', robots: { index: false } };

/**
 * Printable Arabic housekeeping sheet: every private room and every dorm bed.
 * ✓ = guest checked out today (clean it). ○ = empty since last night (check it is clean and nobody slept in it).
 */
export default async function HousekeepingSheet({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('frontdesk.use');
  const sp = await searchParams;
  const day = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayLocal();
  const yesterday = addDays(day, -1);
  const units = await q<any>(`
    SELECT u.id, u.label, rm.id room_id, rm.name room, rm.hk_status, t.kind, t.sort_order,
      CASE WHEN t.name->>'ar' IS NULL OR t.name->>'ar' = '' THEN rm.name
           WHEN rm.name = t.name->>'en' THEN t.name->>'ar'
           ELSE (t.name->>'ar') || ' · ' || rm.name END room_ar,
      EXISTS (SELECT 1 FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id
              WHERE ru.unit_id=u.id AND upper(ru.during)=$1::date AND r.status IN ('checked_out','checked_in')) departed,
      EXISTS (SELECT 1 FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id
              WHERE ru.unit_id=u.id AND ru.during @> $2::date AND r.status IN ('checked_in','checked_out')) slept_last_night,
      EXISTS (SELECT 1 FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id
              WHERE ru.unit_id=u.id AND ru.active AND ru.during @> $1::date AND lower(ru.during) < $1::date AND r.status='checked_in') stayover,
      EXISTS (SELECT 1 FROM reservation_units ru JOIN reservations r ON r.id=ru.reservation_id
              WHERE ru.unit_id=u.id AND ru.active AND lower(ru.during)=$1::date AND r.status IN ('confirmed','pending','checked_in')) arriving
    FROM units u JOIN rooms rm ON rm.id=u.room_id JOIN room_types t ON t.id=rm.room_type_id
    WHERE u.active AND rm.active AND t.active
    ORDER BY t.kind DESC, rm.sort_order, t.sort_order, rm.name, u.label`, [day, yesterday]);
  const dateAr = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));
  const rooms = new Map<string, any[]>();
  for (const u of units) rooms.set(u.room_id, [...(rooms.get(u.room_id) ?? []), u]);
  const mark = (u: any) => (u.departed ? '✓' : !u.slept_last_night && !u.stayover ? '○' : '');
  const status = (u: any) => (u.departed ? 'خرج النهارده' : u.stayover ? 'مقيم' : !u.slept_last_night ? 'فاضي من امبارح' : '');
  const toClean = units.filter((u) => u.departed).length, toCheck = units.filter((u) => !u.departed && !u.slept_last_night && !u.stayover).length;

  return (
    <div dir="rtl" lang="ar" className="hk-sheet">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap');
        .hk-sheet, .hk-sheet * { font-family: "Tajawal", "Noto Sans Arabic Variable", Tahoma, sans-serif; }
        .hk-sheet { color: #2F2925; background: #fff; max-width: 820px; margin: 0 auto; padding: 24px; }
        .hk-sheet h1 { font-size: 24px; margin: 0; color: #4A3222; }
        .hk-top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #4A3222; padding-bottom: 10px; margin-bottom: 12px; }
        .hk-top p { margin: 4px 0 0; font-size: 14px; }
        .hk-legend { display: flex; gap: 18px; flex-wrap: wrap; font-size: 13px; background: #FBF7F1; border: 1px solid #ECE2D4; border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; }
        .hk-legend b { font-size: 16px; margin-left: 4px; }
        .hk-sheet table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .hk-sheet th { background: #4A3222; color: #fff; padding: 7px 8px; text-align: right; font-weight: 700; }
        .hk-sheet td { border-bottom: 1px solid #E6DACA; padding: 7px 8px; vertical-align: middle; }
        .hk-sheet tr.room-start td { border-top: 2px solid #A88762; }
        .hk-sheet td.m { text-align: center; font-size: 20px; font-weight: 800; width: 48px; }
        .hk-sheet td.box { width: 54px; text-align: center; }
        .hk-sheet td.box span { display: inline-block; width: 20px; height: 20px; border: 2px solid #4A3222; border-radius: 4px; }
        .hk-sheet td.notes { width: 34%; }
        .hk-sheet .arr { font-size: 12px; font-weight: 700; color: #9C4A1E; }
        .hk-sheet .st { font-size: 12px; color: #6B4A30; }
        .hk-foot { display: flex; justify-content: space-between; margin-top: 24px; font-size: 14px; }
        .hk-actions { margin-bottom: 14px; display: flex; gap: 8px; align-items: center; font-family: system-ui, sans-serif; direction: ltr; justify-content: flex-end; }
        .hk-actions button, .hk-actions a { background: #4A3222; color: #fff; border: 0; border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; text-decoration: none; font-size: 14px; }
        .hk-actions a { background: #fff; color: #4A3222; border: 1px solid #ECE2D4; }
        .hk-actions input { border: 1px solid #ECE2D4; border-radius: 8px; padding: 7px 10px; }
        @media print { .hk-actions { display: none; } .hk-sheet { padding: 0; max-width: none; } @page { size: A4; margin: 12mm; } tr { break-inside: avoid; } }
      `}</style>
      <form className="hk-actions">
        <a href="/dashboard/housekeeping">Back</a>
        <input type="date" name="date" defaultValue={day} aria-label="Date" />
        <button type="submit">Show</button>
        <PrintButton />
      </form>
      <div className="hk-top">
        <div><h1>ورقة التنضيف · فيلا ليلى</h1><p>{dateAr}</p></div>
        <p>للتنضيف: <b>{toClean}</b> · للمراجعة: <b>{toCheck}</b></p>
      </div>
      <div className="hk-legend">
        <span><b>✓</b> خرج النهارده (Check-out): لازم يتنضف ويتغيّر الفرش</span>
        <span><b>○</b> فاضي من امبارح: اتأكد إنه نضيف ومحدش نام عليه</span>
        <span><span className="arr">وصول</span> في نزيل جاي النهارده: جهّزه الأول</span>
      </div>
      <table>
        <thead><tr><th>الغرفة / السرير</th><th style={{ textAlign: 'center' }}>علامة</th><th>الحالة</th><th style={{ textAlign: 'center' }}>تم</th><th>ملاحظات</th></tr></thead>
        <tbody>
          {[...rooms.values()].map((list) => list.map((u, i) => (
            <tr key={u.id} className={i === 0 ? 'room-start' : ''}>
              <td><b>{u.room_ar}</b>{u.kind === 'dorm' && <> · {u.label.replace(/^Bed\s*/i, 'سرير ')}</>}</td>
              <td className="m">{mark(u)}</td>
              <td><span className="st">{status(u)}</span>{u.arriving && <> {status(u) ? '· ' : ''}<span className="arr">وصول</span></>}</td>
              <td className="box"><span /></td>
              <td className="notes" />
            </tr>
          )))}
        </tbody>
      </table>
      <div className="hk-foot"><span>اسم المسؤول: ....................................</span><span>التوقيع: ......................</span><span>الساعة: ...........</span></div>
    </div>
  );
}
