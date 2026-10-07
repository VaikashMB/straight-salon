import type { Metadata } from 'next';
import { AdminOnly } from '@/components/layout/admin-only';
import { NotificationsAdmin } from '@/features/admin-notifications/notifications-admin';

export const metadata: Metadata = { title: 'Notifications' };

export default function Page() {
  return (
    <AdminOnly>
      <NotificationsAdmin />
    </AdminOnly>
  );
}
