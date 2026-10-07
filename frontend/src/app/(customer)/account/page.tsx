import type { Metadata } from 'next';
import { BookingList } from '@/features/account/components/booking-list';

export const metadata: Metadata = { title: 'My bookings' };

export default function AccountPage() {
  return <BookingList scope="upcoming" />;
}
