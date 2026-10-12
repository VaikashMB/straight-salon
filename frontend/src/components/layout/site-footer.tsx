import { ArrowRight, MapPin } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { LOOKS } from '@/features/gallery/looks';
import { publicEnv } from '@/lib/env';
import { Brand } from './brand';

const LINKS = [
  {
    heading: 'Explore',
    items: [
      { href: '/services', label: 'Services & prices' },
      { href: '/stylists', label: 'Our stylists' },
      { href: '/gallery', label: 'Gallery' },
      { href: '/location', label: 'Location & hours' },
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

// Six looks for the "From the studio" strip, a mix of categories.
const STRIP = [0, 3, 2, 1, 8, 5].map((i) => LOOKS[i]!);

const linkClass =
  'inline-flex min-h-9 items-center text-sm text-sidebar-foreground/85 underline-offset-4 transition-colors hover:text-sidebar-foreground hover:underline decoration-sidebar-accent';

// Public site footer on the dark sidebar surface (dark in both themes): a strip of looks from the
// gallery, a serif sign-off with the booking button, a "visit the studio" card and the link
// groups. Static: the layout does not fetch the catalogue, so hours and address live on the home
// and location pages.
export function SiteFooter() {
  return (
    <footer className="border-t border-sidebar-border bg-sidebar text-sidebar-foreground">
      <section aria-labelledby="studio-strip" className="border-b border-sidebar-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-3 px-4 pt-12">
          <div className="grid gap-1">
            <p className="text-xs font-semibold tracking-[0.18em] text-sidebar-accent uppercase">
              From the studio
            </p>
            <h2 id="studio-strip" className="text-2xl sm:text-3xl">
              Fresh off the chair
            </h2>
          </div>
          <Link href="/gallery" className={`${linkClass} gap-1`}>
            See the gallery <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
        <ul className="mx-auto mt-6 grid max-w-6xl grid-cols-3 gap-2 px-4 pb-12 sm:grid-cols-6 sm:gap-3">
          {STRIP.map((look) => (
            <li key={look.src}>
              <Link
                href="/gallery"
                className="group relative block aspect-square overflow-hidden rounded-xl ring-1 ring-sidebar-border outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent"
              >
                <Image
                  src={look.src}
                  alt={look.title}
                  fill
                  sizes="(min-width: 640px) 16vw, 33vw"
                  className="object-cover transition duration-700 ease-out group-hover:scale-110 group-hover:brightness-110"
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div className="grid content-start gap-4 sm:col-span-2 lg:col-span-1">
          <Brand className="inline-flex min-h-11 items-center justify-self-start text-2xl" />
          <p className="font-serif text-3xl leading-tight text-sidebar-foreground italic">
            See you in the chair.
          </p>
          <p className="max-w-sm text-sm text-sidebar-muted">
            Sharp cuts, clean shaves and calm hands. Book your chair online in under a minute.
          </p>
          <div>
            <Button asChild variant="accent" className="shine">
              <Link href="/book">
                Book an appointment <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
        {LINKS.map((group) => (
          <nav key={group.heading} aria-label={group.heading} className="grid content-start gap-3">
            <h2 className="font-sans text-xs font-semibold tracking-[0.18em] text-sidebar-accent uppercase">
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
        <Link
          href="/location"
          className="group relative isolate grid min-h-44 content-end overflow-hidden rounded-2xl p-5 ring-1 ring-sidebar-border outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent sm:col-span-2 lg:col-span-1"
        >
          <Image
            src="/salon/d.webp"
            alt=""
            fill
            sizes="(min-width: 1024px) 18rem, 100vw"
            className="-z-10 object-cover brightness-[0.55] transition duration-700 group-hover:scale-105 group-hover:brightness-[0.65]"
          />
          <span className="text-xs font-semibold tracking-[0.18em] text-sidebar-accent uppercase">
            Visit the studio
          </span>
          <span className="inline-flex items-center gap-2 font-serif text-xl">
            <MapPin aria-hidden className="size-5 text-sidebar-accent" /> Map &amp; opening hours
          </span>
        </Link>
      </div>
      <div className="border-t border-sidebar-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-sm text-sidebar-muted">
          <p>
            © {new Date().getFullYear()} {publicEnv.appName}
          </p>
          <p className="tracking-[0.18em] uppercase">Hair · Beard · Skin · Nails</p>
        </div>
      </div>
    </footer>
  );
}
