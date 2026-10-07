import { Router, type RequestHandler } from 'express';
import { problemResponse, registry } from '../../docs/registry.js';
import { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize } from '../../shared/auth/middleware.js';
import { IDEMPOTENCY_HEADER } from '../../shared/http/idempotency.js';
import { idParamsSchema } from '../../shared/http/schemas.js';
import { validate } from '../../shared/http/validate.js';
import type { BookingsController } from './bookings.controller.js';
import {
  BookingHistorySchema,
  BookingListSchema,
  BookingSchema,
  CancelBodySchema,
  CreateBookingBodySchema,
  ListBookingsQuerySchema,
  MyBookingsQuerySchema,
  RescheduleBodySchema,
  StatusBodySchema,
} from './bookings.schemas.js';

// ---- OpenAPI (04 §3 Bookings, API-050..056, API-058) ------------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Bookings'];
const bearer = [{ bearerAuth: [] }];
const errors = {
  400: problemResponse('Validation failed (VALIDATION_FAILED)'),
  401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
  403: problemResponse('Role not allowed (FORBIDDEN)'),
};
const notFound = problemResponse('Not found, including bookings you may not see (NOT_FOUND)');
export const idempotencyHeader = z.object({
  [IDEMPOTENCY_HEADER]: z.string().optional().openapi({
    description: 'Optional; replays the first successful response for 24 h (03 §9)',
    example: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  }),
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/bookings',
  tags,
  summary: 'Create a booking (API-050)',
  description:
    'CUSTOMER for themselves; RECEPTIONIST/ADMIN for a customer (customerId, source, checkInNow). startAt must be aligned to the slot granularity (BR-001), respect the lead time for customers (BR-002), the advance window (BR-003), working hours/breaks/time-off/holidays (BR-005), the stylist\'s services (BR-007) and the 3-upcoming-bookings limit for customers (BR-009). "any" assigns the qualified stylist with the fewest bookings that day (FR-033). checkInNow creates a CHECKED_IN walk-in at the current slot boundary or the next free slot today. 20 requests/hour/user.',
  security: bearer,
  request: {
    headers: idempotencyHeader,
    body: { required: true, ...json(CreateBookingBodySchema) },
  },
  responses: {
    201: { description: 'Booking created', ...json(BookingSchema) },
    ...errors,
    409: problemResponse(
      'Slot just taken (SLOT_UNAVAILABLE) or same Idempotency-Key in progress (IDEMPOTENCY_KEY_REUSED)',
    ),
    422: problemResponse(
      'A rule failed: VALIDATION_FAILED (alignment), LEAD_TIME_VIOLATION, ADVANCE_WINDOW_VIOLATION, OUTSIDE_BUSINESS_HOURS, STAFF_CANNOT_PERFORM_SERVICE, BOOKING_LIMIT_REACHED, IDEMPOTENCY_KEY_REUSED (different body)',
    ),
    429: problemResponse('Too many booking attempts (RATE_LIMITED)'),
    503: problemResponse('Lock store unavailable (TEMPORARILY_UNAVAILABLE)'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/bookings/me',
  tags,
  summary: 'My bookings (API-051)',
  description:
    'CUSTOMER. upcoming: active bookings not yet over, soonest first. past: everything else, latest first.',
  security: bearer,
  request: { query: MyBookingsQuerySchema },
  responses: { 200: { description: 'Page of bookings', ...json(BookingListSchema) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/bookings',
  tags,
  summary: 'Search bookings (API-052)',
  description: 'ADMIN, RECEPTIONIST, STAFF (always only their own). Sorted by startAt by default.',
  security: bearer,
  request: { query: ListBookingsQuerySchema },
  responses: { 200: { description: 'Page of bookings', ...json(BookingListSchema) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/bookings/{id}',
  tags,
  summary: 'Get a booking (API-053)',
  description: 'Owner customer, assigned stylist, RECEPTIONIST, ADMIN. Others get 404 (06 §3).',
  security: bearer,
  request: { params: idParamsSchema },
  responses: { 200: { description: 'Booking', ...json(BookingSchema) }, ...errors, 404: notFound },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/bookings/{id}/reschedule',
  tags,
  summary: 'Reschedule (API-054)',
  description:
    'Owner customer, RECEPTIONIST, ADMIN. Same booking and reference, new time and/or stylist (BR-015), re-validating BR-001..007. Only BOOKED bookings, up to the cut-off (BR-006) unless reception/admin override with a reason (audited).',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(RescheduleBodySchema) } },
  responses: {
    200: { description: 'Rescheduled booking', ...json(BookingSchema) },
    ...errors,
    404: notFound,
    409: problemResponse('Slot taken (SLOT_UNAVAILABLE) or changed concurrently (STALE_VERSION)'),
    422: problemResponse(
      'CUTOFF_PASSED, INVALID_STATUS_TRANSITION, LEAD_TIME_VIOLATION, ADVANCE_WINDOW_VIOLATION, OUTSIDE_BUSINESS_HOURS, STAFF_CANNOT_PERFORM_SERVICE, VALIDATION_FAILED',
    ),
    503: problemResponse('Lock store unavailable (TEMPORARILY_UNAVAILABLE)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/bookings/{id}/cancel',
  tags,
  summary: 'Cancel (API-055)',
  description:
    'Owner customer, RECEPTIONIST, ADMIN. Only BOOKED bookings, up to the cut-off (BR-006) unless reception/admin override with a reason (audited). The slot frees immediately.',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(CancelBodySchema) } },
  responses: {
    200: { description: 'Cancelled booking', ...json(BookingSchema) },
    ...errors,
    404: notFound,
    409: problemResponse('Changed concurrently (STALE_VERSION)'),
    422: problemResponse('CUTOFF_PASSED or INVALID_STATUS_TRANSITION'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/bookings/{id}/status',
  tags,
  summary: 'Move a booking along its lifecycle (API-056)',
  description:
    'Assigned stylist, RECEPTIONIST, ADMIN. BOOKED -> CHECKED_IN -> IN_SERVICE -> COMPLETED, or BOOKED -> NO_SHOW once the start time has passed (BR-010).',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(StatusBodySchema) } },
  responses: {
    200: { description: 'Updated booking', ...json(BookingSchema) },
    ...errors,
    404: notFound,
    409: problemResponse('Changed concurrently (STALE_VERSION)'),
    422: problemResponse('Not allowed from the current status (INVALID_STATUS_TRANSITION)'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/bookings/{id}/history',
  tags,
  summary: 'Status history and audit trail (API-058)',
  description: 'RECEPTIONIST, ADMIN.',
  security: bearer,
  request: { params: idParamsSchema },
  responses: {
    200: { description: 'History', ...json(BookingHistorySchema) },
    ...errors,
    404: notFound,
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function bookingsRouter(deps: {
  controller: BookingsController;
  accessTokens: AccessTokenService;
  createLimiter: RequestHandler; // 20/hour/user (06 §4), after authenticate
  idempotency: RequestHandler;
}): Router {
  const { controller: c } = deps;
  const byId = validate({ params: idParamsSchema });
  const router = Router();
  router.use('/bookings', authenticate(deps.accessTokens));

  router.post(
    '/bookings',
    authorize('booking:create:self', 'booking:create:any'),
    deps.createLimiter,
    validate({ body: CreateBookingBodySchema }),
    deps.idempotency,
    c.create,
  );
  router.get(
    '/bookings/me',
    authorize('booking:create:self'),
    validate({ query: MyBookingsQuerySchema }),
    c.listMine,
  );
  router.get(
    '/bookings',
    authorize('booking:read:any', 'booking:read:own'),
    validate({ query: ListBookingsQuerySchema }),
    c.list,
  );
  router.get('/bookings/:id', authorize('booking:read:any', 'booking:read:own'), byId, c.get);
  router.post(
    '/bookings/:id/reschedule',
    authorize('booking:create:self', 'booking:override_rules'),
    validate({ params: idParamsSchema, body: RescheduleBodySchema }),
    c.reschedule,
  );
  router.post(
    '/bookings/:id/cancel',
    authorize('booking:create:self', 'booking:override_rules'),
    validate({ params: idParamsSchema, body: CancelBodySchema }),
    c.cancel,
  );
  router.post(
    '/bookings/:id/status',
    authorize('booking:status:own', 'booking:status:any'),
    validate({ params: idParamsSchema, body: StatusBodySchema }),
    c.changeStatus,
  );
  router.get('/bookings/:id/history', authorize('booking:read:any'), byId, c.history);
  return router;
}
