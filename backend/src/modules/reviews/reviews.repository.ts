import mongoose, { Types, type ClientSession, type QueryFilter } from 'mongoose';
import { ReviewModel, type ReviewDoc } from './reviews.model.js';

// All Mongoose access for reviews. Operator objects written here are wrapped in trusted()
// because sanitizeFilter is on (06 §4).

export type NewReview = Omit<ReviewDoc, '_id' | 'createdAt' | 'updatedAt' | 'isHidden'>;

export interface ReviewSearch {
  staffId?: string;
  serviceId?: string;
  includeHidden: boolean;
  skip: number;
  limit: number;
}

export interface RatingAggregate {
  avg: number; // 0 when there are no visible reviews
  count: number;
}

export interface ReviewsRepository {
  create(review: NewReview, session: ClientSession): Promise<ReviewDoc>;
  findById(id: string | Types.ObjectId): Promise<ReviewDoc | null>;
  findByBookingId(bookingId: string | Types.ObjectId): Promise<ReviewDoc | null>;
  // Which of these bookings already have a review (canReview, BR-012).
  reviewedBookingIds(bookingIds: string[]): Promise<Set<string>>;
  setVisibility(
    id: Types.ObjectId,
    visibility:
      { isHidden: true; hiddenBy: Types.ObjectId; hiddenReason: string } | { isHidden: false },
    session: ClientSession,
  ): Promise<ReviewDoc | null>;
  search(search: ReviewSearch): Promise<{ data: ReviewDoc[]; total: number }>;
  // Visible reviews only (FR-061); served by the staffId / serviceIds indexes.
  ratingFor(
    target: { staffId: Types.ObjectId } | { serviceId: Types.ObjectId },
  ): Promise<RatingAggregate>;
  // Everything that has at least one review, for a full ratings rebuild.
  reviewedTargets(): Promise<{ staffIds: Types.ObjectId[]; serviceIds: Types.ObjectId[] }>;
}

export function reviewSearchFilter(
  search: Pick<ReviewSearch, 'staffId' | 'serviceId' | 'includeHidden'>,
): QueryFilter<ReviewDoc> {
  const filter: QueryFilter<ReviewDoc> = {};
  if (search.staffId) filter.staffId = new Types.ObjectId(search.staffId);
  if (search.serviceId) filter.serviceIds = new Types.ObjectId(search.serviceId);
  if (!search.includeHidden) filter.isHidden = false;
  return filter;
}

export const reviewsRepository: ReviewsRepository = {
  async create(review, session) {
    const [created] = await ReviewModel.create([{ ...review, isHidden: false }], { session });
    return created!.toObject();
  },
  findById: (id) => ReviewModel.findById(id).lean<ReviewDoc>(),
  findByBookingId: (bookingId) =>
    ReviewModel.findOne({ bookingId: new Types.ObjectId(bookingId) }).lean<ReviewDoc>(),

  async reviewedBookingIds(bookingIds) {
    if (bookingIds.length === 0) return new Set();
    const rows = await ReviewModel.find(
      { bookingId: mongoose.trusted({ $in: bookingIds.map((id) => new Types.ObjectId(id)) }) },
      { bookingId: 1 },
    ).lean<{ bookingId: Types.ObjectId }[]>();
    return new Set(rows.map((r) => r.bookingId.toHexString()));
  },

  setVisibility(id, visibility, session) {
    const update = visibility.isHidden
      ? { $set: visibility }
      : { $set: { isHidden: false }, $unset: { hiddenBy: 1, hiddenReason: 1 } };
    return ReviewModel.findOneAndUpdate({ _id: id }, update, {
      returnDocument: 'after',
      runValidators: true,
      session,
    }).lean<ReviewDoc>();
  },

  async search({ skip, limit, ...criteria }) {
    const filter = reviewSearchFilter(criteria);
    const [data, total] = await Promise.all([
      ReviewModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<ReviewDoc[]>(),
      ReviewModel.countDocuments(filter),
    ]);
    return { data, total };
  },

  async ratingFor(target) {
    const match =
      'staffId' in target
        ? { staffId: target.staffId, isHidden: false }
        : { serviceIds: target.serviceId, isHidden: false };
    const [row] = await ReviewModel.aggregate<{ avg: number; count: number }>([
      { $match: match },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    return row ? { avg: row.avg, count: row.count } : { avg: 0, count: 0 };
  },

  async reviewedTargets() {
    const [staffIds, serviceIds] = await Promise.all([
      ReviewModel.distinct('staffId'),
      ReviewModel.distinct('serviceIds'),
    ]);
    return { staffIds, serviceIds };
  },
};
