import { Router } from 'express';
import { OPTIONAL_BEARER, problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize, optionalAuthenticate } from '../../shared/auth/middleware.js';
import { idParamsSchema } from '../../shared/http/schemas.js';
import { validate } from '../../shared/http/validate.js';
import type { ReviewsController } from './reviews.controller.js';
import {
  CreateReviewBodySchema,
  ListReviewsQuerySchema,
  ReviewListSchema,
  ReviewSchema,
  UpdateReviewBodySchema,
} from './reviews.schemas.js';

// ---- OpenAPI (04 §3 Reviews, API-060..062) -----------------------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Reviews'];
const bearer = [{ bearerAuth: [] }];
const errors = {
  400: problemResponse('Validation failed (VALIDATION_FAILED)'),
  401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
  403: problemResponse('Role not allowed (FORBIDDEN)'),
};

registry.registerPath({
  method: 'post',
  path: '/api/v1/bookings/{id}/review',
  tags,
  summary: 'Review a completed booking (API-060)',
  description:
    "The booking's CUSTOMER, once it is COMPLETED and within reviewWindowDays of completion; one review per booking (BR-012). Other customers' bookings are not found.",
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(CreateReviewBodySchema) } },
  responses: {
    201: { description: 'Review created', ...json(ReviewSchema) },
    ...errors,
    404: problemResponse("Not found, including other customers' bookings (NOT_FOUND)"),
    409: problemResponse('Already reviewed (DUPLICATE)'),
    422: problemResponse('Not completed or the review window has passed (REVIEW_NOT_ALLOWED)'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/reviews',
  tags,
  summary: 'List reviews (API-061)',
  description:
    'Public: visible reviews, newest first, optionally for one stylist or service. ADMIN may pass includeHidden=true to moderate (adds bookingId, isHidden, hiddenReason and the full customer name).',
  security: OPTIONAL_BEARER,
  request: { query: ListReviewsQuerySchema },
  responses: { 200: { description: 'Page of reviews', ...json(ReviewListSchema) }, ...errors },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/reviews/{id}',
  tags,
  summary: 'Hide or unhide a review (API-062)',
  description:
    'ADMIN. Hiding needs a reason (FR-062, audited); hidden reviews leave the stylist and service ratings.',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(UpdateReviewBodySchema) } },
  responses: {
    200: { description: 'Review (admin view)', ...json(ReviewSchema) },
    ...errors,
    404: problemResponse('Not found (NOT_FOUND)'),
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function reviewsRouter(deps: {
  controller: ReviewsController;
  accessTokens: AccessTokenService;
}): Router {
  const { controller: c, accessTokens } = deps;
  const router = Router();
  router.post(
    '/bookings/:id/review',
    authenticate(accessTokens),
    authorize('booking:create:self'), // customers only (06 §3)
    validate({ params: idParamsSchema, body: CreateReviewBodySchema }),
    c.create,
  );
  router.get(
    '/reviews',
    optionalAuthenticate(accessTokens),
    validate({ query: ListReviewsQuerySchema }),
    c.list,
  );
  router.patch(
    '/reviews/:id',
    authenticate(accessTokens),
    authorize('review:moderate'),
    validate({ params: idParamsSchema, body: UpdateReviewBodySchema }),
    c.setVisibility,
  );
  return router;
}
