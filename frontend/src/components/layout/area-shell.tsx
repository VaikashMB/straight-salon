'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAuth } from '@/lib/auth/AuthProvider';
import { landingFor, type Area, type Role } from '@/lib/auth/roles';
import { cn } from '@/lib/utils';
import { Brand } from './brand';
import { activeHref, navFor } from './nav';
import { RequireRole } from './require-role';
import { SignOutButton } from './sign-out-button';

// Layout of the signed-in areas (customer account, staff, admin): role guard, area navigation
// filtered by role, the user and sign-out. From `lg` up it is a fixed dark sidebar (brand, nav,
// profile block); below that the same elements reflow into a compact top bar with the nav as a
// scrollable row of pills. One nav landmark either way, restyled with CSS only.
export function AreaShell({ area, children }: { area: Area; children: ReactNode }) {
  return (
    <RequireRole area={area}>
      <AreaFrame area={area}>{children}</AreaFrame>
    </RequireRole>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  CUSTOMER: 'Customer',
  STAFF: 'Stylist',
  RECEPTIONIST: 'Reception',
  ADMIN: 'Admin',
};

const AREA_TITLE: Record<Area, string> = {
  account: 'My account',
  staff: 'Staff',
  admin: 'Salon admin',
};

// Up to two initials for the avatar: first and last word of the name.
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}

// Controls on the always-dark sidebar: light text, a subtle hover and a brass focus ring.
const SIDEBAR_CONTROL =
  'text-sidebar-foreground hover:bg-sidebar-border hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-accent';

function AreaFrame({ area, children }: { area: Area; children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  if (!user) return null;
  const items = navFor(area, user.role);
  const active = activeHref(items, pathname);
  return (
    <div className="min-h-svh bg-background lg:pl-64">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <aside className="flex flex-wrap items-center gap-x-2 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:w-64 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0 lg:border-r lg:border-b-0 lg:px-0">
        <div className="flex h-14 min-w-0 flex-1 flex-col justify-center lg:h-auto lg:flex-none lg:px-6 lg:pt-7 lg:pb-5 [&_a]:rounded-sm [&_a]:outline-none [&_a]:focus-visible:ring-2 [&_a]:focus-visible:ring-sidebar-accent">
          <Brand href={landingFor(user.role)} />
          <p className="hidden text-[0.7rem] font-semibold tracking-[0.18em] text-sidebar-muted uppercase lg:block">
            {AREA_TITLE[area]}
          </p>
        </div>

        <div className="order-2 flex items-center gap-1 lg:order-3 lg:grid lg:gap-3 lg:border-t lg:border-sidebar-border lg:p-4">
          <div className="hidden items-center gap-3 lg:flex">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-content-center rounded-full bg-sidebar-accent/15 text-sm font-semibold text-sidebar-accent ring-1 ring-sidebar-accent/40"
            >
              {initials(user.name)}
            </span>
            <div className="grid min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="truncate text-xs text-sidebar-muted">{ROLE_LABEL[user.role]}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <SignOutButton
              className={cn(SIDEBAR_CONTROL, 'lg:flex-1 lg:justify-start')}
              variant="ghost"
            />
            <ThemeToggle className={SIDEBAR_CONTROL} />
          </div>
        </div>

        <nav
          aria-label="Section"
          className="order-3 -mx-4 w-[calc(100%+2rem)] min-w-0 lg:order-2 lg:mx-0 lg:w-auto lg:flex-1 lg:overflow-y-auto"
        >
          <ul className="flex gap-1.5 overflow-x-auto px-4 pt-1 pb-3 text-sm lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-3 lg:py-2">
            {items.map((item) => {
              const current = item.href === active;
              const Icon = item.icon;
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={cn(
                      'relative flex items-center gap-2 rounded-full px-3 py-1.5 whitespace-nowrap text-sidebar-muted ring-1 ring-sidebar-border transition-colors outline-none ring-inset hover:bg-sidebar-border/70 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-accent lg:rounded-lg lg:px-3 lg:py-2 lg:ring-0 lg:focus-visible:ring-2',
                      current &&
                        'bg-sidebar-border font-medium text-sidebar-foreground ring-sidebar-accent/60',
                    )}
                  >
                    {current ? (
                      <span
                        aria-hidden
                        className="absolute inset-y-1.5 left-0 hidden w-[3px] rounded-full bg-sidebar-accent lg:block"
                      />
                    ) : null}
                    <Icon
                      aria-hidden
                      className={cn('size-4 shrink-0', current && 'text-sidebar-accent')}
                    />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
      <main
        id="main"
        tabIndex={-1}
        className="min-w-0 bg-[radial-gradient(50rem_22rem_at_100%_0%,color-mix(in_oklab,var(--accent)_9%,transparent),transparent_70%)] bg-no-repeat outline-none"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}
