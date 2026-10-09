'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { IconTile } from '@/components/icon-tile';
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
      <div
        className="mx-auto grid max-w-6xl gap-4 px-4 py-10 lg:pl-72"
        aria-busy="true"
        aria-label="Loading"
      >
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (!canUseArea(user.role, area)) {
    return (
      <div className="mx-auto grid max-w-md animate-fade-up justify-items-center gap-4 px-4 py-16 text-center">
        <IconTile icon={Lock} size="lg" />
        <h1 className="text-2xl font-semibold">This page isn&apos;t available to you</h1>
        <p className="text-muted-foreground">You are signed in with a different kind of account.</p>
        <Button asChild className="justify-self-center">
          <Link href={landingFor(user.role)}>Go to my area</Link>
        </Button>
      </div>
    );
  }
  return children;
}
