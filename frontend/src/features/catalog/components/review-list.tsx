import { Quote, Star } from 'lucide-react';
import { formatDate } from '@/lib/format';
import type { Review } from '../api';

// Visible reviews (API-061), newest first, with the reviewer's first name only.
export function ReviewList({ reviews, timeZone }: { reviews: Review[]; timeZone: string }) {
  if (reviews.length === 0) {
    return <p className="text-sm text-muted-foreground">No reviews yet.</p>;
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {reviews.map((review) => (
        <li
          key={review.id}
          className="relative grid content-start gap-3 rounded-2xl border bg-card p-5 shadow-soft"
        >
          <Quote aria-hidden className="absolute top-4 right-4 size-6 text-accent/40" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${review.rating} out of 5`}
            >
              {Array.from({ length: 5 }, (_, i) => (
                <Star
                  key={i}
                  aria-hidden
                  className={
                    i < review.rating ? 'size-4 fill-accent text-accent' : 'size-4 text-muted'
                  }
                />
              ))}
            </span>
            <span className="pr-8 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{review.customer.name}</span> ·{' '}
              {formatDate(review.createdAt, timeZone)}
            </span>
          </div>
          {review.comment ? <p className="text-base leading-relaxed">{review.comment}</p> : null}
          <p className="text-xs text-muted-foreground">
            {review.services.map((s) => s.name).join(', ')} with {review.staff.displayName}
          </p>
        </li>
      ))}
    </ul>
  );
}
