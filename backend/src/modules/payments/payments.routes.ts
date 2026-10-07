import { Router, type RequestHandler } from 'express';
import { problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize } from '../../shared/auth/middleware.js';
import { idParamsSchema } from '../../shared/http/schemas.js';
import { validate } from '../../shared/http/validate.js';
import { idempotencyHeader } from '../bookings/bookings.routes.js';
import { BookingSchema } from '../bookings/bookings.schemas.js';
import type { PaymentsController } from './payments.controller.js';
import { RecordPaymentBodySchema } from './payments.schemas.js';

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });

registry.registerPath({
  method: 'post',
  path: '/api/v1/bookings/{id}/payment',
  tags: ['Bookings'],
  summary: 'Record a payment (API-057)',
  description:
    'RECEPTIONIST, ADMIN. Only for COMPLETED bookings; amountPaidMinor + discountMinor must equal the total; a discount needs a reason (BR-011). One payment per booking. Supports Idempotency-Key.',
  security: [{ bearerAuth: [] }],
  request: {
    headers: idempotencyHeader,
    params: idParamsSchema,
    body: { required: true, ...json(RecordPaymentBodySchema) },
  },
  responses: {
    200: { description: 'Booking with the recorded payment', ...json(BookingSchema) },
    400: problemResponse('Validation failed (VALIDATION_FAILED)'),
    401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
    403: problemResponse('Role not allowed (FORBIDDEN)'),
    404: problemResponse('Not found (NOT_FOUND)'),
    409: problemResponse(
      'Already paid (PAYMENT_ALREADY_RECORDED), changed concurrently (STALE_VERSION) or key in progress (IDEMPOTENCY_KEY_REUSED)',
    ),
    422: problemResponse(
      'Not completed (PAYMENT_NOT_ALLOWED), amounts do not add up (PAYMENT_MISMATCH), key reused with another body (IDEMPOTENCY_KEY_REUSED)',
    ),
  },
});

export function paymentsRouter(deps: {
  controller: PaymentsController;
  accessTokens: AccessTokenService;
  idempotency: RequestHandler;
}): Router {
  const router = Router();
  router.post(
    '/bookings/:id/payment',
    authenticate(deps.accessTokens),
    authorize('payment:record'),
    validate({ params: idParamsSchema, body: RecordPaymentBodySchema }),
    deps.idempotency,
    deps.controller.record,
  );
  return router;
}
