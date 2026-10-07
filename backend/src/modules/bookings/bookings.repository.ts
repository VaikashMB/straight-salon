import mongoose, { Types, type ClientSession, type QueryFilter } from 'mongoose';
import { ACTIVE_BOOKING_STATUSES, type BookingStatus } from '../../config/constants.js';
import { ConflictError } from '../../shared/errors/index.js';
import { BookingModel, type BookingDoc, type StatusChange } from './bookings.model.js';

// All Mongoose access for bookings. Operator objects written here are wrapped in trusted()
// because sanitizeFilter is on (06 §4); user input is never wrapped.

export type NewBooking = Omit<BookingDoc, '_id' | '__v' | 'createdAt' | 'updatedAt'>;

export interface BookingChange {
  set?: Partial<Omit<BookingDoc, '_id' | '__v' | 'statusHistory'>>;
  pushHistory?: StatusChange;
}

// Active bookings whose [startAt, blockedUntil) overlaps [from, to); no `to` = open-ended.
export interface ActiveScope {
  staffId?: string | Types.ObjectId;
  from: Date;
  to?: Date;
  excludeId?: Types.ObjectId;
}

export interface BookingSearch {
  from?: Date;
  to?: Date;
  staffId?: string;
  status?: BookingStatus;
  customerIds?: string[];
  bookingRefPrefix?: string;
  skip: number;
  limit: number;
  sort: Record<string, 1 | -1>;
}

export interface BookingsRepository {
  create(booking: NewBooking, session?: ClientSession): Promise<BookingDoc>;
  findById(id: string | Types.ObjectId, session?: ClientSession): Promise<BookingDoc | null>;
  findActive(scope: ActiveScope, session?: ClientSession): Promise<BookingDoc[]>;
  countActive(scope: ActiveScope, session?: ClientSession): Promise<number>;
  // FR-033 fairness: active bookings per stylist in [from, to).
  countActiveByStaff(staffIds: string[], from: Date, to: Date): Promise<Map<string, number>>;
  // BR-009: future BOOKED bookings for a customer.
  countFutureBooked(customerId: string | Types.ObjectId, now: Date): Promise<number>;
  // Optimistic concurrency (02 §1): 409 STALE_VERSION if the booking changed since it was read.
  apply(
    id: Types.ObjectId,
    expectedVersion: number,
    change: BookingChange,
    session?: ClientSession,
  ): Promise<BookingDoc>;
  search(search: BookingSearch): Promise<{ data: BookingDoc[]; total: number }>;
  listForCustomer(
    customerId: string,
    scope: 'upcoming' | 'past',
    now: Date,
    page: { skip: number; limit: number },
  ): Promise<{ data: BookingDoc[]; total: number }>;
}

const ACTIVE = () => mongoose.trusted({ $in: [...ACTIVE_BOOKING_STATUSES] });

export function activeFilter(scope: ActiveScope): QueryFilter<BookingDoc> {
  const filter: QueryFilter<BookingDoc> = {
    status: ACTIVE(),
    blockedUntil: mongoose.trusted({ $gt: scope.from }),
  };
  if (scope.to) filter.startAt = mongoose.trusted({ $lt: scope.to });
  if (scope.staffId) filter.staffId = new Types.ObjectId(scope.staffId);
  if (scope.excludeId) filter._id = mongoose.trusted({ $ne: scope.excludeId });
  return filter;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function searchFilter(
  search: Omit<BookingSearch, 'skip' | 'limit' | 'sort'>,
): QueryFilter<BookingDoc> {
  const filter: QueryFilter<BookingDoc> = {};
  if (search.from || search.to) {
    filter.startAt = mongoose.trusted({
      ...(search.from ? { $gte: search.from } : {}),
      ...(search.to ? { $lt: search.to } : {}),
    });
  }
  if (search.staffId) filter.staffId = new Types.ObjectId(search.staffId);
  if (search.status) filter.status = search.status;
  if (search.customerIds) {
    filter.customerId = mongoose.trusted({
      $in: search.customerIds.map((id) => new Types.ObjectId(id)),
    });
  }
  if (search.bookingRefPrefix) {
    filter.bookingRef = mongoose.trusted({ $regex: `^${escapeRegex(search.bookingRefPrefix)}` });
  }
  return filter;
}

export const bookingsRepository: BookingsRepository = {
  async create(booking, session) {
    const [created] = await BookingModel.create([booking], { session });
    return created!.toObject();
  },
  findById: (id, session) => BookingModel.findById(id, null, { session }).lean<BookingDoc>(),
  findActive: (scope, session) =>
    BookingModel.find(activeFilter(scope), null, { session })
      .sort({ startAt: 1 })
      .lean<BookingDoc[]>(),
  countActive: (scope, session) => BookingModel.countDocuments(activeFilter(scope), { session }),

  async countActiveByStaff(staffIds, from, to) {
    const rows = await BookingModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      {
        $match: {
          staffId: { $in: staffIds.map((id) => new Types.ObjectId(id)) },
          status: { $in: [...ACTIVE_BOOKING_STATUSES] },
          startAt: { $gte: from, $lt: to },
        },
      },
      { $group: { _id: '$staffId', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [r._id.toHexString(), r.count]));
  },

  countFutureBooked: (customerId, now) =>
    BookingModel.countDocuments({
      customerId: new Types.ObjectId(customerId),
      status: 'BOOKED',
      startAt: mongoose.trusted({ $gte: now }),
    }),

  async apply(id, expectedVersion, change, session) {
    const update: Record<string, unknown> = { $inc: { __v: 1 } };
    if (change.set) update.$set = change.set;
    if (change.pushHistory) update.$push = { statusHistory: change.pushHistory };
    const updated = await BookingModel.findOneAndUpdate({ _id: id, __v: expectedVersion }, update, {
      returnDocument: 'after',
      runValidators: true,
      session,
    }).lean<BookingDoc>();
    if (!updated) {
      throw new ConflictError(
        'The booking was changed by someone else. Reload and try again.',
        'STALE_VERSION',
      );
    }
    return updated;
  },

  async search({ skip, limit, sort, ...criteria }) {
    const filter = searchFilter(criteria);
    const [data, total] = await Promise.all([
      BookingModel.find(filter).sort(sort).skip(skip).limit(limit).lean<BookingDoc[]>(),
      BookingModel.countDocuments(filter),
    ]);
    return { data, total };
  },

  // upcoming: still active and not over yet, soonest first; past: everything else, latest first.
  async listForCustomer(customerId, scope, now, { skip, limit }) {
    const customer = new Types.ObjectId(customerId);
    const upcoming = { status: ACTIVE(), endAt: mongoose.trusted({ $gt: now }) };
    const filter: QueryFilter<BookingDoc> =
      scope === 'upcoming'
        ? { customerId: customer, ...upcoming }
        : {
            customerId: customer,
            // sanitizeFilter recurses into $or, so each operator object is trusted on its own.
            $or: [
              { status: mongoose.trusted({ $nin: [...ACTIVE_BOOKING_STATUSES] }) },
              { endAt: mongoose.trusted({ $lte: now }) },
            ],
          };
    const [data, total] = await Promise.all([
      BookingModel.find(filter)
        .sort({ startAt: scope === 'upcoming' ? 1 : -1 })
        .skip(skip)
        .limit(limit)
        .lean<BookingDoc[]>(),
      BookingModel.countDocuments(filter),
    ]);
    return { data, total };
  },
};
