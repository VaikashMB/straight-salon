import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        'animate-shimmer rounded-md bg-muted bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--card)_60%,transparent),transparent)] bg-size-[200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
