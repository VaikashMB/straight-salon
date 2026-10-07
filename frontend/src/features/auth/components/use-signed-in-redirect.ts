'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { postLoginPath } from '@/lib/auth/roles';

// Once signed in (already, or by submitting the form), go to `next` or the role's area (05 §5).
export function useSignedInRedirect(): void {
  const { status, user } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next');
  useEffect(() => {
    if (status === 'authenticated' && user) router.replace(postLoginPath(user.role, next));
  }, [status, user, next, router]);
}
