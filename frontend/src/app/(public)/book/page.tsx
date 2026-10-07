import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BookingWizard } from '@/features/booking/components/booking-wizard';

export const metadata: Metadata = { title: 'Book an appointment' };

// The booking wizard reads its state from the URL (useSearchParams needs a Suspense boundary).
export default function BookPage() {
  return (
    <Suspense>
      <BookingWizard />
    </Suspense>
  );
}
