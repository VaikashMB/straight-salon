'use client';

import type { ReactElement } from 'react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { useNow } from '@/features/admin-calendar/use-now';
import { useBookingSearch, type Booking } from '@/features/booking/api';
import { StatusActions } from '@/features/booking/components/status-actions';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { firstName, STATUS_DOT, STATUS_EDGE } from '@/features/booking/status';
import { formatCalendarDate, formatTime } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { todayInZone } from '@/lib/time';
import { cn } from '@/lib/utils';

const POLL_MS = 60_000; // 05 §4.3

// Where the "now" marker goes in today's list: before the first booking that hasn't started
// yet (list.length when all have started).
export function nowIndex(bookings: readonly Pick<Booking, 'startAt'>[], now: Date): number {
  const i = bookings.findIndex((b) => new Date(b.startAt) > now);
  return i < 0 ? bookings.length : i;
}

// US-04 / 05 §4.3: today's bookings as a vertical timeline, with only the next valid status
// action(s). Refreshes every minute.
export function MyDay() {
  const { data: settings } = usePublicSettings();
  if (!settings) return <LoadingList label="Loading your day" />;
  return <Day timeZone={settings.timezone} />;
}

function Day({ timeZone }: { timeZone: string }) {
  const today = todayInZone(timeZone);
  const now = useNow();
  const bookings = useBookingSearch(
    { date: today, pageSize: 100, sort: 'startAt' },
    { refetchInterval: POLL_MS },
  );
  const list = bookings.data?.data.filter((b) => b.status !== 'CANCELLED') ?? [];
  const done = list.filter((b) => b.status === 'COMPLETED').length;

  const renderBookings = () => {
    if (bookings.isPending) return <LoadingList label="Loading bookings" />;
    if (bookings.error)
      return <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />;
    if (list.length === 0)
      return (
        <EmptyState
          illustration="calendar"
          title="No bookings today"
          description="New bookings will appear here automatically."
        />
      );
    const marker = nowIndex(list, now);
    const nowLine = (
      <li key="now-line" aria-hidden className="relative -my-1 flex items-center gap-2" data-now>
        <span className="absolute top-1/2 -left-[1.9rem] size-2.5 -translate-y-1/2 rounded-full bg-destructive ring-4 ring-background" />
        <span className="text-xs font-semibold text-destructive tabular-nums">
          Now {formatTime(now, timeZone)}
        </span>
        <span className="h-px flex-1 bg-destructive/50" />
      </li>
    );
    const items: ReactElement[] = list.map((b, i) => (
      <MyDayItem key={b.id} booking={b} timeZone={timeZone} index={i} />
    ));
    items.splice(marker, 0, nowLine);
    return <ol className="relative grid gap-4 border-l-2 border-border/80 pl-6">{items}</ol>;
  };

  return (
    <section className="grid gap-6">
      <PageHeader
        eyebrow="Stylist"
        title="My day"
        description={`${formatCalendarDate(today)}${bookings.data ? ` · ${list.length} bookings, ${done} completed` : ''}`}
      />
      {renderBookings()}
    </section>
  );
}

function MyDayItem({
  booking: b,
  timeZone,
  index,
}: {
  booking: Booking;
  timeZone: string;
  index: number;
}) {
  return (
    <li
      className="relative animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-5 -left-[1.95rem] size-3 rounded-full ring-4 ring-background',
          STATUS_DOT[b.status],
        )}
      />
      <article
        className={cn(
          'grid gap-3 rounded-xl border border-l-4 bg-card p-4 shadow-soft transition-shadow hover:shadow-lift',
          STATUS_EDGE[b.status],
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            <span className="tabular-nums">
              {formatTime(b.startAt, timeZone)}–{formatTime(b.endAt, timeZone)}
            </span>{' '}
            · {firstName(b.customer.name)}
          </h2>
          <StatusBadge status={b.status} />
        </div>
        <p className="text-sm">{b.services.map((s) => s.name).join(', ')}</p>
        {b.notes ? (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            Note: {b.notes}
          </p>
        ) : null}
        <StatusActions booking={b} />
      </article>
    </li>
  );
}
