'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PUBLIC_NAV } from './nav';
import { SessionActions } from './session-actions';

const PANEL_ID = 'mobile-menu';

// Below md the header collapses its links into this disclosure panel: the catalogue links, the
// session actions and the theme toggle. It closes on Escape (focus returns to the button), on a
// link click and when the route changes. Not a modal, so focus is not trapped.
export function MobileMenu({ activeHref }: { activeHref: string | null }) {
  const pathname = usePathname();
  // The path the menu was opened on: navigating anywhere else closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => setOpenOn(null);

  useEffect(() => {
    if (!open) return;
    // Move focus into the panel so keyboard and screen-reader users land on the links.
    panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenOn(null);
      buttonRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <div className="md:hidden">
      <Button
        ref={buttonRef}
        type="button"
        variant="ghost"
        size="icon"
        className="size-11"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        aria-label={open ? 'Close menu' : 'Menu'}
        onClick={() => setOpenOn(open ? null : pathname)}
      >
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
      </Button>
      {open ? (
        <div
          ref={panelRef}
          id={PANEL_ID}
          className="absolute inset-x-0 top-full max-h-[calc(100svh-4rem)] animate-fade-in overflow-y-auto border-b bg-background shadow-lift"
        >
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-4">
            <nav aria-label="Mobile">
              <ul className="grid gap-1">
                {PUBLIC_NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={item.href === activeHref ? 'page' : undefined}
                      onClick={close}
                      className={cn(
                        'flex min-h-12 items-center rounded-lg border-l-2 border-transparent px-3 text-base font-medium transition-colors hover:bg-secondary',
                        'aria-[current=page]:border-accent aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent-ink',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="border-t pt-4">
              <SessionActions stacked onNavigate={close} />
            </div>
            <div className="flex min-h-11 items-center justify-between border-t pt-3 text-sm text-muted-foreground">
              Theme
              <ThemeToggle className="size-11" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
