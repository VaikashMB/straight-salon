import type { Metadata } from 'next';
import { UsersAdmin } from '@/features/admin-users/users-admin';

export const metadata: Metadata = { title: 'Customers' };

export default function Page() {
  return <UsersAdmin />;
}
