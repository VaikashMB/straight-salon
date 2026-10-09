import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { publicEnv } from '@/lib/env';
import { Brand } from './brand';

const LINKS = [
  {
    heading: 'Explore',
    items: [
      { href: '/services', label: 'Services & prices' },
      { href: '/stylists', label: 'Our stylists' },
      { href: '/book', label: 'Book an appointment' },
    ],
  },
  {
    heading: 'Your visit',
    items: [
      { href: '/account', label: 'Your account' },
      { href: '/login', label: 'Sign in' },
      { href: '/register', label: 'Create account' },
    ],
  },
] as const;

const linkClass =
  'inline-flex min-h-9 items-center text-sm text-sidebar-foreground/85 underline-offset-4 transition-colors hover:text-sidebar-foreground hover:underline decoration-sidebar-accent';

// Public site footer on the dark sidebar surface (dark in both themes). Static: the layout does
// not fetch the catalogue, so hours and address stay on the home page.
export function SiteFooter() {
  return (
    <footer className="border-t border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
        <div className="grid content-start gap-4 sm:col-span-2 lg:col-span-1">
          <Brand className="inline-flex min-h-11 items-center justify-self-start text-2xl" />
          <p className="max-w-sm text-sm text-sidebar-muted">
            Sharp cuts, clean shaves and calm hands. Book your chair online in under a minute.
          </p>
          <div>
            <Button asChild variant="accent">
              <Link href="/book">
                Book an appointment <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        {LINKS.map((group) => (
          <nav key={group.heading} aria-label={group.heading} className="grid content-start gap-3">
            <h2 className="text-xs font-semibold tracking-[0.18em] text-sidebar-accent uppercase">
              {group.heading}
            </h2>
            <ul className="grid gap-1">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className={linkClass}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-sidebar-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-sm text-sidebar-muted">
          <p>
            © {new Date().getFullYear()} {publicEnv.appName}
          </p>
          <p>Hair · Beard · Skin · Nails</p>
        </div>
      </div>
    </footer>
  );
}
