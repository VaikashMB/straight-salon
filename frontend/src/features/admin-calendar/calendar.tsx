'use client';

import { useQueries } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useBookingSearch, useStylists, type Booking } from '@/features/booking/api';
import { BookingActions } from '@/features/booking/components/booking-actions';
import { StatusBadge } from '@/features/booking/components/status-badge';
import { STATUS_LABEL, type BookingStatus } from '@/features/booking/status';
import { unwrap } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { formatCalendarDate, formatMoney, formatTime } from '@/lib/format';
import { usePublicSettings, type PublicSettings } from '@/lib/settings';
import { addDays, minutesToHhmm, todayInZone, weekdayOf } from '@/lib/time';
import { cn } from '@/lib/utils';
import { blockedRanges, minutesOnDate, rowCount, rowSpan, salonWindow } from './layout';

const BLOCK_STYLE: Record<BookingStatus, string> = {
  BOOKED: 'border-sky-600/40 bg-sky-600/15',
  CHECKED_IN: 'border-accent/60 bg-accent/25',
  IN_SERVICE: 'border-warning/50 bg-warning/20',
  COMPLETED: 'border-success/40 bg-success/15',
  CANCELLED: 'border-border bg-muted',
  NO_SHOW: 'border-destructive/40 bg-destructive/15',
};

const HATCH =
  'bg-[repeating-linear-gradient(135deg,var(--muted)_0,var(--muted)_6px,transparent_6px,transparent_12px)]';

// Day timeline by stylist (05 §4.4): columns are stylists, rows slot-sized steps; bookings
// coloured by status (with their status in text), breaks and time-off hatched. Clicking a
// booking opens a drawer with its actions.
export function AdminCalendar() {
  const { data: settings } = usePublicSettings();
  if (!settings) return <LoadingList label="Loading calendar" />;
  return <Calendar settings={settings} />;
}

