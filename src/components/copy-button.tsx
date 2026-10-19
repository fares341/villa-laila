'use client';

import { useState } from 'react';

export function CopyButton({ text, label, done, className = 'btn btn-line' }: { text: string; label: string; done: string; className?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 2000);
        } catch {
          window.prompt(label, text);
        }
      }}
    >
      {ok ? done : label}
    </button>
  );
}
