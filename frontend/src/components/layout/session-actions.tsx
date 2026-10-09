'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/user-avatar';
import { useAuth } from '@/lib/auth/AuthProvider';
import { landingFor, ROLE_LABEL } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import { AREA_LABEL, ProfileMenu } from './profile-menu';
import { SignOutButton } from './sign-out-button';

// The visitor's session state on the public site: sign in / create account, or who is signed in
// (avatar, name, role), a link to their area and sign out. Shown in the header bar (sm and up) and in the mobile menu, which passes
// `onNavigate` to close itself and stacks the buttons full width.
export function SessionActions({
  stacked = false,
  onNavigate,
}: {
  stacked?: boolean;
  onNavigate?: () => void;
}) {
  const { status, user } = useAuth();
  const size = stacked ? 'lg' : 'sm';
  const wrap = cn('flex gap-2', stacked ? 'flex-col [&>*]:h-11 [&>*]:w-full' : 'items-center');

  if (status === 'loading') {
    return <Skeleton className={stacked ? 'h-11 w-full' : 'h-8 w-28'} aria-label="Loading" />;
  }
  if (status === 'authenticated' && user) {
    // In the header bar: one profile menu. In the mobile menu: who is signed in, then the area
    // link and sign out as full-width buttons.
    if (!stacked) return <ProfileMenu user={user} />;
    return (
      <div className={wrap}>
        <div className="flex h-auto! items-center gap-3 pb-1">
          <UserAvatar name={user.name} className="size-10" />
          <div className="grid min-w-0">
            <p className="text-xs text-muted-foreground">Signed in as</p>
            <p className="truncate font-medium">
              {user.name}
              <span className="font-normal text-muted-foreground"> · {ROLE_LABEL[user.role]}</span>
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size={size}>
          <Link href={landingFor(user.role)} onClick={onNavigate}>
            {AREA_LABEL[user.role]}
          </Link>
        </Button>
        <SignOutButton />
      </div>
    );
  }
  if (status !== 'anonymous') return null;
  return (
    <div className={wrap}>
      <Button asChild variant={stacked ? 'outline' : 'ghost'} size={size}>
        <Link href="/login" onClick={onNavigate}>
          Sign in
        </Link>
      </Button>
      <Button asChild size={size}>
        <Link href="/register" onClick={onNavigate}>
          Create account
        </Link>
      </Button>
    </div>
  );
}
