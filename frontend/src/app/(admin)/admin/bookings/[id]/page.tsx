import type { Metadata } from 'next';
import { AdminBookingDetail } from '@/features/admin-bookings/admin-booking-detail';

export const metadata: Metadata = { title: 'Booking' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminBookingDetail id={id} />;
}
