import type { Metadata } from 'next';
import { AdminOnly } from '@/components/layout/admin-only';
import { SettingsAdmin } from '@/features/admin-settings/settings-admin';

export const metadata: Metadata = { title: 'Settings' };

export default function Page() {
  return (
    <AdminOnly>
      <SettingsAdmin />
    </AdminOnly>
  );
}
