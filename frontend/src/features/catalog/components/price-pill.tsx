import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A price on a brass-tinted pill (text in accent-ink, which passes AA on the tint).
export function PricePill({
  children,
  size = 'sm',
  className,
}: {
  children: ReactNode;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full bg-accent-soft font-semibold whitespace-nowrap text-accent-ink tabular-nums ring-1 ring-accent/30',
        size === 'sm' ? 'px-3 py-1 text-sm' : 'px-4 py-1.5 text-lg',
        className,
      )}
    >
      {children}
    </span>
  );
}
