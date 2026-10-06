import type { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-100 overflow-hidden font-sans">
      {children}
    </div>
  );
}
