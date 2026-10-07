import type { Metadata } from 'next';
import { AreaWelcome } from '@/features/areas/area-welcome';

export const metadata: Metadata = { title: 'My bookings' };

export default function AccountPage() {
  return (
    <AreaWelcome
      heading="Hi"
      comingSoon="Your upcoming bookings will appear here once online booking opens."
    />
  );
}
