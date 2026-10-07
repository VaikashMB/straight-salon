import type { Metadata } from 'next';
import { AdminOnly } from '@/components/layout/admin-only';
import { ReviewsAdmin } from '@/features/admin-reviews/reviews-admin';

export const metadata: Metadata = { title: 'Reviews' };

export default function Page() {
  return (
    <AdminOnly>
      <ReviewsAdmin />
    </AdminOnly>
  );
}
