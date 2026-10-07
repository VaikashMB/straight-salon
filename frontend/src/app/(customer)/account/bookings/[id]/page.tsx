import type { Metadata } from 'next';
import { CustomerBookingDetail } from '@/features/account/components/customer-booking-detail';

export const metadata: Metadata = { title: 'Booking' };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerBookingDetail id={id} />;
}
