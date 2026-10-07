import type { Metadata } from 'next';
import { BookingsTable } from '@/features/admin-bookings/bookings-table';

export const metadata: Metadata = { title: 'Bookings' };

export default function Page() {
  return <BookingsTable />;
}
