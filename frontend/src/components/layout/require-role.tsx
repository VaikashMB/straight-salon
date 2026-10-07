'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/AuthProvider';
import { canUseArea, landingFor, loginPathFor, type Area } from '@/lib/auth/roles';

// Fine-grained guard for a signed-in area (05 §5), after proxy.ts's coarse cookie check. Anonymous
// visitors go to sign-in; other roles are told this area is not theirs. The API still enforces
// every permission.
export function RequireRole({ area, children }: { area: Area; children: ReactNode }) {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace(loginPathFor(pathname));
  }, [status, pathname, router]);

  if (status !== 'authenticated' || !user) {
    return (
      <div className="grid gap-3 p-6" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (!canUseArea(user.role, area)) {
    return (
      <div className="mx-auto grid max-w-md gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">This page isn&apos;t available to you</h1>
        <p className="text-muted-foreground">You are signed in with a different kind of account.</p>
        <Button asChild>
          <Link href={landingFor(user.role)}>Go to my area</Link>
        </Button>
      </div>
    );
  }
  return children;
}
