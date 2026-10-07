import type { Metadata } from 'next';
import { BookingList } from '@/features/account/components/booking-list';

export const metadata: Metadata = { title: 'Booking history' };

export default function HistoryPage() {
  return <BookingList scope="past" />;
}
