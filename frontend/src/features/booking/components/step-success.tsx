'use client';

import { ArrowRight, CalendarPlus, Check } from 'lucide-react';
import Link from 'next/link';
import { ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatMoney } from '@/lib/format';
import { usePublicSettings } from '@/lib/settings';
import { useBooking } from '../api';
import { buildIcs, downloadFile } from '../ics';

// Step 5 (05 §4.1): booking reference, add-to-calendar and a link to "My bookings". Reads the
// booking by id from the URL, so a refresh still shows it.
export function StepSuccess({ bookingId }: { bookingId: string }) {
  const booking = useBooking(bookingId);
  const { data: settings } = usePublicSettings();
  if (booking.isPending || !settings) return <LoadingList rows={2} label="Loading your booking" />;
  if (booking.error)
    return <ErrorState error={booking.error} onRetry={() => void booking.refetch()} />;
  const b = booking.data;

  const addToCalendar = () => {
    const ics = buildIcs({
      uid: `${b.id}@straightsalon`,
      title: `${b.services.map((s) => s.name).join(', ')} at ${settings.name}`,
      description: `Booking ${b.bookingRef} with ${b.staff.displayName}.`,
      location: settings.address,
      startAt: b.startAt,
      endAt: b.endAt,
    });
    downloadFile(`${b.bookingRef}.ics`, new Blob([ics], { type: 'text/calendar' }));
  };

  return (
    <section className="mx-auto grid w-full max-w-lg justify-items-center gap-6 py-4 text-center">
      <span
        aria-hidden
        className="grid size-20 animate-pop place-content-center rounded-full bg-success/12 text-success ring-8 ring-success/5"
      >
        <Check className="size-10" strokeWidth={2.5} />
      </span>
      <div className="grid justify-items-center gap-2">
        <h2 className="text-2xl font-semibold sm:text-3xl">You&apos;re booked!</h2>
        <p className="text-muted-foreground">
          We&apos;ve sent a confirmation. Keep your reference handy.
        </p>
      </div>

      {/* The booking as a ticket stub: reference on top, a perforated edge, details below. */}
      <div className="w-full animate-fade-up overflow-hidden rounded-2xl border bg-card text-left shadow-lift [animation-delay:150ms]">
        <div className="grid justify-items-center gap-1 bg-accent-soft px-5 py-5 text-center">
          <p className="text-xs font-semibold tracking-[0.18em] text-accent-ink uppercase">
            Booking reference
          </p>
          <p className="font-mono text-2xl font-semibold tracking-wider tabular-nums sm:text-3xl">
            {b.bookingRef}
          </p>
        </div>
        <div
          aria-hidden
          className="relative h-0 border-t-2 border-dashed before:absolute before:top-0 before:-left-3 before:size-6 before:-translate-y-1/2 before:rounded-full before:border before:bg-background after:absolute after:top-0 after:-right-3 after:size-6 after:-translate-y-1/2 after:rounded-full after:border after:bg-background"
        />
        <dl className="grid gap-3 px-5 py-5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">When</dt>
            <dd className="text-right font-medium">
              {formatDateTime(b.startAt, settings.timezone)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Stylist</dt>
            <dd className="text-right font-medium">{b.staff.displayName}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Services</dt>
            <dd className="text-right font-medium">{b.services.map((s) => s.name).join(', ')}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t pt-3 text-base">
            <dt className="font-semibold">Total</dt>
            <dd className="font-semibold tabular-nums">
              {formatMoney(b.total.amountMinor, b.total.currency)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid w-full gap-3 sm:flex sm:justify-center">
        <Button variant="outline" size="lg" onClick={addToCalendar}>
          <CalendarPlus aria-hidden /> Add to calendar
        </Button>
        <Button asChild size="lg">
          <Link href="/account">
            My bookings <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}
