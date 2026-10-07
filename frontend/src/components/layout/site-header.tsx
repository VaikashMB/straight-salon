'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/AuthProvider';
import { landingFor, type Role } from '@/lib/auth/roles';
import { Brand } from './brand';
import { PUBLIC_NAV } from './nav';
import { SignOutButton } from './sign-out-button';

const AREA_LABEL: Record<Role, string> = {
  CUSTOMER: 'My bookings',
  STAFF: 'My day',
  RECEPTIONIST: 'Dashboard',
  ADMIN: 'Dashboard',
};

// Public site header: catalogue links and the visitor's session state.
export function SiteHeader() {
  const { status, user } = useAuth();
  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Brand />
        <nav aria-label="Main" className="hidden gap-6 text-sm sm:flex">
          {PUBLIC_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          {status === 'loading' ? <Skeleton className="h-8 w-28" aria-label="Loading" /> : null}
          {status === 'anonymous' ? (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/register">Create account</Link>
              </Button>
            </>
          ) : null}
          {status === 'authenticated' && user ? (
            <>
              <Button asChild variant="outline" size="sm">
                <Link href={landingFor(user.role)}>{AREA_LABEL[user.role]}</Link>
              </Button>
              <SignOutButton />
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
