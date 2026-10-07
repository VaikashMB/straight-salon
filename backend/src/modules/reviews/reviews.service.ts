import { Types, type Connection } from 'mongoose';
import type { AuditService } from '../../shared/audit/audit.service.js';
import type { AuthContext } from '../../shared/auth/accessToken.js';
import { assertPermission } from '../../shared/auth/middleware.js';
import { withTransaction } from '../../shared/db/withTransaction.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../shared/errors/index.js';
import type { Outbox } from '../../shared/events/outbox.js';
import { paginated, skipFor, type Paginated } from '../../shared/http/pagination.js';
import type { Clock } from '../../shared/time/clock.js';
import { reviewWindowOpen } from '../bookings/bookings.mapper.js';
import type { BookingsService } from '../bookings/bookings.service.js';
import type { CatalogService } from '../catalog/catalog.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { StaffService } from '../staff/staff.service.js';
import type { UsersService } from '../users/users.service.js';
import { reviewAuditView, roundRating, toReviewDto } from './reviews.mapper.js';
import type { ReviewDoc } from './reviews.model.js';
import type { ReviewsRepository } from './reviews.repository.js';
import type {
  CreateReviewBody,
  ListReviewsQuery,
  ReviewDto,
  UpdateReviewBody,
} from './reviews.schemas.js';

// Reviews (FR-060..062, BR-012) and the rating aggregates they feed (FR-061).

export interface ReviewsService {
  create(bookingId: string, body: CreateReviewBody, viewer: AuthContext): Promise<ReviewDto>;
  list(query: ListReviewsQuery, viewer?: AuthContext): Promise<Paginated<ReviewDto>>;
  setVisibility(id: string, body: UpdateReviewBody, viewer: AuthContext): Promise<ReviewDto>;
  // For bookings: canReview (BR-012)
  reviewedBookingIds(bookingIds: string[]): Promise<Set<string>>;
  // For the ratings consumer (09 §5): recompute the stylist's and the services' averages from
  // the visible reviews. Recomputing from source makes repeats harmless. False if not found.
  refreshRatings(reviewId: string): Promise<boolean>;
  // Every stylist and service with reviews (seed, repairs).
  refreshAllRatings(): Promise<{ staff: number; services: number }>;
}

export interface ReviewsServiceDeps {
  repository: ReviewsRepository;
  audit: AuditService;
  outbox: Outbox;
  connection: Connection;
  clock: Clock;
  settings: Pick<SettingsService, 'get'>;
  bookings: Pick<BookingsService, 'findById'>;
  users: Pick<UsersService, 'findByIds'>;
  staff: Pick<StaffService, 'briefs' | 'setRating'>;
  catalog: Pick<CatalogService, 'findServices' | 'setServiceRating'>;
}

const notAllowed = (detail: string) => new BusinessRuleError('REVIEW_NOT_ALLOWED', detail);

