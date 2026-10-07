import { Star } from 'lucide-react';
import { formatDate } from '@/lib/format';
import type { Review } from '../api';

// Visible reviews (API-061), newest first, with the reviewer's first name only.
export function ReviewList({ reviews, timeZone }: { reviews: Review[]; timeZone: string }) {
  if (reviews.length === 0) {
    return <p className="text-sm text-muted-foreground">No reviews yet.</p>;
  }
  return (
    <ul className="grid gap-4">
      {reviews.map((review) => (
        <li key={review.id} className="grid gap-2 rounded-lg border bg-card p-4">
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
            <span className="text-xs text-muted-foreground">
              {review.customer.name} · {formatDate(review.createdAt, timeZone)}
            </span>
          </div>
          {review.comment ? <p className="text-sm">{review.comment}</p> : null}
          <p className="text-xs text-muted-foreground">
            {review.services.map((s) => s.name).join(', ')} with {review.staff.displayName}
          </p>
        </li>
      ))}
    </ul>
  );
}
