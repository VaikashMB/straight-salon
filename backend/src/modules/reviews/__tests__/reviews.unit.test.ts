import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { reviewAuditView, roundRating, toReviewDto } from '../reviews.mapper.js';
import type { ReviewDoc } from '../reviews.model.js';
import {
  CreateReviewBodySchema,
  ListReviewsQuerySchema,
  UpdateReviewBodySchema,
} from '../reviews.schemas.js';

const at = new Date('2026-10-12T12:00:00.000Z');
const review = (overrides: Partial<ReviewDoc> = {}): ReviewDoc => ({
  _id: new Types.ObjectId(),
  bookingId: new Types.ObjectId(),
  customerId: new Types.ObjectId(),
  staffId: new Types.ObjectId(),
  serviceIds: [new Types.ObjectId()],
  rating: 4,
  isHidden: false,
  createdAt: at,
  updatedAt: at,
  ...overrides,
});

describe('review DTO (API-061)', () => {
  it('public: first name only, no moderation fields; fallbacks for missing names', () => {
    const r = review({ comment: 'Lovely' });
    const dto = toReviewDto(r, {
      admin: false,
      customerNames: new Map([[r.customerId.toHexString(), 'Ananya Rao']]),
      staffNames: new Map([[r.staffId.toHexString(), 'Ravi']]),
      serviceNames: new Map(),
    });
    expect(dto).toEqual({
      id: r._id.toHexString(),
      rating: 4,
      comment: 'Lovely',
      customer: { name: 'Ananya' },
      staff: { id: r.staffId.toHexString(), displayName: 'Ravi' },
      services: [{ id: r.serviceIds[0]!.toHexString(), name: 'Unknown service' }],
      createdAt: at.toISOString(),
    });
  });

  it('admin: full name, booking and moderation fields', () => {
    const r = review({ isHidden: true, hiddenReason: 'Spam' });
    const dto = toReviewDto(r, {
      admin: true,
      customerNames: new Map(),
      staffNames: new Map(),
      serviceNames: new Map(),
    });
    expect(dto).toMatchObject({
      customer: { id: r.customerId.toHexString(), name: 'Customer' },
      staff: { displayName: 'Unknown stylist' },
      bookingId: r.bookingId.toHexString(),
      isHidden: true,
      hiddenReason: 'Spam',
    });
    expect(dto).not.toHaveProperty('comment');
  });

  it('audit view and rating rounding (two decimals)', () => {
    const r = review();
    expect(reviewAuditView(r)).toMatchObject({ rating: 4, comment: null, isHidden: false });
    expect(roundRating(10 / 3)).toBe(3.33);
    expect(roundRating(4.666)).toBe(4.67);
    expect(roundRating(0)).toBe(0);
  });
});

describe('review request schemas', () => {
  it('BR-012 rating is a whole number 1-5; comment ≤ 500, trimmed; nothing else', () => {
    expect(CreateReviewBodySchema.safeParse({ rating: 1 }).success).toBe(true);
    expect(CreateReviewBodySchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(CreateReviewBodySchema.parse({ rating: 5, comment: ' ok ' }).comment).toBe('ok');
    expect(CreateReviewBodySchema.safeParse({ rating: 5, comment: '   ' }).success).toBe(false);
    expect(CreateReviewBodySchema.safeParse({ rating: 5, isHidden: false }).success).toBe(false);
  });

  it('hiding needs a reason; showing takes none', () => {
    expect(UpdateReviewBodySchema.safeParse({ isHidden: true }).success).toBe(false);
    expect(UpdateReviewBodySchema.safeParse({ isHidden: true, hiddenReason: 'x' }).success).toBe(
      true,
    );
    expect(UpdateReviewBodySchema.safeParse({ isHidden: false }).success).toBe(true);
    expect(UpdateReviewBodySchema.safeParse({ isHidden: false, hiddenReason: 'x' }).success).toBe(
      false,
    );
  });

  it('list query: ids validated, includeHidden is a true/false flag', () => {
    expect(ListReviewsQuerySchema.parse({ includeHidden: 'true' }).includeHidden).toBe(true);
    expect(ListReviewsQuerySchema.safeParse({ includeHidden: 'yes please' }).success).toBe(false);
    expect(ListReviewsQuerySchema.safeParse({ staffId: '123' }).success).toBe(false);
    expect(ListReviewsQuerySchema.safeParse({ sort: '-rating' }).success).toBe(false);
  });
});
