'use client';

import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { useBookingSearch } from '@/features/booking/api';
import { StatusActions } from '@/features/booking/components/status-actions';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { firstName } from '@/features/booking/status';
import { formatCalendarDate, formatTime } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { todayInZone } from '@/lib/time';

const POLL_MS = 60_000; // 05 §4.3

// US-04 / 05 §4.3: today's bookings as a vertical timeline, with only the next valid status
// action(s). Refreshes every minute.
export function MyDay() {
  const { data: settings } = usePublicSettings();
  if (!settings) return <LoadingList label="Loading your day" />;
  return <Day timeZone={settings.timezone} />;
}

function Day({ timeZone }: { timeZone: string }) {
  const today = todayInZone(timeZone);
  const bookings = useBookingSearch(
    { date: today, pageSize: 100, sort: 'startAt' },
    { refetchInterval: POLL_MS },
  );
  const list = bookings.data?.data.filter((b) => b.status !== 'CANCELLED') ?? [];
  const done = list.filter((b) => b.status === 'COMPLETED').length;

  return (
    <section className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-3xl font-semibold">My day</h1>
        <p className="text-muted-foreground">
          {formatCalendarDate(today)}
          {bookings.data ? ` · ${list.length} bookings, ${done} completed` : ''}
        </p>
      </div>
      {bookings.isPending ? (
        <LoadingList label="Loading bookings" />
      ) : bookings.error ? (
        <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          title="No bookings today"
          description="New bookings will appear here automatically."
        />
      ) : (
        <ol className="relative grid gap-4 border-l pl-6">
          {list.map((b) => (
            <li key={b.id} className="relative">
              <span
                aria-hidden
                className="absolute top-5 -left-[1.95rem] size-3 rounded-full border-2 border-background bg-accent"
              />
              <article className="grid gap-3 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">
                    {formatTime(b.startAt, timeZone)}–{formatTime(b.endAt, timeZone)} ·{' '}
                    {firstName(b.customer.name)}
                  </h2>
                  <StatusBadge status={b.status} />
                </div>
                <p className="text-sm">{b.services.map((s) => s.name).join(', ')}</p>
                {b.notes ? <p className="text-sm text-muted-foreground">Note: {b.notes}</p> : null}
                <StatusActions booking={b} />
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
