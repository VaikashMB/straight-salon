import Image from 'next/image';
import Link from 'next/link';
import { ViewTransition, type CSSProperties } from 'react';
import { Rating } from '@/components/rating';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Stylist } from '../api';
import { SpecialityChips } from './speciality-chips';
import { StylistAvatar } from './stylist-avatar';

// View-transition name shared by a stylist's portrait on cards and on their profile, so it
// morphs between the two pages.
export const stylistPortraitName = (id: string) => `stylist-${id}`;

// A stylist in the public team list: a portrait photo (or their initials with a brass ring),
// rating, the categories they work in (when the page knows the catalogue) and a direct booking
// link.
export function StylistCard({
  stylist,
  specialities = [],
  headingLevel = 3,
  className,
  style,
}: {
  stylist: Stylist;
  specialities?: string[];
  headingLevel?: 2 | 3;
  className?: string;
  // Lets a list stagger the entrance animation.
  style?: CSSProperties;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const name = (
    <Heading className="text-xl font-semibold">
      <Link
        href={`/stylists/${stylist.id}`}
        className="decoration-accent underline-offset-4 hover:underline"
      >
        {stylist.displayName}
      </Link>
    </Heading>
  );
  return (
    <article
      style={style}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-soft transition duration-300 focus-within:border-accent/60 hover:-translate-y-1 hover:border-accent/60 hover:shadow-lift',
        className,
      )}
    >
      {stylist.photoUrl ? (
        <ViewTransition name={stylistPortraitName(stylist.id)}>
          <div className="relative aspect-[4/3] overflow-hidden border-b bg-muted sm:aspect-[4/5]">
            <Image
              src={stylist.photoUrl}
              alt=""
              fill
              unoptimized
              sizes="(min-width: 1024px) 16rem, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition duration-700 ease-out group-hover:scale-105"
            />
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent"
            />
          </div>
        </ViewTransition>
      ) : null}
      <div className="flex flex-1 flex-col gap-4 p-6">
        {stylist.photoUrl ? (
          <div className="grid gap-1">
            {name}
            <Rating value={stylist.ratingAvg} count={stylist.ratingCount} />
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <StylistAvatar
              name={stylist.displayName}
              size={80}
              className="ring-2 ring-accent ring-offset-2 ring-offset-card"
            />
            <div className="grid gap-1">
              {name}
              <Rating value={stylist.ratingAvg} count={stylist.ratingCount} />
            </div>
          </div>
        )}
        <SpecialityChips names={specialities} />
        {stylist.bio ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">{stylist.bio}</p>
        ) : null}
        <Button
          asChild
          size="sm"
          variant="outline"
          className="mt-auto self-start group-hover:border-accent/60"
        >
          <Link href={`/book?staff=${stylist.id}`} aria-label={`Book with ${stylist.displayName}`}>
            Book with {stylist.displayName}
          </Link>
        </Button>
      </div>
    </article>
  );
}
