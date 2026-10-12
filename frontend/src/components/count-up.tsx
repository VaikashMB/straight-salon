import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// A whole number that counts up from 0 when it first renders (the CSS count-up utility, no
// JavaScript). Screen readers get the real number; the animated one is hidden from them.
export function CountUp({ value, className }: { value: number; className?: string }) {
  const to = Math.max(0, Math.round(value));
  return (
    <span className={cn('tabular-nums', className)}>
      <span className="sr-only">{to}</span>
      <span aria-hidden className="count-up" style={{ '--to': to } as CSSProperties} />
    </span>
  );
}
