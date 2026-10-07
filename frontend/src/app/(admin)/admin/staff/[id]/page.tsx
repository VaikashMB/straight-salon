import type { Metadata } from 'next';
import { AdminOnly } from '@/components/layout/admin-only';
import { StaffDetail } from '@/features/admin-staff/staff-detail';

export const metadata: Metadata = { title: 'Stylist' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AdminOnly>
      <StaffDetail id={id} />
    </AdminOnly>
  );
}
