import type { Metadata } from 'next';
import { AdminOnly } from '@/components/layout/admin-only';
import { StaffAdmin } from '@/features/admin-staff/staff-admin';

export const metadata: Metadata = { title: 'Stylists' };

export default function Page() {
  return (
    <AdminOnly>
      <StaffAdmin />
    </AdminOnly>
  );
}
