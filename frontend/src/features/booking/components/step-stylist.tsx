'use client';

import { Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Rating } from '@/components/rating';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { StylistAvatar } from '@/features/catalog/components/stylist-avatar';
import { cn } from '@/lib/utils';
import { qualifiedFor, useStylists } from '../api';
import { ANY } from '../params';
import { CheckBadge, SELECTABLE_CARD } from './selectable';

// Step 2: "Any available" (default) or a stylist qualified for all chosen services (05 §4.1).
export function StepStylist({
  serviceIds,
  staff,
  onChoose,
}: {
  serviceIds: string[];
  staff: string;
  onChoose: (staff: string) => void;
}) {
  const stylists = useStylists();
  if (stylists.isPending) return <LoadingList rows={3} label="Loading stylists" />;
  if (stylists.error)
    return <ErrorState error={stylists.error} onRetry={() => void stylists.refetch()} />;
  const qualified = qualifiedFor(stylists.data, serviceIds);

  const option = (id: string, content: ReactNode) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={staff === id}
      onClick={() => onChoose(id)}
      className={cn(SELECTABLE_CARD, 'items-center')}
    >
      {content}
      <CheckBadge selected={staff === id} className="ml-auto" />
    </button>
  );

  return (
    <div role="radiogroup" aria-label="Stylist" className="grid gap-3 sm:grid-cols-2">
      {option(
        ANY,
        <>
          <span className="grid size-16 shrink-0 place-content-center rounded-full bg-accent-soft text-accent-ink ring-1 ring-accent/25">
            <Users aria-hidden className="size-6" />
          </span>
          <span className="grid gap-1">
            <span className="font-medium">Any available</span>
            <span className="text-sm text-muted-foreground">
              We&apos;ll match you with whoever is free.
            </span>
          </span>
        </>,
      )}
      {qualified.map((s) =>
        option(
          s.id,
          <>
            <StylistAvatar name={s.displayName} photoUrl={s.photoUrl} />
            <span className="grid gap-1">
              <span className="font-medium">{s.displayName}</span>
              <Rating value={s.ratingAvg} count={s.ratingCount} />
            </span>
          </>,
        ),
      )}
      {qualified.length === 0 ? (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          No single stylist offers all of these services, so we can&apos;t book them together. Try
          removing a service.
        </p>
      ) : null}
    </div>
  );
}
