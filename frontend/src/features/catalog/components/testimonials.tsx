import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Review } from '../api';

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn('inline-flex gap-0.5', className)} aria-label={`${rating} out of 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          aria-hidden
          className={cn('size-4', i < rating ? 'fill-accent text-accent' : 'text-muted')}
        />
      ))}
    </span>
  );
}

const byline = (review: Review) =>
  `${review.services.map((s) => s.name).join(', ')} with ${review.staff.displayName}`;

// Home page testimonials from real, visible reviews (API-061): the first as a large serif pull
// quote, the rest as quieter cards beside it. Reviewers appear by first name only (00 US-04).
export function Testimonials({ reviews }: { reviews: Review[] }) {
  const [lead, ...rest] = reviews;
  if (!lead) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <figure className="relative isolate grid reveal content-between gap-8 overflow-hidden rounded-[1.75rem] bg-sidebar p-8 text-sidebar-foreground shadow-lift sm:p-10">
        <span
          aria-hidden
          className="pointer-events-none absolute -top-10 -left-2 -z-10 font-serif text-[14rem] leading-none text-sidebar-accent/15"
        >
          &ldquo;
        </span>
        <Stars rating={lead.rating} />
        <blockquote className="font-serif text-2xl leading-snug font-light italic sm:text-3xl">
          {lead.comment}
        </blockquote>
        <figcaption className="grid gap-0.5 text-sm">
          <span className="font-semibold">{lead.customer.name}</span>
          <span className="text-sidebar-muted">{byline(lead)}</span>
        </figcaption>
      </figure>
      {rest.length > 0 ? (
        <div className="grid gap-6">
          {rest.map((review) => (
            <figure
              key={review.id}
              className="grid reveal content-between gap-4 rounded-2xl border bg-card p-6 shadow-soft"
            >
              <Stars rating={review.rating} />
              <blockquote className="font-serif text-xl leading-snug">{review.comment}</blockquote>
              <figcaption className="text-sm">
                <span className="font-semibold">{review.customer.name}</span>
                <span className="text-muted-foreground"> · {byline(review)}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </div>
  );
}
