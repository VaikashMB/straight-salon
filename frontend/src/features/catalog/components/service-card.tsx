import { Clock } from 'lucide-react';
import Link from 'next/link';
import { Rating } from '@/components/rating';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { formatMinutes } from '@/lib/time';
import type { Service } from '../api';

// A service in the public catalogue (FR-012): what it is, how long, how much, how it rates.
export function ServiceCard({
  service,
  headingLevel = 3,
}: {
  service: Service;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <Heading className="text-lg font-semibold">
          <Link href={`/services/${service.slug}`} className="hover:underline">
            {service.name}
          </Link>
        </Heading>
        <span className="font-medium whitespace-nowrap">
          {formatMoney(service.price.amountMinor, service.price.currency)}
        </span>
      </div>
      {service.description ? (
        <p className="line-clamp-2 text-sm text-muted-foreground">{service.description}</p>
      ) : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock aria-hidden className="size-4" />
            {formatMinutes(service.durationMin)}
          </span>
          <Rating value={service.ratingAvg} count={service.ratingCount} />
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href={`/book?services=${service.id}`} aria-label={`Book ${service.name}`}>
            Book
          </Link>
        </Button>
      </div>
    </article>
  );
}
