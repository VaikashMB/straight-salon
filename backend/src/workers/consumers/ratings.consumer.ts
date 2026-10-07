import type { ReviewsService } from '../../modules/reviews/reviews.service.js';
import type { EventHandler } from '../../shared/events/EventBus.js';
import { parseEventPayload } from '../../shared/events/registry.js';
import type { Logger } from '../../shared/logger/index.js';

// `ratings` consumer (09 §5): a review was created or hidden/unhidden, so the stylist's and the
// services' ratingAvg/ratingCount are recomputed from the visible reviews (FR-061). Recompute,
// not increment, so a repeated or late delivery leaves the same result.

export interface RatingsConsumerDeps {
  reviews: Pick<ReviewsService, 'refreshRatings'>;
  logger: Logger;
}

export function createRatingsConsumer(deps: RatingsConsumerDeps): EventHandler {
  const log = deps.logger.child({ consumer: 'ratings' });
  return async (event) => {
    if (event.type !== 'review.created' && event.type !== 'review.visibility_changed') return;
    const { reviewId } = parseEventPayload(event.type, event.payload);
    if (!(await deps.reviews.refreshRatings(reviewId))) {
      log.warn({ reviewId }, 'Review not found; ratings left as they are');
    }
  };
}
