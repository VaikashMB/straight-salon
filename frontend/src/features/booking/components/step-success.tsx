'use client';

import { CalendarPlus, CircleCheck } from 'lucide-react';
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
    <section className="mx-auto grid max-w-lg justify-items-center gap-5 py-6 text-center">
      <CircleCheck aria-hidden className="size-14 text-success" />
      <h2 className="text-2xl font-semibold">You&apos;re booked!</h2>
      <p className="text-muted-foreground">
        We&apos;ve sent a confirmation. Your reference is{' '}
        <strong className="text-foreground">{b.bookingRef}</strong>.
      </p>
      <dl className="grid w-full gap-2 rounded-lg border bg-card p-4 text-left text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">When</dt>
          <dd className="font-medium">{formatDateTime(b.startAt, settings.timezone)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Stylist</dt>
          <dd className="font-medium">{b.staff.displayName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Services</dt>
          <dd className="text-right font-medium">{b.services.map((s) => s.name).join(', ')}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-medium">{formatMoney(b.total.amountMinor, b.total.currency)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="outline" onClick={addToCalendar}>
          <CalendarPlus aria-hidden /> Add to calendar
        </Button>
        <Button asChild>
          <Link href="/account">My bookings</Link>
        </Button>
      </div>
    </section>
  );
}
