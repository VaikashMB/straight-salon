import { Router } from 'express';
import { problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize } from '../../shared/auth/middleware.js';
import { idParamsSchema } from '../../shared/http/schemas.js';
import { validate } from '../../shared/http/validate.js';
import type { HolidaysController } from './holidays.controller.js';
import {
  CreateHolidayBodySchema,
  HolidayListSchema,
  HolidaySchema,
  ListHolidaysQuerySchema,
} from './holidays.schemas.js';

// ---- OpenAPI (04 §3 Settings & holidays, API-019..020) ----------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Settings'];
const bearer = [{ bearerAuth: [] }];
const errors = {
  400: problemResponse('Validation failed (VALIDATION_FAILED)'),
  401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
  403: problemResponse('Role not allowed (FORBIDDEN)'),
};

registry.registerPath({
  method: 'get',
  path: '/api/v1/holidays',
  tags,
  summary: 'List holidays (API-019)',
  description: 'Full-day closures, by date ascending. Both bounds are optional and inclusive.',
  security: [],
  request: { query: ListHolidaysQuerySchema },
  responses: {
    200: { description: 'Holidays', ...json(HolidayListSchema) },
    400: errors[400],
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/holidays',
  tags,
  summary: 'Add a holiday (API-020)',
  description:
    'ADMIN. Fails with ACTIVE_BOOKINGS_EXIST when active bookings exist that day, unless force: true cancels them and notifies the customers.',
  security: bearer,
  request: { body: { required: true, ...json(CreateHolidayBodySchema) } },
  responses: {
    201: { description: 'Holiday created', ...json(HolidaySchema) },
    ...errors,
    409: problemResponse('Date is already a holiday (DUPLICATE)'),
    422: problemResponse('Active bookings exist that day (ACTIVE_BOOKINGS_EXIST)'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/holidays/{id}',
  tags,
  summary: 'Remove a holiday (API-020)',
  description: 'ADMIN. No booking check.',
  security: bearer,
  request: { params: idParamsSchema },
  responses: {
    204: { description: 'Removed' },
    ...errors,
    404: problemResponse('Not found (NOT_FOUND)'),
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function holidaysRouter(deps: {
  controller: HolidaysController;
  accessTokens: AccessTokenService;
}): Router {
  const { controller: c } = deps;
  const admin = [authenticate(deps.accessTokens), authorize('holidays:manage')];
  const router = Router();
  router.get('/holidays', validate({ query: ListHolidaysQuerySchema }), c.list);
  router.post('/holidays', ...admin, validate({ body: CreateHolidayBodySchema }), c.create);
  router.delete('/holidays/:id', ...admin, validate({ params: idParamsSchema }), c.delete);
  return router;
}
