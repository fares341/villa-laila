import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { loginAction } from '../actions';
import { Flash, Input, Lbl, Btn } from '@/components/dash';

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (await currentUser()) redirect('/dashboard');
  const sp = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4" style={{ fontFamily: 'Inter Variable, system-ui' }}>
      <h1 className="text-2xl font-bold text-slate-900">Villa Layla — Staff sign in</h1>
      <p className="mt-1 mb-6 text-sm text-slate-600">Use the email and password given to you by the owner.</p>
      <Flash sp={sp} />
      <form action={loginAction} className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div><Lbl htmlFor="email">Email</Lbl><input id="email" name="email" type="email" required autoComplete="username" className={Input} /></div>
        <div><Lbl htmlFor="pw">Password</Lbl><input id="pw" name="password" type="password" required autoComplete="current-password" className={Input} /></div>
        <button className={`${Btn} w-full`}>Sign in</button>
      </form>
    </main>
  );
}
