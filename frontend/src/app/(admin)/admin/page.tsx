import type { Metadata } from 'next';
import { AreaWelcome } from '@/features/areas/area-welcome';

export const metadata: Metadata = { title: 'Dashboard' };

export default function AdminPage() {
  return (
    <AreaWelcome
      heading="Welcome back"
      comingSoon="Today's bookings, revenue and the stylists' timeline will appear here."
    />
  );
}
