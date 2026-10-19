'use client';
export function ConfirmButton({ message, children, className = '', name, value }: { message: string; children: React.ReactNode; className?: string; name?: string; value?: string }) {
  return (
    <button type="submit" name={name} value={value} className={className}
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>{children}</button>
  );
}
