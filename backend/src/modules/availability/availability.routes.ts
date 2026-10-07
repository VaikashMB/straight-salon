import { Router } from 'express';
import { OPTIONAL_BEARER, problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { optionalAuthenticate } from '../../shared/auth/middleware.js';
import { validate } from '../../shared/http/validate.js';
import type { AvailabilityController } from './availability.controller.js';
import {
  AvailabilityQuerySchema,
  AvailabilitySchema,
  AvailableDaysQuerySchema,
  AvailableDaysSchema,
} from './availability.schemas.js';

// ---- OpenAPI (04 §3 Availability, API-040..041) -----------------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Availability'];
const errors = {
  400: problemResponse('Validation failed, or an unknown/inactive service (VALIDATION_FAILED)'),
  401: problemResponse('A bearer token was sent but is invalid (UNAUTHENTICATED, TOKEN_EXPIRED)'),
  422: problemResponse('The stylist does not perform every service (STAFF_CANNOT_PERFORM_SERVICE)'),
};

registry.registerPath({
  method: 'get',
  path: '/api/v1/availability',
  tags,
  summary: 'Bookable start times for a day (API-040)',
  description:
    'Start times where the stylist (or, for "any", at least one qualified stylist) is free for the total duration plus buffer. Respects salon and stylist hours, breaks, time-off, holidays and bookings (03 §5.2). Customers and the public do not see starts within the lead time; staff roles (send a token) do. Dates outside today..today+maxAdvanceDays return no slots. Cached 60 s per stylist.',
  security: OPTIONAL_BEARER,
  request: { query: AvailabilityQuerySchema },
  responses: { 200: { description: 'Slots', ...json(AvailabilitySchema) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/availability/days',
  tags,
  summary: 'Dates with at least one slot (API-041)',
  description: 'For greying out the calendar. At most 31 days. Cached 2 min.',
  security: OPTIONAL_BEARER,
  request: { query: AvailableDaysQuerySchema },
  responses: { 200: { description: 'Available dates', ...json(AvailableDaysSchema) }, ...errors },
});

// ---- Router ------------------------------------------------------------------------------------

export function availabilityRouter(deps: {
  controller: AvailabilityController;
  accessTokens: AccessTokenService;
}): Router {
  const { controller: c } = deps;
  const optional = optionalAuthenticate(deps.accessTokens);
  const router = Router();
  router.get('/availability', optional, validate({ query: AvailabilityQuerySchema }), c.slots);
  router.get('/availability/days', optional, validate({ query: AvailableDaysQuerySchema }), c.days);
  return router;
}