function Calendar({ settings }: { settings: PublicSettings }) {
  const { api } = useAuth();
  const timeZone = settings.timezone;
  const step = settings.slotGranularityMin;
  const [date, setDate] = useState(() => todayInZone(timeZone));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const stylists = useStylists();
  const bookings = useBookingSearch({ date, pageSize: 100, sort: 'startAt' });
  const staff = stylists.data ?? [];

  const schedules = useQueries({
    queries: staff.map((s) => ({
      queryKey: ['staff', s.id, 'schedule'],
      queryFn: () =>
        unwrap(api.GET('/api/v1/staff/{id}/schedule', { params: { path: { id: s.id } } })),
    })),
  });
  const timeOff = useQueries({
    queries: staff.map((s) => ({
      queryKey: ['staff', s.id, 'time-off', date, date],
      queryFn: () =>
        unwrap(
          api.GET('/api/v1/staff/{id}/time-off', {
            params: { path: { id: s.id }, query: { from: date, to: date } },
          }),
        ),
    })),
  });

  const window = salonWindow(settings, date);
  const list = (bookings.data?.data ?? []).filter((b) => b.status !== 'CANCELLED');
  const selected = list.find((b) => b.id === selectedId) ?? null;

  const header = (
    <PageHeader
      title="Calendar"
      description={formatCalendarDate(date)}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous day"
            onClick={() => setDate(addDays(date, -1))}
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Input
            type="date"
            aria-label="Date"
            className="w-40"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Next day"
            onClick={() => setDate(addDays(date, 1))}
          >
            <ChevronRight aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => setDate(todayInZone(timeZone))}>
            Today
          </Button>
        </div>
      }
    />
  );

  if (stylists.isPending || bookings.isPending) {
    return (
      <section className="grid gap-6">
        {header}
        <LoadingList rows={4} label="Loading calendar" />
      </section>
    );
  }
  const error = stylists.error ?? bookings.error;
  if (error) {
    return (
      <section className="grid gap-6">
        {header}
        <ErrorState
          error={error}
          onRetry={() => {
            void stylists.refetch();
            void bookings.refetch();
          }}
        />
      </section>
    );
  }
  if (!window) {
    return (
      <section className="grid gap-6">
        {header}
        <EmptyState title="The salon is closed on this day" />
      </section>
    );
  }

  const rows = rowCount(window, step);
  const columns = `4rem repeat(${staff.length}, minmax(9rem, 1fr))`;

  return (
    <section className="grid gap-6">
      {header}
      <div className="overflow-x-auto rounded-lg border bg-card">
        <div
          className="relative grid min-w-fit"
          style={{
            gridTemplateColumns: columns,
            gridTemplateRows: `2.5rem repeat(${rows}, 1.75rem)`,
          }}
        >
          <div className="sticky left-0 z-20 border-b bg-card" />
          {staff.map((s, i) => (
            <div
              key={s.id}
              className="border-b border-l px-2 py-2 text-sm font-medium"
              style={{ gridColumn: i + 2, gridRow: 1 }}
            >
              {s.displayName}
            </div>
          ))}
          {Array.from({ length: rows }, (_, r) => {
            const minute = window.open + r * step;
            return (
              <div
                key={`t-${minute}`}
                className="sticky left-0 z-10 border-t bg-card pr-2 text-right text-xs text-muted-foreground"
                style={{ gridColumn: 1, gridRow: r + 2 }}
              >
                {minute % 60 === 0 ? minutesToHhmm(minute) : ''}
              </div>
            );
          })}
          {staff.map((s, i) =>
            Array.from({ length: rows }, (_, r) => (
              <div
                key={`c-${s.id}-${r}`}
                aria-hidden
                className={cn('border-l', (window.open + r * step) % 60 === 0 && 'border-t')}
                style={{ gridColumn: i + 2, gridRow: r + 2 }}
              />
            )),
          )}
          {staff.map((s, i) => {
            const day = schedules[i]?.data?.weekly.find((d) => d.dayOfWeek === weekdayOf(date));
            return blockedRanges(day, timeOff[i]?.data ?? [], date, timeZone, window).map(
              (range) => {
                const span = rowSpan(range.start, range.end, window, step);
                if (!span) return null;
                return (
                  <div
                    key={`b-${s.id}-${range.start}-${range.label}`}
                    title={`${s.displayName}: ${range.label} ${minutesToHhmm(range.start)}–${minutesToHhmm(Math.min(range.end, 24 * 60 - 1))}`}
                    className={cn(
                      'pointer-events-none m-0.5 rounded-sm px-1 text-[0.65rem] text-muted-foreground',
                      HATCH,
                    )}
                    style={{ gridColumn: i + 2, gridRow: `${span.rowStart} / ${span.rowEnd}` }}
                  >
                    {range.label}
                  </div>
                );
              },
            );
          })}
          {list.map((b) => {
            const column = staff.findIndex((s) => s.id === b.staff.id);
            const minutes = minutesOnDate(b.startAt, b.endAt, date, timeZone);
            const span = minutes && rowSpan(minutes.start, minutes.end, window, step);
            if (column < 0 || !span) return null;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setSelectedId(b.id)}
                aria-label={`${formatTime(b.startAt, timeZone)}–${formatTime(b.endAt, timeZone)} ${b.customer.name}, ${b.services.map((s) => s.name).join(', ')}, ${STATUS_LABEL[b.status]}`}
                className={cn(
                  'relative z-10 m-0.5 grid content-start overflow-hidden rounded-md border px-2 py-1 text-left text-xs outline-none hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  BLOCK_STYLE[b.status],
                )}
                style={{ gridColumn: column + 2, gridRow: `${span.rowStart} / ${span.rowEnd}` }}
              >
                <span className="font-medium">
                  {formatTime(b.startAt, timeZone)} {b.customer.name}
                </span>
                <span className="truncate">{b.services.map((s) => s.name).join(', ')}</span>
                <span className="text-[0.65rem] uppercase">{STATUS_LABEL[b.status]}</span>
              </button>
            );
          })}
        </div>
      </div>
      {staff.length === 0 ? <EmptyState title="No active stylists" /> : null}
      <BookingDrawer booking={selected} timeZone={timeZone} onClose={() => setSelectedId(null)} />
    </section>
  );
}

function BookingDrawer({
  booking,
  timeZone,
  onClose,
}: {
  booking: Booking | null;
  timeZone: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={booking !== null} onOpenChange={(open) => !open && onClose()}>
      {booking ? (
        <DialogContent side="right">
          <DialogHeader>
            <DialogTitle>{booking.customer.name}</DialogTitle>
            <DialogDescription>
              {booking.bookingRef} · {formatTime(booking.startAt, timeZone)}–
              {formatTime(booking.endAt, timeZone)} with {booking.staff.displayName}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            <StatusBadge status={booking.status} />
            <p>{booking.services.map((s) => s.name).join(', ')}</p>
            <p>
              {formatMoney(booking.total.amountMinor, booking.total.currency)} ·{' '}
              {booking.payment.status === 'PAID' ? 'Paid' : 'Unpaid'}
            </p>
            {booking.notes ? <p className="text-muted-foreground">Note: {booking.notes}</p> : null}
          </div>
          <BookingActions booking={booking} timeZone={timeZone} />
          <Button asChild variant="link" className="justify-self-start px-0">
            <Link href={`/admin/bookings/${booking.id}`}>Open booking</Link>
          </Button>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
