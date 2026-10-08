import type { Metadata } from 'next';
import { AdminOnly } from '@/components/layout/admin-only';
import { ReportsPage } from '@/features/reports/reports-page';

export const metadata: Metadata = { title: 'Reports' };

export default function Page() {
  return (
    <AdminOnly>
      <ReportsPage />
    </AdminOnly>
  );
}
