import Link from 'next/link';
import { Rating } from '@/components/rating';
import { Button } from '@/components/ui/button';
import type { Stylist } from '../api';
import { StylistAvatar } from './stylist-avatar';

export function StylistCard({
  stylist,
  headingLevel = 3,
}: {
  stylist: Stylist;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <StylistAvatar name={stylist.displayName} photoUrl={stylist.photoUrl} />
        <div className="grid gap-1">
          <Heading className="text-lg font-semibold">
            <Link href={`/stylists/${stylist.id}`} className="hover:underline">
              {stylist.displayName}
            </Link>
          </Heading>
          <Rating value={stylist.ratingAvg} count={stylist.ratingCount} />
        </div>
      </div>
      {stylist.bio ? (
        <p className="line-clamp-3 text-sm text-muted-foreground">{stylist.bio}</p>
      ) : null}
      <Button asChild size="sm" variant="outline" className="mt-auto self-start">
        <Link href={`/book?staff=${stylist.id}`} aria-label={`Book with ${stylist.displayName}`}>
          Book with {stylist.displayName}
        </Link>
      </Button>
    </article>
  );
}
