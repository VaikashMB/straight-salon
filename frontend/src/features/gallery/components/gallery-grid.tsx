'use client';

import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { LOOK_CATEGORIES, type Look } from '../looks';

const categoryLabel = (look: Look) =>
  LOOK_CATEGORIES.find((c) => c.value === look.category)?.label ?? '';

// The lookbook as a masonry grid (CSS columns, so each photo keeps its own shape). Each photo is
// a button that opens it large in a lightbox dialog, with previous/next (buttons and arrow keys)
// and a link to book the service behind the look.
export function GalleryGrid({ looks, className }: { looks: Look[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const count = looks.length;
  const look = open === null ? null : looks[open];
  const step = (by: number) => setOpen((i) => (i === null ? i : (i + by + count) % count));
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight') step(1);
    if (event.key === 'ArrowLeft') step(-1);
  };

  if (count === 0) {
    return <p className="text-muted-foreground">No looks in this category yet.</p>;
  }

  return (
    <>
      <ul className={cn('columns-2 gap-4 md:columns-3 lg:gap-5', className)}>
        {looks.map((l, i) => (
          <li key={l.src} className="mb-4 reveal break-inside-avoid lg:mb-5">
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`View ${l.title} larger`}
              className="group relative block w-full overflow-hidden rounded-2xl bg-muted shadow-soft ring-1 ring-border transition duration-300 outline-none hover:shadow-lift focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Image
                src={l.src}
                alt={l.alt}
                width={l.width}
                height={l.height}
                sizes="(min-width: 768px) 33vw, 50vw"
                className="h-auto w-full transition-transform duration-700 ease-out group-hover:scale-[1.04]"
              />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-2 flex-col items-start gap-0.5 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-4 pt-12 text-left text-white opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                <span className="text-[0.65rem] font-semibold tracking-[0.18em] text-[#d4b483] uppercase">
                  {categoryLabel(l)}
                </span>
                <span className="font-serif text-lg leading-tight">{l.title}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={look !== null} onOpenChange={(next) => (next ? null : setOpen(null))}>
        {look ? (
          <DialogContent
            onKeyDown={onKeyDown}
            className="max-w-3xl gap-0 overflow-hidden border-0 bg-sidebar p-0 text-sidebar-foreground sm:rounded-2xl [&>button:last-child]:text-sidebar-foreground"
          >
            <div className="relative grid max-h-[70svh] place-items-center bg-black">
              <Image
                key={look.src}
                src={look.src}
                alt={look.alt}
                width={look.width}
                height={look.height}
                sizes="(min-width: 768px) 48rem, 100vw"
                className="max-h-[70svh] w-auto animate-fade-in object-contain"
              />
              {count > 1 ? (
                <>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label="Previous look"
                    onClick={() => step(-1)}
                    className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full border-white/30 bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white"
                  >
                    <ChevronLeft aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    aria-label="Next look"
                    onClick={() => step(1)}
                    className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full border-white/30 bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white"
                  >
                    <ChevronRight aria-hidden />
                  </Button>
                </>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="grid gap-1">
                <p className="text-xs font-semibold tracking-[0.18em] text-sidebar-accent uppercase">
                  {categoryLabel(look)} · {open! + 1} of {count}
                </p>
                <DialogTitle className="font-serif text-2xl font-medium">{look.title}</DialogTitle>
                <DialogDescription className="text-sidebar-muted">{look.alt}</DialogDescription>
              </div>
              {look.service ? (
                <Button asChild variant="accent" className="shine">
                  <Link href={`/services/${look.service}`}>
                    Book this look <ArrowRight aria-hidden />
                  </Link>
                </Button>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
