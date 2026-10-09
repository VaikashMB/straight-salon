import { Clock } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Rating } from '@/components/rating';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { formatMinutes } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { Category, Service } from '../api';
import { PricePill } from './price-pill';
import { ServiceImage } from './service-image';

// A service in the public catalogue (FR-012): what it is, how long, how much, how it rates.
// The header shows its image, or its category's tinted placeholder (category-style.ts).
export function ServiceCard({
  service,
  category,
  headingLevel = 3,
  className,
  style,
}: {
  service: Service;
  category?: Category;
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
        'group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-soft transition duration-300 focus-within:border-accent/60 hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-lift',
        className,
      )}
    >
      <ServiceImage
        imageUrl={service.imageUrl}
        category={category}
        sizes="(min-width: 1024px) 22rem, (min-width: 640px) 50vw, 100vw"
        className="aspect-[5/2] border-b sm:aspect-[16/9]"
      />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            {category ? (
              <p className="text-xs font-semibold tracking-[0.14em] text-accent-ink uppercase">
                {category.name}
              </p>
            ) : null}
            <Heading className="text-lg leading-snug font-semibold">
              <Link
                href={`/services/${service.slug}`}
                className="decoration-accent underline-offset-4 hover:underline"
              >
                {service.name}
              </Link>
            </Heading>
          </div>
          <PricePill>{formatMoney(service.price.amountMinor, service.price.currency)}</PricePill>
        </div>
        {service.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{service.description}</p>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock aria-hidden className="size-4" />
              {formatMinutes(service.durationMin)}
            </span>
            <Rating value={service.ratingAvg} count={service.ratingCount} />
          </div>
          <Button asChild size="sm" variant="outline" className="group-hover:border-accent/60">
            <Link href={`/book?services=${service.id}`} aria-label={`Book ${service.name}`}>
              Book
            </Link>
          </Button>
        </div>
      </div>
    </article>
  );
}
