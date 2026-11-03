'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { setApplication, deleteApplication, setHiringEmails } from '@/services/applications';

const S = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

export async function applicationAction(f: FormData) {
  const u = await requireUser('staff.view');
  const id = S(f, 'id');
  if (S(f, 'op') === 'delete') await deleteApplication(id, u.email);
  else await setApplication(id, { status: S(f, 'status') || undefined, staffNote: f.has('staffNote') ? S(f, 'staffNote') : null }, u.email);
  revalidatePath('/dashboard/applications');
  redirect(`/dashboard/applications${S(f, 'back') || ''}#a-${id}`);
}

export async function hiringEmailsAction(f: FormData) {
  await requireUser('staff.manage');
  await setHiringEmails(S(f, 'emails'));
  revalidatePath('/dashboard/applications');
  redirect('/dashboard/applications?ok=' + encodeURIComponent('Saved'));
}
