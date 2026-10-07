import type { Metadata } from 'next';
import { MyTimeOff } from '@/features/staff/components/my-time-off';

export const metadata: Metadata = { title: 'Time off' };

export default function TimeOffPage() {
  return <MyTimeOff />;
}
