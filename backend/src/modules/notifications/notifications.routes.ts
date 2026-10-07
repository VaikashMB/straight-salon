import { Router } from 'express';
import { problemResponse, registry } from '../../docs/registry.js';
import type { z } from '../../docs/zod.js';
import type { AccessTokenService } from '../../shared/auth/accessToken.js';
import { authenticate, authorize } from '../../shared/auth/middleware.js';
import { validate } from '../../shared/http/validate.js';
import type { NotificationsController } from './notifications.controller.js';
import {
  ListMyNotificationsQuerySchema,
  ListNotificationsQuerySchema,
  NotificationListSchema,
} from './notifications.schemas.js';

// ---- OpenAPI (04 §3 Notifications, API-065..066) ----------------------------------------------

const json = (schema: z.ZodType) => ({ content: { 'application/json': { schema } } });
const tags = ['Notifications'];
const bearer = [{ bearerAuth: [] }];
const errors = {
  400: problemResponse('Validation failed (VALIDATION_FAILED)'),
  401: problemResponse('Not authenticated (UNAUTHENTICATED, TOKEN_EXPIRED)'),
};

registry.registerPath({
  method: 'get',
  path: '/api/v1/notifications/me',
  tags,
  summary: 'My notification history (API-065)',
  description: 'Any logged-in user. Emails and SMS sent to me, newest first.',
  security: bearer,
  request: { query: ListMyNotificationsQuerySchema },
  responses: {
    200: { description: 'Page of notifications', ...json(NotificationListSchema) },
    ...errors,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/notifications',
  tags,
  summary: 'All notifications (API-066)',
  description:
    'ADMIN. Every message with its delivery state, newest first; used to inspect messages from the mock providers in development. Secrets such as reset links are redacted.',
  security: bearer,
  request: { query: ListNotificationsQuerySchema },
  responses: {
    200: { description: 'Page of notifications', ...json(NotificationListSchema) },
    ...errors,
    403: problemResponse('Role not allowed (FORBIDDEN)'),
  },
});

// ---- Router ------------------------------------------------------------------------------------

export function notificationsRouter(deps: {
  controller: NotificationsController;
  accessTokens: AccessTokenService;
}): Router {
  const { controller: c } = deps;
  const router = Router();
  router.use('/notifications', authenticate(deps.accessTokens));
  router.get('/notifications/me', validate({ query: ListMyNotificationsQuerySchema }), c.listMine);
  router.get(
    '/notifications',
    authorize('notifications:read:any'),
    validate({ query: ListNotificationsQuerySchema }),
    c.list,
  );
  return router;
}
