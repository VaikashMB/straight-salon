import { Router } from 'express';
import { problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize } from '../../shared/auth/middleware.js';
import { validate } from '../../shared/http/validate.js';
import type { SettingsController } from './settings.controller.js';
import {
  PublicSettingsSchema,
  SettingsSchema,
  UpdateSettingsBodySchema,
} from './settings.schemas.js';

// ---- OpenAPI (04 §3 Settings, API-016..018) ---------------------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Settings'];
const bearer = [{ bearerAuth: [] }];
const authErrors = {
  401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
  403: problemResponse('Role not allowed (FORBIDDEN)'),
};

registry.registerPath({
  method: 'get',
  path: '/api/v1/settings/public',
  tags,
  summary: 'Public salon information (API-016)',
  description:
    'Name, address, contact, business hours, timezone, currency and the booking policy the booking wizard needs. Cached 10 min.',
  security: [],
  responses: { 200: { description: 'Public settings', ...json(PublicSettingsSchema) } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/settings',
  tags,
  summary: 'Full settings (API-017)',
  description: 'ADMIN. Defaults are returned until settings are first saved.',
  security: bearer,
  responses: { 200: { description: 'Settings', ...json(SettingsSchema) }, ...authErrors },
});

registry.registerPath({
  method: 'put',
  path: '/api/v1/settings',
  tags,
  summary: 'Replace settings (API-018)',
  description:
    'ADMIN. Full replacement of every FR-080 field. A new slot granularity must fit every active service duration (BR-013). The timezone cannot change while future active bookings exist.',
  security: bearer,
  request: { body: { required: true, ...json(UpdateSettingsBodySchema) } },
  responses: {
    200: { description: 'Saved settings', ...json(SettingsSchema) },
    400: problemResponse('Validation failed (VALIDATION_FAILED)'),
    ...authErrors,
    409: problemResponse('Changed concurrently (STALE_VERSION)'),
    422: problemResponse(
      'Granularity does not fit a service (INVALID_DURATION) or timezone change with future bookings (ACTIVE_BOOKINGS_EXIST)',
    ),
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function settingsRouter(deps: {
  controller: SettingsController;
  accessTokens: AccessTokenService;
}): Router {
  const { controller: c } = deps;
  const admin = [authenticate(deps.accessTokens), authorize('settings:manage')];
  const router = Router();
  router.get('/settings/public', c.getPublic);
  router.get('/settings', ...admin, c.get);
  router.put('/settings', ...admin, validate({ body: UpdateSettingsBodySchema }), c.update);
  return router;
}
