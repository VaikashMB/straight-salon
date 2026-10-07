import type { Metadata } from 'next';
import { AdminOnly } from '@/components/layout/admin-only';
import { ServicesAdmin } from '@/features/admin-catalog/services-admin';

export const metadata: Metadata = { title: 'Services' };

export default function Page() {
  return (
    <AdminOnly>
      <ServicesAdmin />
    </AdminOnly>
  );
}
