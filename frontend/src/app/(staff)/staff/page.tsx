import type { Metadata } from 'next';
import { AreaWelcome } from '@/features/areas/area-welcome';

export const metadata: Metadata = { title: 'My day' };

export default function StaffPage() {
  return (
    <AreaWelcome heading="Good to see you" comingSoon="Your schedule for today will appear here." />
  );
}
