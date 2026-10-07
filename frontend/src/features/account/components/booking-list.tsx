'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Pagination } from '@/components/pagination';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { usePublicSettings } from '@/lib/settings';
import { useMyBookings, type Scope } from '../api';
import { AccountBookingCard } from './account-booking-card';

const COPY: Record<Scope, { title: string; empty: string; emptyHint: string }> = {
  upcoming: {
    title: 'Upcoming bookings',
    empty: 'No upcoming bookings',
    emptyHint: 'Book your next visit in under a minute.',
  },
  past: {
    title: 'Booking history',
    empty: 'No past bookings yet',
    emptyHint: 'Your completed and cancelled bookings will show up here.',
  },
};

// FR-036: upcoming soonest first, history latest first (API-051).
export function BookingList({ scope }: { scope: Scope }) {
  const [page, setPage] = useState(1);
  const bookings = useMyBookings(scope, page);
  const { data: settings } = usePublicSettings();
  const copy = COPY[scope];

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">{copy.title}</h1>
        <Button asChild>
          <Link href="/book">Book now</Link>
        </Button>
      </div>
      {bookings.isPending || !settings ? (
        <LoadingList label="Loading bookings" />
      ) : bookings.error ? (
        <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />
      ) : bookings.data.data.length === 0 ? (
        <EmptyState
          title={copy.empty}
          description={copy.emptyHint}
          action={
            <Button asChild variant="outline">
              <Link href="/book">Book an appointment</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-3">
            {bookings.data.data.map((booking) => (
              <AccountBookingCard key={booking.id} booking={booking} timeZone={settings.timezone} />
            ))}
          </div>
          <Pagination
            page={bookings.data.meta.page}
            totalPages={bookings.data.meta.totalPages}
            onPageChange={setPage}
          />
        </>
      )}
    </section>
  );
}
