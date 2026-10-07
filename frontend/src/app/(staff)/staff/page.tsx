import type { Metadata } from 'next';
import { MyDay } from '@/features/staff/components/my-day';

export const metadata: Metadata = { title: 'My day' };

export default function StaffPage() {
  return <MyDay />;
}
