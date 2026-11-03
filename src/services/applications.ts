import { q } from '@/lib/db';
import { audit } from './audit';
import { BookingError } from './errors';
import { getSetting, setSetting } from './settings';

/**
 * "Join the team": applications to work at the villa (receptionist) or to volunteer, sent from the website page
 * /[lang]/join. Same questions as the villa's old Google Form; kept in the database and listed in the dashboard.
 */
export type AppKind = 'job' | 'volunteer';
export type AppStatus = 'new' | 'contacted' | 'interview' | 'accepted' | 'declined';
export const APP_STATUSES: AppStatus[] = ['new', 'contacted', 'interview', 'accepted', 'declined'];

export type ApplicationInput = {
  kind: string; fullName: string; birthDate: string; phone: string; email?: string; languages: string; experience: string; why: string;
  availability: string[]; rotatingShifts: string; startWhen: string; stayLength?: string; note?: string; lang?: string;
};

const clean = (s: unknown, max: number) => String(s ?? '').trim().slice(0, max);

export async function addApplication(v: ApplicationInput) {
  const kind: AppKind = v.kind === 'volunteer' ? 'volunteer' : 'job';
  const need = (val: string, key: string, min = 2) => { if (clean(val, 4000).length < min) throw new BookingError('INVALID_INPUT', key); };
  need(v.fullName, 'name'); need(v.birthDate, 'birth', 4); need(v.languages, 'languages'); need(v.experience, 'experience'); need(v.why, 'why'); need(v.startWhen, 'start');
  if (clean(v.phone, 30).replace(/\D/g, '').length < 7) throw new BookingError('INVALID_INPUT', 'phone');
  const email = clean(v.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BookingError('INVALID_INPUT', 'email');
  const availability = (Array.isArray(v.availability) ? v.availability : []).filter((x) => x === 'full_time' || x === 'part_time');
  if (!availability.length) throw new BookingError('INVALID_INPUT', 'availability');
  const shifts = v.rotatingShifts === 'yes' || v.rotatingShifts === 'no' ? v.rotatingShifts : '';
  if (!shifts) throw new BookingError('INVALID_INPUT', 'shifts');
  if (kind === 'volunteer') need(v.stayLength ?? '', 'stay');
  return (await q<any>(`INSERT INTO job_applications(kind, full_name, birth_date, phone, email, languages, experience, why, availability, rotating_shifts, start_when, stay_length, note, lang)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [kind, clean(v.fullName, 80), clean(v.birthDate, 30), clean(v.phone, 30), email || null, clean(v.languages, 1000), clean(v.experience, 2000), clean(v.why, 2000),
      availability, shifts, clean(v.startWhen, 120), kind === 'volunteer' ? clean(v.stayLength, 120) : null, clean(v.note, 2000) || null, v.lang === 'ar' ? 'ar' : 'en']))[0];
}

export async function listApplications(f: { kind?: string; status?: string } = {}) {
  const where: string[] = [], args: unknown[] = [];
  if (f.kind === 'job' || f.kind === 'volunteer') { args.push(f.kind); where.push(`kind=$${args.length}`); }
  if (APP_STATUSES.includes(f.status as AppStatus)) { args.push(f.status); where.push(`status=$${args.length}`); }
  return q<any>(`SELECT * FROM job_applications ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`, args).catch(() => []);
}

export async function countNewApplications() {
  return Number((await q<any>(`SELECT count(*)::int n FROM job_applications WHERE status='new'`).catch(() => [{ n: 0 }]))[0]?.n ?? 0);
}

export async function setApplication(id: string, v: { status?: string; staffNote?: string | null }, actor: string) {
  const st = APP_STATUSES.includes(v.status as AppStatus) ? v.status : null;
  await q(`UPDATE job_applications SET status=COALESCE($2, status), staff_note=COALESCE($3, staff_note), updated_at=now() WHERE id=$1`, [id, st, v.staffNote == null ? null : clean(v.staffNote, 1000)]);
  await audit(actor, 'application.update', 'job_application', id, { status: st });
}

export async function deleteApplication(id: string, actor: string) {
  await q(`DELETE FROM job_applications WHERE id=$1`, [id]);
  await audit(actor, 'application.delete', 'job_application', id, {});
}

const availText = (a: string[] | null) => (a ?? []).map((x) => (x === 'full_time' ? 'Full-time' : 'Part-time')).join(' + ');

export const appsCsv = (rows: any[]) => {
  const esc = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const head = ['Type', 'Name', 'Date of birth', 'Phone', 'Email', 'Languages', 'Experience', 'Why Villa Layla', 'Available for', 'Rotating shifts OK', 'Can start', 'Can stay (volunteer)', 'Anything else', 'Status', 'Staff note', 'Sent'];
  return [head.map(esc).join(','), ...rows.map((r) => [r.kind === 'volunteer' ? 'Volunteer' : 'Job', r.full_name, r.birth_date, r.phone, r.email, r.languages, r.experience, r.why,
    availText(r.availability), r.rotating_shifts === 'yes' ? 'Yes' : 'No', r.start_when, r.stay_length, r.note, r.status, r.staff_note, new Date(r.created_at).toISOString()].map(esc).join(','))].join('\n');
};

/** E-mails that get every new application (set in the dashboard). */
export const getHiringEmails = async (): Promise<string[]> => ((await getSetting<string[]>('hiring_emails').catch(() => null)) ?? []).filter(Boolean);
export async function setHiringEmails(raw: string) {
  const { parseEmails } = await import('./collabs');
  await setSetting('hiring_emails', parseEmails(raw));
}

/** Tells the team: Telegram (owner bot) and the hiring e-mails. */
export async function notifyApplication(r: any, base = '') {
  const avail = (r.availability ?? []).map((a: string) => (a === 'full_time' ? 'دوام كامل' : 'دوام جزئي')).join(' + ');
  await import('./admin-bot').then((m) => m.notifyApplicationText([
    `🧑‍💼 طلب ${r.kind === 'volunteer' ? 'تطوع' : 'شغل'} جديد من الموقع`,
    `${r.full_name} · ${r.phone}${r.email ? ` · ${r.email}` : ''}`,
    `اللغات: ${r.languages}`,
    `متاح: ${avail} · شيفتات متغيرة: ${r.rotating_shifts === 'yes' ? 'معندوش مشكلة' : 'لأ'} · يبدأ: ${r.start_when}`,
    r.stay_length ? `هيفضل قد إيه: ${r.stay_length}` : '',
    base ? `${base}/dashboard/applications` : '',
  ].filter(Boolean).join('\n'))).catch((e) => console.error('[application telegram]', e));
  const to = await getHiringEmails();
  if (!to.length) return;
  const { sendMail, mailEnabled } = await import('@/lib/mailer');
  if (!mailEnabled()) return;
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
  const rows: [string, string][] = [
    ['Type', r.kind === 'volunteer' ? 'Volunteer' : 'Job (receptionist)'], ['Name', r.full_name], ['Date of birth', r.birth_date], ['Phone / WhatsApp', r.phone], ['E-mail', r.email ?? '—'],
    ['Languages', r.languages], ['Experience', r.experience], ['Why Villa Layla', r.why], ['Available for', availText(r.availability)],
    ['Rotating shifts OK', r.rotating_shifts === 'yes' ? 'Yes' : 'No'], ['Can start', r.start_when],
    ...(r.stay_length ? [['Can stay', r.stay_length] as [string, string]] : []), ...(r.note ? [['Anything else', r.note] as [string, string]] : []),
  ];
  await sendMail({
    to, replyTo: r.email || null,
    subject: `New ${r.kind === 'volunteer' ? 'volunteer' : 'job'} application: ${r.full_name}`,
    text: rows.map(([k, v]) => `${k}: ${v}`).join('\n') + (base ? `\n\n${base}/dashboard/applications` : ''),
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#2F2925"><h2 style="margin:0 0 12px">New ${r.kind === 'volunteer' ? 'volunteer' : 'job'} application</h2>
<table style="border-collapse:collapse;width:100%;font-size:14px">${rows.map(([k, v]) => `<tr><td style="padding:8px 10px;border:1px solid #eadfce;color:#7a6a5c;width:160px;vertical-align:top">${esc(k)}</td><td style="padding:8px 10px;border:1px solid #eadfce;white-space:pre-line">${esc(v)}</td></tr>`).join('')}</table>
${base ? `<p style="margin-top:12px"><a href="${esc(base)}/dashboard/applications">Open in the dashboard</a></p>` : ''}</div>`,
  }).catch((e) => console.error('[application mail]', e));
}
