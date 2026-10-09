'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { useBookingSearch } from '@/features/booking/api';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { firstName, STATUS_EDGE } from '@/features/booking/status';
import { WEEKDAYS } from '@/features/catalog/hours';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatCalendarDate, formatTime } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { addDays, dateInZone, datesBetween, todayInZone, weekdayOf } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useSchedule, type StaffSchedule } from '../api';

// The stylist's next seven days (05 §3 staff/week): working hours from their schedule
// (API-033) and bookings per day (API-052).
export function WeekView() {
  const { data: settings } = usePublicSettings();
  if (!settings) return <LoadingList label="Loading your week" />;
  return <Week timeZone={settings.timezone} />;
}

type ScheduleDay = StaffSchedule['weekly'][number];

// The day's working hours, "Day off", or nothing while the schedule loads.
function hoursLabel(day: ScheduleDay | undefined): string {
  if (!day) return '';
  return day.isWorking ? `${day.start}–${day.end}` : 'Day off';
}

function Week({ timeZone }: { timeZone: string }) {
  const { staffId } = useAuth();
  const [offset, setOffset] = useState(0);
  const from = addDays(todayInZone(timeZone), offset * 7);
  const to = addDays(from, 6);
  const today = todayInZone(timeZone);
  const bookings = useBookingSearch({ from, to, pageSize: 100, sort: 'startAt' });
  const schedule = useSchedule(staffId);

  const renderDays = () => {
    if (bookings.isPending) return <LoadingList label="Loading bookings" rows={4} />;
    if (bookings.error)
      return <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />;
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {datesBetween(from, to).map((date, i) => {
          const day = schedule.data?.weekly.find((d) => d.dayOfWeek === weekdayOf(date));
          const list = bookings.data.data.filter(
            (b) => b.status !== 'CANCELLED' && dateInZone(b.startAt, timeZone) === date,
          );
          const isToday = date === today;
          return (
            <section
              key={date}
              aria-label={formatCalendarDate(date)}
              className={cn(
                'grid animate-fade-up content-start gap-3 rounded-2xl border bg-card p-4 shadow-soft',
                isToday && 'ring-2 ring-accent/50',
                day && !day.isWorking && 'bg-muted/40',
              )}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">
                  {WEEKDAYS[weekdayOf(date)]} {Number(date.slice(8))}
                  {isToday ? (
                    <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-medium text-accent-ink">
                      Today
                    </span>
                  ) : null}
                </h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {hoursLabel(day)}
                </span>
              </div>
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bookings</p>
              ) : (
                <ul className="grid gap-2">
                  {list.map((b) => (
                    <li
                      key={b.id}
                      className={cn(
                        'flex flex-wrap items-center justify-between gap-2 rounded-lg border-l-4 bg-background/60 py-1.5 pr-1 pl-3 text-sm',
                        STATUS_EDGE[b.status],
                      )}
                    >
                      <span>
                        <span className="font-medium tabular-nums">
                          {formatTime(b.startAt, timeZone)}
                        </span>{' '}
                        {firstName(b.customer.name)} · {b.services.map((s) => s.name).join(', ')}
                      </span>
                      <StatusBadge status={b.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    );
  };

  return (
    <section className="grid gap-6">
      <PageHeader
        eyebrow="Stylist"
        title="My week"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous week"
              disabled={offset === 0}
              onClick={() => setOffset((o) => o - 1)}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span className="text-sm" aria-live="polite">
              {formatCalendarDate(from)} – {formatCalendarDate(to)}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next week"
              onClick={() => setOffset((o) => o + 1)}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        }
      />
      {renderDays()}
    </section>
  );
}
