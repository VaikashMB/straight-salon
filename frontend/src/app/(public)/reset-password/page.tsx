import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/auth/components/reset-password-form';

// The token is in the URL: keep it out of referrers sent to other sites.
export const metadata: Metadata = { title: 'Reset password', referrer: 'no-referrer' };

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
