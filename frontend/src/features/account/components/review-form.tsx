'use client';

import { Star } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/form/form-error';
import { TextareaField } from '@/components/form/textarea-field';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { useLeaveReview } from '../api';

const MAX_COMMENT = 500;

// FR-060 / API-060: 1–5 stars and an optional comment, once per completed booking.
export function ReviewForm({ bookingId }: { bookingId: string }) {
  const review = useLeaveReview(bookingId);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (rating === 0) return setError('Choose a rating from 1 to 5 stars.');
    review.mutate(
      { rating, ...(comment.trim() ? { comment: comment.trim() } : {}) },
      {
        onSuccess: () => toast.success('Thanks for your review!'),
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <form
      id="review"
      onSubmit={submit}
      className="grid gap-4 rounded-xl border bg-card p-5 shadow-soft"
    >
      <h2 className="text-lg font-semibold">How was your visit?</h2>
      <FormError>{error}</FormError>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Rating</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="rating"
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="peer sr-only"
              />
              <span className="sr-only">
                {value} {value === 1 ? 'star' : 'stars'}
              </span>
              <Star
                aria-hidden
                className={cn(
                  'size-8 rounded-sm peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50',
                  value <= rating ? 'fill-accent text-accent' : 'text-muted-foreground',
                )}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <TextareaField
        label="Comment (optional)"
        maxLength={MAX_COMMENT}
        hint={`${comment.length}/${MAX_COMMENT}`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <Button type="submit" disabled={review.isPending} className="justify-self-start">
        {review.isPending ? 'Sending…' : 'Submit review'}
      </Button>
    </form>
  );
}
