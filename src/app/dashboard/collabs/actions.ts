'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { saveCollab, deleteCollab, setRsvp, cloneCollab, sendInvites, type Upload } from '@/services/collabs';
import { siteBase } from '@/lib/base-url';

const fileOf = async (v: FormDataEntryValue | null): Promise<Upload | null> => {
  if (!v || typeof v === 'string' || !(v as File).size) return null;
  const f = v as File;
  return { bytes: Buffer.from(await f.arrayBuffer()), mime: f.type || 'application/octet-stream', name: f.name };
};
const S = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const go = (path: string, key: 'ok' | 'err', msg: string): never => redirect(`${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(msg)}`);

export async function collabSaveAction(f: FormData) {
  const u = await requireUser('events.manage');
  const id = S(f, 'id') || null;
  const back = id ? `/dashboard/collabs/${id}` : '/dashboard/collabs/new';
  let saved = '';
  try {
    const meals = [];
    for (let i = 0; i < 8; i++) {
      if (f.get(`m${i}_present`) == null) continue;
      meals.push({
        titleAr: S(f, `m${i}_titleAr`), titleEn: S(f, `m${i}_titleEn`), pointsAr: S(f, `m${i}_pointsAr`), pointsEn: S(f, `m${i}_pointsEn`),
        img: S(f, `m${i}_img`) || null, photo: await fileOf(f.get(`m${i}_photo`)), remove: f.get(`m${i}_remove`) === 'on',
        pick: S(f, `m${i}_mode`) === 'menu' ? S(f, `m${i}_pick`) : '',
      });
    }
    const photos: Upload[] = [];
    for (const p of f.getAll('photos')) { const x = await fileOf(p); if (x) photos.push(x); }
    saved = await saveCollab({
      id, active: f.get('active') === 'on', partnerName: S(f, 'partnerName'), partnerLink: S(f, 'partnerLink'),
      titleAr: S(f, 'titleAr'), titleEn: S(f, 'titleEn'), descAr: S(f, 'descAr'), descEn: S(f, 'descEn'),
      date: S(f, 'date'), startTime: S(f, 'startTime'), endTime: S(f, 'endTime'), placeAr: S(f, 'placeAr'), placeEn: S(f, 'placeEn'),
      priceAr: S(f, 'priceAr'), priceEn: S(f, 'priceEn'), capacity: S(f, 'capacity') ? Number(S(f, 'capacity')) : null,
      accent: S(f, 'accent'), askEmail: f.get('askEmail') === 'on', notifyEmails: S(f, 'notifyEmails'),
      logo: await fileOf(f.get('logo')), cover: await fileOf(f.get('cover')), removeCover: f.get('removeCover') === 'on', newPhotos: photos, keepPhotos: f.getAll('keepPhoto').map(String), meals,
      priceMode: S(f, 'priceMode'), price: S(f, 'price'), signupMode: S(f, 'signupMode'), signupUrl: S(f, 'signupUrl'), waGroup: S(f, 'waGroup'), mapUrl: S(f, 'mapUrl'),
      questions: Array.from({ length: 8 }, (_, i) => i).filter((i) => f.get(`q${i}_present`) != null && f.get(`q${i}_remove`) !== 'on').map((i) => ({
        id: S(f, `q${i}_id`), labelAr: S(f, `q${i}_labelAr`), labelEn: S(f, `q${i}_labelEn`), type: S(f, `q${i}_type`),
        optionsAr: String(f.get(`q${i}_optionsAr`) ?? ''), optionsEn: String(f.get(`q${i}_optionsEn`) ?? ''), required: f.get(`q${i}_required`) === 'on',
      })),
    }, u.email);
  } catch (e) { go(back, 'err', (e as Error).message || 'Could not save'); }
  revalidatePath('/dashboard/collabs');
  go(`/dashboard/collabs/${saved}`, 'ok', 'Saved. The page is live at the link above.');
}

export async function collabDeleteAction(f: FormData) {
  const u = await requireUser('events.manage');
  await deleteCollab(S(f, 'id'), u.email);
  revalidatePath('/dashboard/collabs');
  go('/dashboard/collabs', 'ok', 'Deleted');
}

export async function collabRsvpAction(f: FormData) {
  const u = await requireUser('events.bookings');
  const op = S(f, 'op') as 'cancel' | 'restore' | 'checkin' | 'uncheck';
  if (!['cancel', 'restore', 'checkin', 'uncheck'].includes(op)) return;
  const cid = await setRsvp(S(f, 'id'), op, u.email);
  revalidatePath(`/dashboard/collabs/${cid}`);
  redirect(`/dashboard/collabs/${cid}#list`);
}

export async function collabCloneAction(f: FormData) {
  const u = await requireUser('events.manage');
  let nid = '';
  try { nid = await cloneCollab(S(f, 'id'), S(f, 'date') || null, u.email); }
  catch (e) { go(`/dashboard/collabs/${S(f, 'id')}`, 'err', (e as Error).message || 'Could not copy'); }
  revalidatePath('/dashboard/collabs');
  go(`/dashboard/collabs/${nid}`, 'ok', 'Copy made (hidden). Check it, then tick «Page is live» and save.');
}

export async function collabInviteAction(f: FormData) {
  const u = await requireUser('events.manage');
  const id = S(f, 'id');
  const back = `/dashboard/collabs/${id}/invite`;
  const extra = S(f, 'extra').split(/[\s,;]+/).filter(Boolean);
  let r = { sent: 0, failed: 0, skipped: 0 };
  try {
    r = await sendInvites(id, [...f.getAll('to').map(String), ...extra], { subject: S(f, 'subject'), message: String(f.get('message') ?? ''), lang: S(f, 'lang') === 'en' ? 'en' : 'ar' }, await siteBase().catch(() => ''), u.email);
  } catch (e) { go(back, 'err', (e as Error).message || 'Could not send'); }
  revalidatePath(back);
  go(back, r.failed ? 'err' : 'ok', `Sent ${r.sent}${r.failed ? `, failed ${r.failed}` : ''}${r.skipped ? `, skipped ${r.skipped} (asked for no invitations)` : ''}.`);
}
