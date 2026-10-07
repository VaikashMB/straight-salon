import { Router } from 'express';
import { OPTIONAL_BEARER, problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize, optionalAuthenticate } from '../../shared/auth/middleware.js';
import { idParamsSchema } from '../../shared/http/schemas.js';
import { validate } from '../../shared/http/validate.js';
import type { StaffController } from './staff.controller.js';
import {
  CreateStaffBodySchema,
  CreateTimeOffBodySchema,
  ListStaffQuerySchema,
  ListTimeOffQuerySchema,
  PutScheduleBodySchema,
  ScheduleSchema,
  StaffListSchema,
  StaffProfileSchema,
  StaffSchema,
  TimeOffListSchema,
  TimeOffParamsSchema,
  TimeOffSchema,
  UpdateStaffBodySchema,
} from './staff.schemas.js';

// ---- OpenAPI (04 §3 Staff, API-030..037) ------------------------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Staff'];
const bearer = [{ bearerAuth: [] }];
const errors = {
  400: problemResponse('Validation failed (VALIDATION_FAILED)'),
  401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
  403: problemResponse("Role not allowed, or another stylist's profile (FORBIDDEN)"),
};
const notFound = problemResponse('Not found (NOT_FOUND)');
const activeBookings = problemResponse('Active bookings are affected (ACTIVE_BOOKINGS_EXIST)');

registry.registerPath({
  method: 'get',
  path: '/api/v1/staff',
  tags,
  summary: 'List stylists (API-030)',
  description:
    'Active stylists, public fields only, by name. Filter by a service they perform. Cached 10 min. ADMIN may pass includeInactive=true for every stylist with admin fields.',
  security: OPTIONAL_BEARER,
  request: { query: ListStaffQuerySchema },
  responses: { 200: { description: 'Stylists', ...json(StaffListSchema) }, ...errors },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/staff/{id}',
  tags,
  summary: 'Stylist profile (API-031)',
  description:
    'Profile, services and rating. Deactivated stylists are not found, except for ADMIN, who also gets admin fields.',
  security: OPTIONAL_BEARER,
  request: { params: idParamsSchema },
  responses: {
    200: { description: 'Profile', ...json(StaffProfileSchema) },
    400: errors[400],
    401: errors[401],
    404: notFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/staff',
  tags,
  summary: 'Create a stylist profile (API-032)',
  description:
    'ADMIN. Links an active STAFF user (create it with POST /users first). The weekly schedule starts as the salon hours (FR-023). The user gets staffId in their token at the next login or refresh.',
  security: bearer,
  request: { body: { required: true, ...json(CreateStaffBodySchema) } },
  responses: {
    201: { description: 'Stylist created (admin view)', ...json(StaffSchema) },
    ...errors,
    409: problemResponse('The user already has a profile (DUPLICATE)'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/staff/{id}',
  tags,
  summary: 'Update or deactivate a stylist (API-032)',
  description:
    'ADMIN. isActive: false is blocked by future active bookings unless force: true cancels them and notifies the customers (BR-014).',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(UpdateStaffBodySchema) } },
  responses: {
    200: { description: 'Updated stylist (admin view)', ...json(StaffSchema) },
    ...errors,
    404: notFound,
    409: problemResponse('Changed concurrently (STALE_VERSION)'),
    422: activeBookings,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/staff/{id}/schedule',
  tags,
  summary: 'Weekly schedule (API-033)',
  description: 'ADMIN, RECEPTIONIST, or the stylist themself. Times are salon-local HH:mm.',
  security: bearer,
  request: { params: idParamsSchema },
  responses: {
    200: { description: 'Schedule', ...json(ScheduleSchema) },
    ...errors,
    404: notFound,
  },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/staff/{id}/schedule',
  tags,
  summary: 'Replace the weekly schedule (API-034)',
  description: 'ADMIN. Exactly 7 days; breaks must lie within working hours and not overlap.',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(PutScheduleBodySchema) } },
  responses: {
    200: { description: 'Saved schedule', ...json(ScheduleSchema) },
    ...errors,
    404: notFound,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/staff/{id}/time-off',
  tags,
  summary: 'List time-off (API-035)',
  description:
    'ADMIN, RECEPTIONIST, or the stylist themself. Blocks overlapping the optional salon-local date range.',
  security: bearer,
  request: { params: idParamsSchema, query: ListTimeOffQuerySchema },
  responses: {
    200: { description: 'Time-off', ...json(TimeOffListSchema) },
    ...errors,
    404: notFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/staff/{id}/time-off',
  tags,
  summary: 'Block time off (API-036)',
  description:
    'ADMIN, or the stylist themself. Overlapping active bookings fail with ACTIVE_BOOKINGS_EXIST; ADMIN may pass force: true to cancel them and notify the customers (FR-024).',
  security: bearer,
  request: { params: idParamsSchema, body: { required: true, ...json(CreateTimeOffBodySchema) } },
  responses: {
    201: { description: 'Time-off created', ...json(TimeOffSchema) },
    ...errors,
    404: notFound,
    422: activeBookings,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/v1/staff/{id}/time-off/{timeOffId}',
  tags,
  summary: 'Remove time-off (API-037)',
  description: 'ADMIN, or the stylist themself.',
  security: bearer,
  request: { params: TimeOffParamsSchema },
  responses: { 204: { description: 'Removed' }, ...errors, 404: notFound },
});

// ---- Router ------------------------------------------------------------------------------------

export function staffRouter(deps: {
  controller: StaffController;
  accessTokens: AccessTokenService;
}): Router {
  const { controller: c, accessTokens } = deps;
  const auth = authenticate(accessTokens);
  const manage = [auth, authorize('staff:manage')];
  const readSchedule = [auth, authorize('schedule:read:any', 'schedule:read:own')];
  const manageTimeOff = [auth, authorize('timeoff:manage:any', 'timeoff:manage:own')];
  const byId = validate({ params: idParamsSchema });
  const router = Router();

  router.get(
    '/staff',
    optionalAuthenticate(accessTokens),
    validate({ query: ListStaffQuerySchema }),
    c.list,
  );
  router.get('/staff/:id', optionalAuthenticate(accessTokens), byId, c.get);
  router.post('/staff', ...manage, validate({ body: CreateStaffBodySchema }), c.create);
  router.patch(
    '/staff/:id',
    ...manage,
    validate({ params: idParamsSchema, body: UpdateStaffBodySchema }),
    c.update,
  );

  router.get('/staff/:id/schedule', ...readSchedule, byId, c.getSchedule);
  router.put(
    '/staff/:id/schedule',
    ...manage,
    validate({ params: idParamsSchema, body: PutScheduleBodySchema }),
    c.putSchedule,
  );

  router.get(
    '/staff/:id/time-off',
    ...readSchedule,
    validate({ params: idParamsSchema, query: ListTimeOffQuerySchema }),
    c.listTimeOff,
  );
  router.post(
    '/staff/:id/time-off',
    ...manageTimeOff,
    validate({ params: idParamsSchema, body: CreateTimeOffBodySchema }),
    c.createTimeOff,
  );
  router.delete(
    '/staff/:id/time-off/:timeOffId',
    ...manageTimeOff,
    validate({ params: TimeOffParamsSchema }),
    c.deleteTimeOff,
  );
  return router;
}
