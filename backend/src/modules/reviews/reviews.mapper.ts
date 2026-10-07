import type { ReviewDoc } from './reviews.model.js';
import type { ReviewDto } from './reviews.schemas.js';

export interface ReviewViewContext {
  admin: boolean;
  customerNames: Map<string, string>;
  staffNames: Map<string, string>;
  serviceNames: Map<string, string>;
}

const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

// Model -> DTO. The public sees the reviewer's first name only; moderation fields are for
// ADMIN (API-061 includeHidden, API-062).
export function toReviewDto(review: ReviewDoc, ctx: ReviewViewContext): ReviewDto {
  const customerId = review.customerId.toHexString();
  const staffId = review.staffId.toHexString();
  const name = ctx.customerNames.get(customerId) ?? 'Customer';
  const dto: ReviewDto = {
    id: review._id.toHexString(),
    rating: review.rating,
    customer: ctx.admin ? { id: customerId, name } : { name: firstName(name) },
    staff: { id: staffId, displayName: ctx.staffNames.get(staffId) ?? 'Unknown stylist' },
    services: review.serviceIds.map((serviceId) => {
      const id = serviceId.toHexString();
      return { id, name: ctx.serviceNames.get(id) ?? 'Unknown service' };
    }),
    createdAt: review.createdAt.toISOString(),
  };
  if (review.comment) dto.comment = review.comment;
  if (ctx.admin) {
    dto.bookingId = review.bookingId.toHexString();
    dto.isHidden = review.isHidden;
    if (review.hiddenReason) dto.hiddenReason = review.hiddenReason;
  }
  return dto;
}

// Fields recorded in audit rows (07 §2.2).
export const reviewAuditView = (r: ReviewDoc): Record<string, unknown> => ({
  bookingId: r.bookingId.toHexString(),
  staffId: r.staffId.toHexString(),
  serviceIds: r.serviceIds.map((id) => id.toHexString()),
  rating: r.rating,
  comment: r.comment ?? null,
  isHidden: r.isHidden,
});

// ratingAvg is stored with two decimals (02 §2.5, §2.6).
export const roundRating = (avg: number) => Math.round(avg * 100) / 100;
