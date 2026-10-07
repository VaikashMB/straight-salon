import type { Metadata } from 'next';
import { AdminOnly } from '@/components/layout/admin-only';
import { CategoriesAdmin } from '@/features/admin-catalog/categories-admin';

export const metadata: Metadata = { title: 'Categories' };

export default function Page() {
  return (
    <AdminOnly>
      <CategoriesAdmin />
    </AdminOnly>
  );
}
