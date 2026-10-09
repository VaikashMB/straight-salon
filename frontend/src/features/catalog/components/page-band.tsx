import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// The brass-glow backdrop with film grain behind a public page's title area (and the auth and
// error pages). The grain is a decorative layer only.
export function PageBand({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <div className={cn('relative isolate overflow-hidden border-b bg-hero', className)}>
      <GrainLayer />
      <div className={cn('mx-auto max-w-6xl px-4 py-12 sm:py-16', innerClassName)}>{children}</div>
    </div>
  );
}

export function GrainLayer() {
  return <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-grain" />;
}
