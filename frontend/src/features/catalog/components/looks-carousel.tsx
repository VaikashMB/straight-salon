'use client';

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Service } from '../api';

// The home hero's model carousel: one signature look per slide, each tied to a service by slug
// so it shows the live price and books that service. The photos are royalty-free stock
// (public/looks/CREDITS.md), not the salon's own work.
export interface Look {
  image: string;
  serviceSlug: string;
  title: string;
  tagline: string;
}

export const LOOKS: readonly Look[] = [
  {
    image: '/looks/hair-colour.webp',
    serviceSlug: 'hair-colour-global',
    title: 'Hair Colour',
    tagline: 'Rich, glossy, all-over colour',
  },
  {
    image: '/looks/beard-styling.webp',
    serviceSlug: 'beard-styling',
    title: 'Beard Styling',
    tagline: 'Sharp lines, shaped to your face',
  },
  {
    image: '/looks/keratin.webp',
    serviceSlug: 'keratin-smoothing',
    title: 'Keratin Smoothing',
    tagline: 'Frizz-free and sleek for months',
  },
  {
    image: '/looks/hair-spa.webp',
    serviceSlug: 'hair-spa',
    title: 'Hair Spa',
    tagline: 'Deep care for curls and coils',
  },
  {
    image: '/looks/haircut.webp',
    serviceSlug: 'haircut',
    title: 'Precision Cut',
    tagline: 'A cut that grows out beautifully',
  },
];

const INTERVAL_MS = 5000;
const SWIPE_PX = 40;

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
function subscribeReducedMotion(onChange: () => void) {
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const prefersReducedMotion = () => window.matchMedia(reducedMotionQuery).matches;

// WAI-ARIA carousel pattern: a labelled region, one visible slide at a time (the others are
// inert), previous/next and per-slide buttons, and a pause button because it auto-rotates
// (WCAG 2.2.2). It never rotates under prefers-reduced-motion, while focus or the pointer is
// inside it, or after the visitor paused it.
export function LooksCarousel({
  services,
  looks = LOOKS,
  className,
}: {
  services: Pick<Service, 'id' | 'slug' | 'price'>[];
  looks?: readonly Look[];
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
    () =>
      // On the server assume reduced motion, so nothing moves before hydration.
      true,
  );
  const swipeStart = useRef<number | null>(null);
  const count = looks.length;
  const rotating = !paused && !reducedMotion && !hovering && !focused && count > 1;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [rotating, count]);

  if (count === 0) return null;
  const go = (next: number) => setIndex((next + count) % count);
  const bySlug = new Map(services.map((s) => [s.slug, s]));

  const onPointerDown = (event: PointerEvent) => {
    swipeStart.current = event.clientX;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (swipeStart.current === null) return;
    const dx = event.clientX - swipeStart.current;
    swipeStart.current = null;
    if (Math.abs(dx) >= SWIPE_PX) go(dx < 0 ? index + 1 : index - 1);
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Signature looks"
      className={cn('relative', className)}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div
        className="relative aspect-[4/5] touch-pan-y overflow-hidden rounded-[1.75rem] bg-sidebar shadow-lift ring-1 ring-accent/30"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipeStart.current = null)}
      >
        {/* Announce slide changes only when the visitor drives them (not while auto-rotating). */}
        <div aria-live={rotating ? 'off' : 'polite'} aria-atomic="false" className="contents">
          {looks.map((look, i) => {
            const service = bySlug.get(look.serviceSlug);
            const active = i === index;
            return (
              <div
                key={look.image}
                role="group"
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${count}: ${look.title}`}
                aria-hidden={!active}
                inert={!active}
                className={cn(
                  'absolute inset-0 transition-opacity duration-700 ease-out',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              >
                <Image
                  src={look.image}
                  alt=""
                  fill
                  priority={i === 0}
                  // Already sized and compressed (800×1000 WebP); no optimiser needed in the image.
                  unoptimized
                  className={cn(
                    'object-cover transition-transform duration-[6000ms] ease-out',
                    active && !reducedMotion ? 'scale-105' : 'scale-100',
                  )}
                />
                <div
                  aria-hidden
                  className="absolute inset-0 bg-[linear-gradient(to_top,rgb(10_9_8/0.88),rgb(10_9_8/0.25)_45%,transparent_70%)]"
                />
                <div className="absolute inset-x-0 bottom-0 grid gap-2 p-6 pb-16 text-white sm:p-8 sm:pb-16">
                  <p className="text-xs font-semibold tracking-[0.22em] text-sidebar-accent uppercase">
                    Signature look
                  </p>
                  <p className="font-heading text-3xl leading-none font-semibold tracking-tight uppercase sm:text-4xl">
                    {look.title}
                  </p>
                  <p className="text-sm text-white/80">{look.tagline}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {service ? (
                      <span className="rounded-full bg-white/12 px-3 py-1 text-sm font-medium ring-1 ring-white/25 backdrop-blur">
                        from {formatMoney(service.price.amountMinor, service.price.currency)}
                      </span>
                    ) : null}
                    <Button asChild size="sm" variant="accent">
                      <Link href={service ? `/book?services=${service.id}` : '/services'}>
                        Book this look
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 px-4 pb-4 sm:px-6">
          <div className="flex items-center gap-1.5">
            {looks.map((look, i) => (
              <button
                key={look.image}
                type="button"
                aria-label={`Show look ${i + 1}: ${look.title}`}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => go(i)}
                className="grid size-6 place-content-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent"
              >
                <span
                  aria-hidden
                  className={cn(
                    'block h-1.5 rounded-full transition-all duration-300',
                    i === index ? 'w-5 bg-sidebar-accent' : 'w-1.5 bg-white/50',
                  )}
                />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {count > 1 && !reducedMotion ? (
              <CarouselButton
                label={paused ? 'Play slideshow' : 'Pause slideshow'}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? <Play aria-hidden /> : <Pause aria-hidden />}
              </CarouselButton>
            ) : null}
            <CarouselButton label="Previous look" onClick={() => go(index - 1)}>
              <ChevronLeft aria-hidden />
            </CarouselButton>
            <CarouselButton label="Next look" onClick={() => go(index + 1)}>
              <ChevronRight aria-hidden />
            </CarouselButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function CarouselButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-9 place-content-center rounded-full bg-white/10 text-white ring-1 ring-white/25 backdrop-blur transition-colors outline-none hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-sidebar-accent [&>svg]:size-4"
    >
      {children}
    </button>
  );
}
