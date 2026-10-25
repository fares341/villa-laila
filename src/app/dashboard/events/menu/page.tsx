import { requireUser } from '@/lib/auth';
import { PageHeader, Card, Flash, Btn, BtnGhost, BtnDanger, Input, Lbl, SubTabs } from '@/components/dash';
import { Icon } from '@/components/icons';
import { ConfirmButton } from '@/components/ConfirmButton';
import { weeklyMenu, WEEKDAYS } from '@/services/weekly-menu';
import { menuSaveDayAction, menuClearDayAction, menuCopyAction, menuImportAction } from '../actions';

export const dynamic = 'force-dynamic';

const EXAMPLE = `{
  "days": [
    {
      "day": "monday",
      "title_ar": "طاجن لحمة بالبصل", "title_en": "Beef & Onion Tagen",
      "dishes": [
        { "ar": "أرز بالشعرية", "en": "Vermicelli rice" },
        { "ar": "شوربة لسان عصفور", "en": "Orzo soup" },
        { "ar": "سلطة بلدي", "en": "Egyptian salad" }
      ],
      "image": "https://…/monday.jpg"
    }
  ]
}`;

/**
 * Weekly dinner menu: one meal per day of the week (one photo of the plate, its name, the dishes on it).
 * An event with dinner shows the meal of the day the guest picks; the kitchen sees it on the booking.
 */
export default async function WeeklyMenuPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser('events.manage');
  const sp = await searchParams;
  const menu = await weeklyMenu();
  const tabs = [
    { href: '/dashboard/events', label: 'Bookings', icon: 'ticket' },
    { href: '/dashboard/events?tab=events', label: 'Events list', icon: 'calendar-days' },
    { href: '/dashboard/events/menu', label: 'Weekly dinner menu', icon: 'utensils' },
    { href: '/dashboard/events?tab=settings', label: 'Payment accounts & bots', icon: 'settings' },
  ];
  const empty = WEEKDAYS.filter((w) => !menu[w.d]);

  return (
    <>
      <PageHeader title="Weekly dinner menu" sub="One meal for each day of the week. Guests booking an event with dinner see the meal of their day (photo + dishes); the kitchen sees it on the booking." />
      <SubTabs tabs={tabs} current="/dashboard/events/menu" />
      <Flash sp={sp} />

      {empty.length > 0 && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No meal yet for <b>{empty.map((w) => w.en).join(', ')}</b>. On those days the website shows the standard dinner photos.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        {WEEKDAYS.map((w) => {
          const m = menu[w.d];
          return (
            <Card key={w.d} title={`${w.en} · ${w.ar}`}>
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="sm:w-48 sm:flex-shrink-0">
                  {m?.img
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={m.img} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" />
                    : <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-cocoa-50 text-xs text-slate-500">No photo yet</div>}
                </div>
                <form action={menuSaveDayAction} className="grid min-w-0 flex-1 gap-2">
                  <input type="hidden" name="weekday" value={w.d} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div><Lbl htmlFor={`t-ar-${w.d}`}>Meal (Arabic)</Lbl><input id={`t-ar-${w.d}`} name="titleAr" dir="rtl" defaultValue={m?.title.ar ?? ''} maxLength={80} className={Input} placeholder="مثال: طاجن لحمة" /></div>
                    <div><Lbl htmlFor={`t-en-${w.d}`}>Meal (English)</Lbl><input id={`t-en-${w.d}`} name="titleEn" defaultValue={m?.title.en ?? ''} maxLength={80} className={Input} placeholder="e.g. Beef tagine" /></div>
                    <div><Lbl htmlFor={`d-ar-${w.d}`}>On the plate (Arabic, one per line)</Lbl><textarea id={`d-ar-${w.d}`} name="dishesAr" dir="rtl" rows={4} defaultValue={(m?.dishes ?? []).map((x) => x.ar ?? '').join('\n')} className={Input} placeholder={'مثال:\nأرز بالشعرية\nسلطة'} /></div>
                    <div><Lbl htmlFor={`d-en-${w.d}`}>On the plate (English, same order)</Lbl><textarea id={`d-en-${w.d}`} name="dishesEn" rows={4} defaultValue={(m?.dishes ?? []).map((x) => x.en ?? '').join('\n')} className={Input} placeholder={'e.g.\nVermicelli rice\nSalad'} /></div>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-cocoa-700">Short description (optional)</summary>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <input name="descAr" dir="rtl" defaultValue={m?.description.ar ?? ''} maxLength={300} className={Input} aria-label="Description (Arabic)" placeholder="الوصف بالعربي" />
                      <input name="descEn" defaultValue={m?.description.en ?? ''} maxLength={300} className={Input} aria-label="Description (English)" placeholder="Description in English" />
                    </div>
                  </details>
                  <div><Lbl htmlFor={`p-${w.d}`}>{m?.img ? 'Change the photo (optional)' : 'Photo of the meal'}</Lbl><input id={`p-${w.d}`} name="photo" type="file" accept="image/*" className={Input} /></div>
                  <div className="flex flex-wrap gap-2"><button className={Btn}><Icon name="check" size={16} /> Save {w.en}</button></div>
                </form>
              </div>
              {m && (
                <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-cocoa-100 pt-3">
                  <details>
                    <summary className="cursor-pointer text-xs font-semibold text-cocoa-700">Copy {w.en}&apos;s meal to other days</summary>
                    <form action={menuCopyAction} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <input type="hidden" name="from" value={w.d} />
                      {WEEKDAYS.filter((o) => o.d !== w.d).map((o) => <label key={o.d} className="inline-flex items-center gap-1"><input type="checkbox" name="to" value={o.d} /> {o.en}</label>)}
                      <ConfirmButton className={BtnGhost} message="The chosen days get this meal (their own is replaced). Continue?">Copy</ConfirmButton>
                    </form>
                  </details>
                  <form action={menuClearDayAction}>
                    <input type="hidden" name="weekday" value={w.d} />
                    <ConfirmButton className={BtnDanger} message={`Clear ${w.en}'s meal?`}><Icon name="trash" size={14} /> Clear day</ConfirmButton>
                  </form>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card title="Import the whole week (JSON)" className="mt-6">
        <p className="mb-3 text-sm text-slate-600">For loading many days at once (for example from another system). Each day: <code>day</code> (monday… or الاثنين… or a date), <code>title_ar</code>, <code>title_en</code>, <code>dishes</code>, <code>image</code> (a photo link; it is downloaded and kept here). Days not in the file stay as they are.</p>
        <form action={menuImportAction} className="grid gap-3">
          <textarea name="json" rows={8} className={Input + ' font-mono text-xs'} dir="ltr" placeholder={EXAMPLE} />
          <div className="flex flex-wrap items-center gap-3"><input name="file" type="file" accept="application/json,.json" className="text-sm" /><button className={Btn}><Icon name="upload" size={16} /> Import</button></div>
        </form>
      </Card>
    </>
  );
}
