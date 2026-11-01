import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { PageHeader, Card, Flash, Btn, BtnGhost, BtnDanger, Input, Lbl, Empty, Pill, dt } from '@/components/dash';
import { Icon } from '@/components/icons';
import { CopyButton } from '@/components/copy-button';
import { ConfirmButton } from '@/components/ConfirmButton';
import { RichTextarea } from '@/components/rich-textarea';
import { getCollab, listRsvps, type Collab } from '@/services/collabs';
import { siteBase } from '@/lib/base-url';
import { collabSaveAction, collabDeleteAction, collabRsvpAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function EditCollab({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireUser('events.bookings');
  const { id } = await params;
  const sp = await searchParams;
  const isNew = id === 'new';
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const canEdit = can(u.role, 'events.manage');
  if (isNew && !canEdit) notFound();
  const c: Partial<Collab> = isNew ? { active: true, accent: '#D29A45', photos: [], meals: [], title: {}, description: {}, place: { ar: 'فيلا ليلى، السيدة زينب', en: 'Villa Layla, El Sayeda Zeinab' }, price_note: {} } : (await getCollab(id)) ?? notFound();
  const rsvps = isNew ? [] : await listRsvps(id);
  const going = rsvps.filter((r) => r.status === 'going');
  const people = going.reduce((s, r) => s + Number(r.people), 0);
  const link = isNew ? '' : `${await siteBase().catch(() => '')}/c/${c.slug}`;
  const meals = [...(c.meals ?? []), { title: {}, points: {}, img: null }, { title: {}, points: {}, img: null }].slice(0, 8);

  return (
    <>
      <PageHeader title={isNew ? 'New collab event' : `${c.title?.en || c.title?.ar} & ${c.partner_name}`} sub="Our logo & the partner’s logo, the description, photos, the meals, then the sign-up form. Share the link on Instagram stories.">
        <Link href="/dashboard/collabs" className={BtnGhost}><Icon name="chevron-left" size={16} /> Collab events</Link>
        {!isNew && <a href={`/c/${c.slug}`} target="_blank" rel="noopener" className={BtnGhost}><Icon name="external-link" size={16} /> Open the page</a>}
      </PageHeader>
      <Flash sp={sp} />
      {!isNew && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-cocoa-200 bg-white px-4 py-3 text-sm">
          <b>Link for stories:</b> <code className="rounded bg-cocoa-50 px-2 py-1" dir="ltr">{link}</code>
          <CopyButton text={link} label="Copy link" done="Copied" className={BtnGhost} />
          <span className="ms-auto"><b className="text-lg tabular-nums">{people}</b> people signed up{c.capacity ? ` of ${c.capacity}` : ''}</span>
        </div>
      )}

      {canEdit && (
        <form action={collabSaveAction} encType="multipart/form-data" className="grid gap-5 xl:grid-cols-3">
          {!isNew && <input type="hidden" name="id" value={c.id} />}
          <div className="space-y-5 xl:col-span-2">
            <Card title="Partner">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Lbl htmlFor="c-pn">Partner name</Lbl><input id="c-pn" name="partnerName" required defaultValue={c.partner_name ?? ''} className={Input} placeholder="e.g. Cairo Jazz Club" /></div>
                <div><Lbl htmlFor="c-pl">Their Instagram (@name or link, optional)</Lbl><input id="c-pl" name="partnerLink" defaultValue={c.partner_link ?? ''} dir="ltr" className={Input} placeholder="@partner" /></div>
                <div className="sm:col-span-2 flex items-center gap-4">
                  {c.partner_logo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={c.partner_logo} alt="" className="h-16 w-16 rounded-full border border-cocoa-200 object-cover" />
                    : <span className="grid h-16 w-16 place-items-center rounded-full bg-cocoa-50 text-xs text-slate-500">Logo</span>}
                  <div className="flex-1"><Lbl htmlFor="c-lg">{c.partner_logo ? 'Change their logo' : 'Their logo'} (square PNG/JPG looks best)</Lbl><input id="c-lg" name="logo" type="file" accept="image/*" className={Input} /></div>
                </div>
              </div>
            </Card>
            <Card title="The event">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><Lbl htmlFor="c-ta">Title (Arabic)</Lbl><input id="c-ta" name="titleAr" dir="rtl" defaultValue={c.title?.ar ?? ''} className={Input} /></div>
                <div><Lbl htmlFor="c-te">Title (English)</Lbl><input id="c-te" name="titleEn" defaultValue={c.title?.en ?? ''} className={Input} /></div>
                <div className="sm:col-span-2"><Lbl htmlFor="c-da">Description (Arabic)</Lbl><RichTextarea id="c-da" name="descAr" dir="rtl" rows={9} defaultValue={c.description?.ar ?? ''} /></div>
                <div className="sm:col-span-2"><Lbl htmlFor="c-de">Description (English)</Lbl><RichTextarea id="c-de" name="descEn" rows={9} defaultValue={c.description?.en ?? ''} /></div>
              </div>
            </Card>
            <Card title="Photos">
              {(c.photos ?? []).length > 0 && (
                <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {(c.photos ?? []).map((p) => (
                    <label key={p} className="relative block overflow-hidden rounded-lg border border-cocoa-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p} alt="" className="aspect-square w-full object-cover" />
                      <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-white/90 px-2 py-1 text-xs"><input type="checkbox" name="keepPhoto" value={p} defaultChecked /> keep</span>
                    </label>
                  ))}
                </div>
              )}
              <Lbl htmlFor="c-ph">Add photos (you can pick several)</Lbl><input id="c-ph" name="photos" type="file" accept="image/*" multiple className={Input} />
              <p className="mt-1 text-xs text-slate-500">Untick «keep» to remove a photo. The first photo is the big one at the top.</p>
            </Card>
            <Card title="Meals of the night (optional)">
              <p className="mb-3 text-xs text-slate-500">Shown like our menu: the photo in a gold frame, the name, and up to 6 points about it. Leave the name empty to skip.</p>
              <div className="space-y-4">
                {meals.map((m, i) => (
                  <fieldset key={i} className="rounded-xl border border-cocoa-200 p-3">
                    <legend className="px-1 text-sm font-semibold text-cocoa-800">Meal {i + 1}</legend>
                    <input type="hidden" name={`m${i}_present`} value="1" />
                    <input type="hidden" name={`m${i}_img`} value={m.img ?? ''} />
                    <div className="grid gap-3 sm:grid-cols-[96px_1fr]">
                      {m.img
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={m.img} alt="" className="aspect-square w-24 rounded-lg bg-black object-contain" />
                        : <span className="grid aspect-square w-24 place-items-center rounded-lg bg-cocoa-50 text-xs text-slate-500">No photo</span>}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <input name={`m${i}_titleAr`} dir="rtl" defaultValue={m.title.ar ?? ''} placeholder="اسم الوجبة" className={Input} aria-label="Meal name (Arabic)" />
                        <input name={`m${i}_titleEn`} defaultValue={m.title.en ?? ''} placeholder="Meal name" className={Input} aria-label="Meal name (English)" />
                        <textarea name={`m${i}_pointsAr`} dir="rtl" rows={4} defaultValue={m.points.ar ?? ''} placeholder={'نقطة في كل سطر'} className={Input} aria-label="Points (Arabic)" />
                        <textarea name={`m${i}_pointsEn`} rows={4} defaultValue={m.points.en ?? ''} placeholder={'One point per line'} className={Input} aria-label="Points (English)" />
                        <input name={`m${i}_photo`} type="file" accept="image/*" className={Input} aria-label="Meal photo" />
                        {(m.title.ar || m.title.en) && <label className="flex items-center gap-2 text-sm text-red-700"><input type="checkbox" name={`m${i}_remove`} /> Remove this meal</label>}
                      </div>
                    </div>
                  </fieldset>
                ))}
              </div>
            </Card>
          </div>
          <div className="space-y-5">
            <Card title="When & where">
              <div className="grid gap-3">
                <div><Lbl htmlFor="c-d">Date</Lbl><input id="c-d" name="date" type="date" defaultValue={c.event_date ?? ''} className={Input} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Lbl htmlFor="c-s">Starts</Lbl><input id="c-s" name="startTime" type="time" defaultValue={c.start_time ?? ''} className={Input} /></div>
                  <div><Lbl htmlFor="c-e">Ends</Lbl><input id="c-e" name="endTime" type="time" defaultValue={c.end_time ?? ''} className={Input} /></div>
                </div>
                <div><Lbl htmlFor="c-pa">Place (Arabic)</Lbl><input id="c-pa" name="placeAr" dir="rtl" defaultValue={c.place?.ar ?? ''} className={Input} /></div>
                <div><Lbl htmlFor="c-pe">Place (English)</Lbl><input id="c-pe" name="placeEn" defaultValue={c.place?.en ?? ''} className={Input} /></div>
                <div><Lbl htmlFor="c-pra">Price / entry note (Arabic, optional)</Lbl><input id="c-pra" name="priceAr" dir="rtl" defaultValue={c.price_note?.ar ?? ''} placeholder="مثال: الدخول مجاني · العشا 300 ج.م" className={Input} /></div>
                <div><Lbl htmlFor="c-pre">Price / entry note (English, optional)</Lbl><input id="c-pre" name="priceEn" defaultValue={c.price_note?.en ?? ''} placeholder="e.g. Free entry · dinner EGP 300" className={Input} /></div>
              </div>
            </Card>
            <Card title="Sign-up form">
              <div className="grid gap-3 text-sm">
                <div><Lbl htmlFor="c-cap">Places (people), empty = no limit</Lbl><input id="c-cap" name="capacity" type="number" min={1} defaultValue={c.capacity ?? ''} className={Input} /></div>
                <label className="flex items-center gap-2"><input type="checkbox" name="askEmail" defaultChecked={!!c.ask_email} /> Ask for e-mail too</label>
                <p className="text-xs text-slate-500">The form always asks name, phone and how many people (up to 10). The same phone twice updates the first sign-up.</p>
                <div>
                  <Lbl htmlFor="c-ne">Send every sign-up to these e-mails</Lbl>
                  <textarea id="c-ne" name="notifyEmails" rows={3} dir="ltr" defaultValue={(c.notify_emails ?? []).join('\n')} className={Input} placeholder={'you@villalaylahostel.com\npartner@example.com'} />
                  <p className="mt-1 text-xs text-slate-500">One per line (yours and the partner’s). Each new or changed sign-up is e-mailed to all of them. Leave empty for none.</p>
                </div>
              </div>
            </Card>
            <Card title="Look">
              <div className="grid gap-3 text-sm">
                <div className="flex items-center gap-3"><Lbl htmlFor="c-ac">Colour of the page</Lbl><input id="c-ac" name="accent" type="color" defaultValue={c.accent ?? '#D29A45'} className="h-10 w-16 rounded border border-cocoa-200" /></div>
                <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={c.active !== false} /> Page is live (people can see it and sign up)</label>
              </div>
            </Card>
            <button className={Btn + ' w-full py-3 text-base'}><Icon name="check" size={18} /> {isNew ? 'Create the page' : 'Save changes'}</button>
          </div>
        </form>
      )}

      {!isNew && (
        <Card title={`Who is coming · ${people} people`} className="mt-6" id="list">
          <div className="mb-3 flex flex-wrap gap-2">
            <a href={`/api/dashboard/collab-csv?id=${c.id}`} className={BtnGhost}><Icon name="download" size={16} /> Download the list (Excel / CSV)</a>
          </div>
          {rsvps.length === 0 ? <Empty>Nobody signed up yet. Share the link on your stories.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-left text-slate-600"><tr><th className="py-2">Name</th><th>Phone</th><th>People</th><th>Note</th><th>Signed up</th><th /></tr></thead>
              <tbody>{rsvps.map((r) => (
                <tr key={r.id} className={`border-t border-slate-100 ${r.status !== 'going' ? 'opacity-50' : ''}`}>
                  <td className="py-2"><b>{r.full_name}</b>{r.instagram && <div className="text-xs text-slate-500">@{r.instagram}</div>}{r.email && <div className="text-xs text-slate-500">{r.email}</div>}</td>
                  <td><a className="underline" href={`https://wa.me/${String(r.phone).replace(/\D/g, '')}`} target="_blank" rel="noopener" dir="ltr">{r.phone}</a></td>
                  <td className="tabular-nums">{r.people}</td>
                  <td className="max-w-xs text-xs text-slate-600">{r.note}</td>
                  <td className="text-xs text-slate-500">{dt(r.created_at)}</td>
                  <td className="whitespace-nowrap py-2 text-right">
                    {r.checked_in_at ? <Pill tone="green">Arrived</Pill> : null}
                    <form action={collabRsvpAction} className="inline"><input type="hidden" name="id" value={r.id} />
                      {r.status === 'going' && !r.checked_in_at && <button name="op" value="checkin" className={BtnGhost + ' ms-1 px-2 py-1 text-xs'}>Arrived</button>}
                      {r.status === 'going' && <button name="op" value="cancel" className={BtnGhost + ' ms-1 px-2 py-1 text-xs text-red-700'}>Cancel</button>}
                      {r.status !== 'going' && <button name="op" value="restore" className={BtnGhost + ' ms-1 px-2 py-1 text-xs'}>Restore</button>}
                    </form>
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}

      {!isNew && canEdit && (
        <form action={collabDeleteAction} className="mt-6"><input type="hidden" name="id" value={c.id} />
          <ConfirmButton className={BtnDanger} message="Delete this collab event and its sign-up list? This can’t be undone.">Delete this collab event</ConfirmButton></form>
      )}
    </>
  );
}