export function createReviewsService(deps: ReviewsServiceDeps): ReviewsService {
  const { repository, audit, outbox, connection, clock, settings, bookings, users, staff } = deps;
  const { catalog } = deps;

  async function toDtos(reviews: ReviewDoc[], admin: boolean): Promise<ReviewDto[]> {
    const unique = (ids: Types.ObjectId[]) => [...new Set(ids.map((id) => id.toHexString()))];
    const [customers, stylists, services] = await Promise.all([
      users.findByIds(unique(reviews.map((r) => r.customerId))),
      staff.briefs(unique(reviews.map((r) => r.staffId))),
      catalog.findServices(unique(reviews.flatMap((r) => r.serviceIds))),
    ]);
    const ctx = {
      admin,
      customerNames: new Map(customers.map((u) => [u._id.toHexString(), u.name])),
      staffNames: new Map(stylists.map((b) => [b.id, b.displayName])),
      serviceNames: new Map(services.map((svc) => [svc.id, svc.name])),
    };
    return reviews.map((r) => toReviewDto(r, ctx));
  }

  async function refreshStaff(staffId: Types.ObjectId): Promise<void> {
    const rating = await repository.ratingFor({ staffId });
    await staff.setRating(staffId.toHexString(), { ...rating, avg: roundRating(rating.avg) });
  }

  async function refreshService(serviceId: Types.ObjectId): Promise<void> {
    const rating = await repository.ratingFor({ serviceId });
    await catalog.setServiceRating(serviceId.toHexString(), {
      ...rating,
      avg: roundRating(rating.avg),
    });
  }

  return {
    async create(bookingId, body, viewer) {
      const booking = await bookings.findById(bookingId);
      // 06 §3: another customer's booking is "not found".
      if (!booking || booking.customerId.toHexString() !== viewer.userId) {
        throw new NotFoundError('Booking not found.');
      }
      if (booking.status !== 'COMPLETED') {
        throw notAllowed('Only completed appointments can be reviewed (BR-012).');
      }
      const { reviewWindowDays } = await settings.get();
      if (!reviewWindowOpen(booking, clock.now(), reviewWindowDays)) {
        throw notAllowed(
          `Reviews can be left up to ${reviewWindowDays} days after the appointment (BR-012).`,
        );
      }
      // One per booking; the unique index also catches a concurrent second request (409).
      if (await repository.findByBookingId(booking._id)) {
        throw new ConflictError('You have already reviewed this booking.', 'DUPLICATE');
      }
      const review = await withTransaction(connection, async (session) => {
        const created = await repository.create(
          {
            bookingId: booking._id,
            customerId: booking.customerId,
            staffId: booking.staffId,
            serviceIds: booking.services.map((svc) => svc.serviceId),
            rating: body.rating,
            ...(body.comment ? { comment: body.comment } : {}),
          },
          session,
        );
        const id = created._id.toHexString();
        await audit.record(
          {
            action: 'review.create',
            entityType: 'review',
            entityId: id,
            before: null,
            after: reviewAuditView(created),
          },
          session,
        );
        // EVT-020
        await outbox.add(session, {
          type: 'review.created',
          aggregateType: 'review',
          aggregateId: id,
          payload: {
            reviewId: id,
            staffId: created.staffId.toHexString(),
            serviceIds: created.serviceIds.map((svc) => svc.toHexString()),
            rating: created.rating,
          },
        });
        return created;
      });
      return (await toDtos([review], false))[0]!;
    },

    async list(query, viewer) {
      const includeHidden = query.includeHidden ?? false;
      if (includeHidden) assertPermission(viewer, 'review:moderate');
      const result = await repository.search({
        ...(query.staffId ? { staffId: query.staffId } : {}),
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
        includeHidden,
        skip: skipFor(query),
        limit: query.pageSize,
      });
      return paginated(await toDtos(result.data, includeHidden), result.total, query);
    },

    async setVisibility(id, body, viewer) {
      const review = Types.ObjectId.isValid(id) ? await repository.findById(id) : null;
      if (!review) throw new NotFoundError('Review not found.');
      // Already in the requested state: nothing to record.
      if (review.isHidden === body.isHidden) return (await toDtos([review], true))[0]!;
      const updated = await withTransaction(connection, async (session) => {
        const next = await repository.setVisibility(
          review._id,
          body.isHidden
            ? {
                isHidden: true,
                hiddenBy: new Types.ObjectId(viewer.userId),
                hiddenReason: body.hiddenReason!,
              }
            : { isHidden: false },
          session,
        );
        if (!next) throw new NotFoundError('Review not found.');
        await audit.record(
          {
            action: body.isHidden ? 'review.hide' : 'review.unhide',
            entityType: 'review',
            entityId: id,
            before: { isHidden: review.isHidden, hiddenReason: review.hiddenReason ?? null },
            after: { isHidden: next.isHidden, hiddenReason: next.hiddenReason ?? null },
          },
          session,
        );
        // EVT-021
        await outbox.add(session, {
          type: 'review.visibility_changed',
          aggregateType: 'review',
          aggregateId: id,
          payload: { reviewId: id, isHidden: next.isHidden },
        });
        return next;
      });
      return (await toDtos([updated], true))[0]!;
    },

    reviewedBookingIds: (bookingIds) =>
      repository.reviewedBookingIds(bookingIds.filter((id) => Types.ObjectId.isValid(id))),

    async refreshRatings(reviewId) {
      const review = Types.ObjectId.isValid(reviewId) ? await repository.findById(reviewId) : null;
      if (!review) return false;
      await refreshStaff(review.staffId);
      for (const serviceId of review.serviceIds) await refreshService(serviceId);
      return true;
    },

    async refreshAllRatings() {
      const { staffIds, serviceIds } = await repository.reviewedTargets();
      for (const staffId of staffIds) await refreshStaff(staffId);
      for (const serviceId of serviceIds) await refreshService(serviceId);
      return { staff: staffIds.length, services: serviceIds.length };
    },
  };
}
