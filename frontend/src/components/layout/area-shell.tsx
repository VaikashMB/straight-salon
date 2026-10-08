'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { landingFor, type Area, type Role } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import { Brand } from './brand';
import { activeHref, navFor } from './nav';
import { RequireRole } from './require-role';
import { SignOutButton } from './sign-out-button';

// Layout of the signed-in areas (customer account, staff, admin): role guard, area navigation
// filtered by role, the user and sign-out.
export function AreaShell({ area, children }: { area: Area; children: ReactNode }) {
  return (
    <RequireRole area={area}>
      <AreaFrame area={area}>{children}</AreaFrame>
    </RequireRole>
  );
}

const adminRoleLabel = (role: Role) => (role === 'ADMIN' ? 'Admin' : 'Reception');

function AreaFrame({ area, children }: { area: Area; children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  if (!user) return null;
  const items = navFor(area, user.role);
  const active = activeHref(items, pathname);
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Brand href={landingFor(user.role)} />
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">
              {user.name}
              {area === 'admin' ? ` · ${adminRoleLabel(user.role)}` : ''}
            </span>
            <SignOutButton variant="outline" />
          </div>
        </div>
        <nav aria-label="Section" className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2 text-sm">
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={item.href === active ? 'page' : undefined}
                  className={cn(
                    'block rounded-md px-3 py-1.5 whitespace-nowrap hover:bg-secondary',
                    item.href === active && 'bg-secondary font-medium',
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
