import { CircleAlert, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';

// 05 §7: every list has a loading skeleton, an empty state with an action and an error state
// with retry.

export function LoadingList({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <output className="grid gap-3" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </output>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid justify-items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
      <Inbox aria-hidden className="size-8 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="grid justify-items-center gap-3 rounded-lg border border-destructive/40 px-4 py-8 text-center"
    >
      <CircleAlert aria-hidden className="size-6 text-destructive" />
      <p className="text-sm">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
