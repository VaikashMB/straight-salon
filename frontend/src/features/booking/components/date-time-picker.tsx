'use client';

import { format } from 'date-fns';
import { useEffect, useMemo } from 'react';
import { EmptyState, ErrorState } from '@/components/states/list-states';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCalendarDate, formatTime } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { addDays, datesBetween, todayInZone, weekdayOf } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useAvailability, useAvailableDays, type Slot } from '../api';
import { groupSlots } from '../slots';

// Step 3 of the wizard, also used to reschedule (05 §4.1, §4.2): a calendar of the next
// `maxAdvanceDays` with unbookable days disabled (API-041), then start times grouped
// Morning/Afternoon/Evening (API-040), all in the salon timezone.

export interface DateTimePickerProps {
  serviceIds: string[];
  staffId: string; // stylist id or "any"
  date: string | null;
  onDateChange: (date: string) => void;
  value: string | null; // selected startAt
  onSelect: (slot: Slot) => void;
}

const WEEKDAY_HEADINGS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function DateTimePicker(props: DateTimePickerProps) {
  const { data: settings } = usePublicSettings();
  if (!settings) return <PickerSkeleton />;
  return (
    <Picker {...props} timeZone={settings.timezone} maxAdvanceDays={settings.maxAdvanceDays} />
  );
}

function Picker({
  serviceIds,
  staffId,
  date,
  onDateChange,
  value,
  onSelect,
  timeZone,
  maxAdvanceDays,
}: DateTimePickerProps & { timeZone: string; maxAdvanceDays: number }) {
  const today = todayInZone(timeZone);
  const dates = useMemo(
    () => datesBetween(today, addDays(today, maxAdvanceDays)),
    [today, maxAdvanceDays],
  );
  const days = useAvailableDays(serviceIds, staffId, dates);
  const firstAvailable = dates.find((d) => days.availableDates.has(d));

  // Open on the first bookable day, so most people only have to pick a time.
  useEffect(() => {
    if (!date && !days.isPending && firstAvailable) onDateChange(firstAvailable);
  }, [date, days.isPending, firstAvailable, onDateChange]);

  const months = useMemo(() => {
    const byMonth = new Map<string, string[]>();
    for (const d of dates) byMonth.set(d.slice(0, 7), [...(byMonth.get(d.slice(0, 7)) ?? []), d]);
    return [...byMonth.entries()];
  }, [dates]);

  if (days.error) return <ErrorState error={days.error} onRetry={days.refetch} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="grid content-start gap-4" aria-busy={days.isPending}>
        {months.map(([month, monthDates]) => {
          const leading = (weekdayOf(monthDates[0]!) + 6) % 7; // Monday-first grid
          return (
            <fieldset key={month} className="grid gap-2">
              <legend className="mb-2 font-medium">
                {format(toLocalDate(`${month}-01`), 'MMMM yyyy')}
              </legend>
              <div
                aria-hidden
                className="grid grid-cols-7 text-center text-xs text-muted-foreground"
              >
                {WEEKDAY_HEADINGS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: leading }, (_, i) => (
                  <span key={`blank-${i}`} />
                ))}
                {monthDates.map((d) => {
                  const available = days.availableDates.has(d);
                  const selected = d === date;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={days.isPending || !available}
                      aria-pressed={selected}
                      aria-label={format(toLocalDate(d), 'EEEE d MMMM yyyy')}
                      onClick={() => onDateChange(d)}
                      className={cn(
                        'aspect-square rounded-md text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        available ? 'hover:bg-secondary' : 'text-muted-foreground/50 line-through',
                        selected && 'bg-primary text-primary-foreground hover:bg-primary',
                      )}
                    >
                      {Number(d.slice(8))}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="grid content-start gap-4">
        {date ? (
          <Slots
            serviceIds={serviceIds}
            staffId={staffId}
            date={date}
            value={value}
            onSelect={onSelect}
            timeZone={timeZone}
          />
        ) : (
          <NoDateChosen loading={days.isPending} />
        )}
      </div>
    </div>
  );
}

function Slots({
  serviceIds,
  staffId,
  date,
  value,
  onSelect,
  timeZone,
}: {
  serviceIds: string[];
  staffId: string;
  date: string;
  value: string | null;
  onSelect: (slot: Slot) => void;
  timeZone: string;
}) {
  const availability = useAvailability(serviceIds, staffId, date);
  const heading = <h3 className="font-medium">{formatCalendarDate(date)}</h3>;
  if (availability.isPending) {
    return (
      <>
        {heading}
        <SlotSkeleton />
      </>
    );
  }
  if (availability.error) {
    return <ErrorState error={availability.error} onRetry={() => void availability.refetch()} />;
  }
  const groups = groupSlots(availability.data.slots, timeZone);
  return (
    <>
      {heading}
      {groups.length === 0 ? (
        <EmptyState title="No times left on this day" description="Please pick another date." />
      ) : (
        groups.map(({ part, slots }) => (
          <fieldset key={part} aria-label={part} className="m-0 grid min-w-0 gap-2 border-0 p-0">
            <p className="text-sm text-muted-foreground">{part}</p>
            <div className="flex flex-wrap gap-2">
              {slots.map((slot) => {
                const selected = slot.startAt === value;
                return (
                  <button
                    key={slot.startAt}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onSelect(slot)}
                    className={cn(
                      'min-w-20 rounded-md border px-3 py-2 text-sm transition-colors outline-none hover:bg-secondary focus-visible:ring-[3px] focus-visible:ring-ring/50',
                      selected &&
                        'border-primary bg-primary text-primary-foreground hover:bg-primary',
                    )}
                  >
                    {formatTime(slot.startAt, timeZone)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))
      )}
    </>
  );
}

// Before a date is chosen: still looking for the first bookable day, or there is none.
function NoDateChosen({ loading }: Readonly<{ loading: boolean }>) {
  if (loading) return <SlotSkeleton />;
  return (
    <EmptyState
      title="No free times in the next few weeks"
      description="Try fewer services or another stylist, or call the salon."
    />
  );
}

function SlotSkeleton() {
  return (
    <output className="flex flex-wrap gap-2" aria-label="Loading times">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-20" />
      ))}
    </output>
  );
}

function PickerSkeleton() {
  return (
    <output className="grid gap-3" aria-label="Loading calendar">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-64 w-full max-w-sm" />
    </output>
  );
}
