'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { Pagination } from '@/components/pagination';
import { EmptyState, ErrorState, LoadingList } from '@/components/states/list-states';
import { Button } from '@/components/ui/button';
import { usePublicSettings } from '@/lib/settings';
import { useMyBookings, type Scope } from '../api';
import { AccountBookingCard } from './account-booking-card';

const COPY: Record<
  Scope,
  { title: string; description: string; empty: string; emptyHint: string }
> = {
  upcoming: {
    title: 'Upcoming bookings',
    description: 'Your next visits, soonest first.',
    empty: 'No upcoming bookings',
    emptyHint: 'Book your next visit in under a minute.',
  },
  past: {
    title: 'Booking history',
    description: 'Past visits, latest first.',
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

  const renderBookings = () => {
    if (bookings.isPending || !settings) return <LoadingList label="Loading bookings" />;
    if (bookings.error)
      return <ErrorState error={bookings.error} onRetry={() => void bookings.refetch()} />;
    if (bookings.data.data.length === 0)
      return (
        <EmptyState
          illustration="calendar"
          title={copy.empty}
          description={copy.emptyHint}
          action={
            <Button asChild variant="outline">
              <Link href="/book">Book an appointment</Link>
            </Button>
          }
        />
      );
    return (
      <>
        <div className="grid gap-3">
          {bookings.data.data.map((booking, i) => (
            <AccountBookingCard
              key={booking.id}
              booking={booking}
              timeZone={settings.timezone}
              index={i}
            />
          ))}
        </div>
        <Pagination
          page={bookings.data.meta.page}
          totalPages={bookings.data.meta.totalPages}
          onPageChange={setPage}
        />
      </>
    );
  };

  return (
    <section className="grid gap-6">
      <PageHeader
        eyebrow="My account"
        title={copy.title}
        description={copy.description}
        actions={
          <Button asChild>
            <Link href="/book">
              <Plus aria-hidden />
              Book now
            </Link>
          </Button>
        }
      />
      {renderBookings()}
    </section>
  );
}
