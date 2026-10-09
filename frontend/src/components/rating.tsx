import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

// Average rating (FR-061) as stars plus text, so the value never depends on the icons alone.
export function Rating({
  value,
  count,
  className,
}: {
  value: number;
  count: number;
  className?: string;
}) {
  if (count === 0) {
    return <span className={cn('text-sm text-muted-foreground', className)}>No reviews yet</span>;
  }
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm', className)}>
      <Star aria-hidden className="size-4 shrink-0 fill-accent text-accent" />
      <span className="whitespace-nowrap">
        {value.toFixed(1)}
        <span className="text-muted-foreground">
          {' '}
          ({count} {count === 1 ? 'review' : 'reviews'})
        </span>
      </span>
    </span>
  );
}
