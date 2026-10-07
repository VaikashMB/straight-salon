import type { Metadata } from 'next';
import { AdminOnly } from '@/components/layout/admin-only';
import { AuditAdmin } from '@/features/admin-audit/audit-admin';

export const metadata: Metadata = { title: 'Audit log' };

export default function Page() {
  return (
    <AdminOnly>
      <AuditAdmin />
    </AdminOnly>
  );
}
