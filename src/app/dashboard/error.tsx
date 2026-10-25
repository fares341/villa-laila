'use client';

import { useEffect } from 'react';

/**
 * Shown inside the dashboard when a page can't be opened: usually the account's role doesn't include it (a link
 * shared by someone else, an old bookmark), sometimes a real failure. Never the bare "Application error" screen.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[dashboard]', error); }, [error]);
  const forbidden = /FORBIDDEN/.test(error?.message ?? '');
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-cocoa-100 bg-white p-6 text-center shadow-sm">
      <h1 className="text-xl font-bold text-cocoa-900">{forbidden ? 'This page isn’t part of your account' : 'This page didn’t open'}</h1>
      <p className="mt-2 text-sm text-slate-600">
        {forbidden
          ? 'Your login doesn’t include this page. If you need it, ask the owner to change your role in Settings → Dashboard logins.'
          : 'Either your login doesn’t include this page, or something went wrong while loading it. Try again, or go back to your start page.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <a href="/dashboard" className="rounded-xl bg-cocoa-800 px-4 py-2 text-sm font-semibold text-white">Back to my start page</a>
        {!forbidden && <button type="button" onClick={reset} className="rounded-xl border border-cocoa-200 px-4 py-2 text-sm font-semibold text-cocoa-800">Try again</button>}
      </div>
      {error?.digest && <p className="mt-4 text-xs text-slate-400">Ref: {error.digest}</p>}
    </div>
  );
}
