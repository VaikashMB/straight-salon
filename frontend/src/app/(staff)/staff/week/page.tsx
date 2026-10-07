import type { Metadata } from 'next';
import { WeekView } from '@/features/staff/components/week-view';

export const metadata: Metadata = { title: 'My week' };

export default function WeekPage() {
  return <WeekView />;
}
