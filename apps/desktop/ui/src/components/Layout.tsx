import type { ReactNode } from 'react';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-flinch-deep text-flinch-text overflow-hidden font-sans select-none">
      {children}
    </div>
  );
}
