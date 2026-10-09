import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Rating } from '@/components/rating';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Stylist } from '../api';
import { SpecialityChips } from './speciality-chips';
import { StylistAvatar } from './stylist-avatar';

// A stylist in the public team list: photo with a brass ring, rating, the categories they work
// in (when the page knows the catalogue) and a direct booking link.
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
  return (
    <article
      style={style}
      className={cn(
        'group flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-soft transition duration-300 focus-within:border-accent/60 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lift',
        className,
      )}
    >
      <div className="flex items-center gap-4">
        <StylistAvatar
          name={stylist.displayName}
          photoUrl={stylist.photoUrl}
          size={80}
          className="ring-2 ring-accent ring-offset-2 ring-offset-card"
        />
        <div className="grid gap-1">
          <Heading className="text-xl font-semibold">
            <Link
              href={`/stylists/${stylist.id}`}
              className="decoration-accent underline-offset-4 hover:underline"
            >
              {stylist.displayName}
            </Link>
          </Heading>
          <Rating value={stylist.ratingAvg} count={stylist.ratingCount} />
        </div>
      </div>
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
    </article>
  );
}
