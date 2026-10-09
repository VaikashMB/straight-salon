import { CircleAlert, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';

// 05 §7: every list has a loading skeleton, an empty state with an action and an error state
// with retry.

export function LoadingList({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <output className="grid gap-3" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-soft"
          style={{ opacity: 1 - i * 0.15 }}
        >
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </output>
  );
}

export type Illustration = 'inbox' | 'calendar' | 'search';

// Small line-art drawings for empty states: strokes in the current (muted) colour with brass
// accents. Decorative only; the title says what is empty.
function EmptyIllustration({ variant }: { variant: Illustration }) {
  const common = {
    width: 96,
    height: 72,
    viewBox: '0 0 96 72',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    'data-illustration': variant,
    className: 'text-muted-foreground/70',
  } as const;
  if (variant === 'calendar')
    return (
      <svg {...common}>
        <rect x="22" y="14" width="52" height="46" rx="6" className="fill-card" />
        <path d="M22 26h52M34 9v10M62 9v10" />
        <g className="text-accent" stroke="currentColor">
          <rect x="31" y="34" width="8" height="7" rx="1.5" className="fill-accent-soft" />
        </g>
        <path d="M45 37.5h4M57 37.5h8M31 49h8M45 49h4M57 49h8" opacity="0.6" />
        <g className="text-accent" stroke="currentColor">
          <path d="M80 12l1.5 3.5L85 17l-3.5 1.5L80 22l-1.5-3.5L75 17l3.5-1.5z" />
          <circle cx="14" cy="50" r="2" />
        </g>
      </svg>
    );
  if (variant === 'search')
    return (
      <svg {...common}>
        <rect x="14" y="16" width="44" height="40" rx="6" className="fill-card" />
        <path d="M22 28h24M22 36h18M22 44h12" opacity="0.6" />
        <g className="text-accent" stroke="currentColor">
          <circle cx="60" cy="40" r="11" className="fill-accent-soft" />
          <path d="M68 48l10 10" strokeWidth="2.5" />
          <path d="M80 14l1.5 3.5L85 19l-3.5 1.5L80 24l-1.5-3.5L75 19l3.5-1.5z" />
        </g>
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M18 40l10-22h40l10 22v16a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4z" className="fill-card" />
      <path d="M18 40h18l4 7h16l4-7h18" />
      <g className="text-accent" stroke="currentColor">
        <path d="M40 30h16" />
        <path d="M84 10l1.5 3.5L89 15l-3.5 1.5L84 20l-1.5-3.5L79 15l3.5-1.5z" />
        <circle cx="10" cy="24" r="2" />
      </g>
    </svg>
  );
}

export function EmptyState({
  title,
  description,
  action,
  illustration = 'inbox',
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  illustration?: Illustration;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid animate-fade-in justify-items-center gap-2 rounded-2xl border border-dashed bg-card/60 px-6 py-10 text-center',
        className,
      )}
    >
      <EmptyIllustration variant={illustration} />
      <p className="mt-2 font-heading text-lg font-semibold">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="grid animate-fade-in justify-items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-8 text-center"
    >
      <span className="grid size-10 place-content-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert aria-hidden className="size-5" />
      </span>
      <p className="max-w-md text-sm">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
