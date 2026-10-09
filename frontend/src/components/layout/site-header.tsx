'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';
import { Brand } from './brand';
import { MobileMenu } from './mobile-menu';
import { activeHref, PUBLIC_NAV } from './nav';
import { SessionActions } from './session-actions';

// Public site header: sticky with a blurred backdrop, catalogue links (the current one marked
// with a brass underline and aria-current), the visitor's session state and the theme toggle.
// Below md everything but the brand moves into the mobile menu.
export function SiteHeader() {
  const active = activeHref(PUBLIC_NAV, usePathname());
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
        <Brand className="inline-flex min-h-11 items-center text-xl" />
        <nav aria-label="Main" className="hidden h-full items-stretch md:flex">
          {PUBLIC_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.href === active ? 'page' : undefined}
              className={cn(
                'relative inline-flex items-center px-3 text-sm text-muted-foreground transition-colors hover:text-foreground',
                'after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:bg-accent/50 after:transition-transform after:duration-300 hover:after:scale-x-100',
                'aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:after:scale-x-100 aria-[current=page]:after:bg-accent',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <SessionActions />
          </div>
          <ThemeToggle className="hidden md:inline-flex" />
          <MobileMenu activeHref={active} />
        </div>
      </div>
    </header>
  );
}
